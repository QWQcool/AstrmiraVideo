import {
  creationRunReferenceProblem,
  creationRunStepKey,
  type CreationRun,
  type CreationRunStep,
  type EditScript,
  type EditTransition,
  resolveTierSize,
  type VideoGenerateRequest,
} from '@astrmira/shared';

/**
 * 创作会话执行引擎（CONTRACT §29 / D72；S8-B2）。
 *
 * 分层与 canvasPlanRunner 同一条纪律：**正确性都在纯逻辑里，网络只是最后一步**。
 * - `refreshFromTasks` / `deriveTransition` / `readySteps` / `buildStepRequest` 全纯函数（可单测）；
 * - `CreationRunService.tick` 是薄驱动：读任务 → 推进状态 → 提交就绪步骤 → 落库。
 *
 * 四条执行铁律（§29）：
 * 1. 拓扑提交：步骤只在 `dependsOn` 全部 succeeded 后提交；
 * 2. 失败即停：任一步骤 failed → 会话 failed，**不再提交任何后续步骤**；
 * 3. 绝不自动重提：`attempt` 只由显式 retry 端点 +1（换幂等键 = 真新任务）；
 * 4. 断点续跑：幂等键确定性 —— `submitting` 但无 taskId 的步骤（提交瞬间崩溃）用**同一个键**重提，
 *    幂等命中既有任务；这是本地轨（D74）下的安全路径，不适用于付费云轨。
 */

/** 服务端口：任务事实的读取与生成提交（生产环境接 TaskStore + /api/generate 同一链路；测试注入假件） */
export interface RunTaskView {
  status: 'queued' | 'submitting' | 'running' | 'succeeded' | 'failed';
  hasOutput: boolean;
  message?: string;
}

export interface RunEnginePorts {
  getTask(taskId: string): RunTaskView | null;
  /** 返回 taskId；同幂等键命中既有任务时返回那个 taskId（断点续跑）。拒绝时抛错（含人话原因）。 */
  submit(request: VideoGenerateRequest, idempotencyKey: string): Promise<string>;
  /**
   * S8-C：收尾拼接（/api/edits 同一入队路径；同幂等键回放）。拒绝时抛错。
   *
   * B97：第三个参数是**会话的业务项目**（`CreationRun.projectId`）。拼接任务由引擎发起，
   * 不是用户直接提交的剪辑；入队方必须用它 —— 否则任务记录会落回 default，
   * 而请求快照还指着原项目，筛选与交付归属就分家了。
   */
  submitEdit(script: EditScript, idempotencyKey: string, projectId: string): Promise<string>;
}

/** 步骤终态判断（refresh 用） */
function taskTerminal(view: RunTaskView): boolean {
  return view.status === 'succeeded' || view.status === 'failed';
}

/** ① 用任务事实刷新步骤状态（纯；返回是否有变化） */
export function refreshFromTasks(run: CreationRun, getTask: RunEnginePorts['getTask']): boolean {
  let changed = false;
  run.steps.forEach((step, index) => {
    if (step.taskId === undefined) return;
    if (step.status !== 'submitting' && step.status !== 'running') return;
    const view = getTask(step.taskId);
    if (view === null || !taskTerminal(view)) {
      // 任务还在跑 / 查不到（可能尚未轮询到）：如实保持，不猜
      if (step.status === 'submitting' && view !== null) {
        run.steps[index] = { ...step, status: 'running' };
        changed = true;
      }
      return;
    }
    if (view.status === 'succeeded' && view.hasOutput) {
      run.steps[index] = {
        ...step,
        status: 'succeeded',
        outputAssetId: `task:${step.taskId}`,
        ...(step.error === undefined ? {} : { error: undefined }),
      };
      changed = true;
    } else if (view.status === 'failed') {
      run.steps[index] = {
        ...step,
        status: 'failed',
        error: view.message?.slice(0, 600) ?? '生成失败（上游未给出原因）',
      };
      changed = true;
    } else if (view.status === 'succeeded' && !view.hasOutput) {
      // 成功但没有产物 = 数据异常，按失败处理并如实说明（不假装成功）
      run.steps[index] = {
        ...step,
        status: 'failed',
        error: '任务成功但没有任何产物（数据异常）',
      };
      changed = true;
    }
  });
  return changed;
}

/** ② 状态推进（纯；直接改传入对象并返回是否有变化） */
export function deriveTransition(run: CreationRun, now: number): boolean {
  if (run.state !== 'running') return false;

  const failed = run.steps.find((step) => step.status === 'failed');
  if (failed !== undefined) {
    run.state = 'failed';
    run.failure = { stepId: failed.id, message: failed.error ?? '生成失败' };
    run.finishedAt = now;
    return true;
  }

  if (run.steps.every((step) => step.status === 'succeeded')) {
    // S8-C：≥2 个视频步骤 → 进 assembling 自动拼接；单镜头直落 succeeded（拼接无信息量，V2.65 口径）
    const videoCount = run.steps.filter((step) => step.kind === 'video').length;
    if (videoCount >= 2) {
      run.state = 'assembling';
      return true;
    }
    run.state = 'succeeded';
    run.finishedAt = now;
    return true;
  }

  const imageSteps = run.steps.filter((step) => step.kind === 'image');
  const imagesDone =
    imageSteps.length > 0 && imageSteps.every((step) => step.status === 'succeeded');
  const anyVideoSubmitted = run.steps.some(
    (step) => step.kind === 'video' && step.status !== 'pending',
  );
  if (
    run.mode === 'first-frame-confirm' &&
    imagesDone &&
    run.confirmedAt === undefined &&
    !anyVideoSubmitted
  ) {
    run.state = 'awaiting-confirmation';
    return true;
  }
  return false;
}

/** 分镜表 transition 文案 → 剪辑转场枚举（S9；未匹配 = 硬切，不猜） */
const TRANSITION_MAP: Readonly<Record<string, EditTransition>> = {
  '叠化': 'fade',
  '淡入淡出': 'fade',
  'fade': 'fade',
  '左移': 'wipeleft',
  '左擦': 'wipeleft',
  'wipeleft': 'wipeleft',
  '右移': 'slideright',
  '右擦': 'slideright',
  'slideright': 'slideright',
};

/**
 * S9：拼接脚本 = 按镜头顺序 concat 全部视频步骤的任务。
 * 分镜表的 `transition` 非空且可映射 → 接缝用该转场（单一 xfade 紧跟 concat，0.5s）；
 * 未映射/缺省 = 硬切（纯 concat，S8-C 口径）。转场语义属于"接缝"（editExecutor 的显式规则）。
 */
export function buildAssemblyScript(
  run: CreationRun,
  transitions: readonly (string | undefined)[] = [],
): EditScript | null {
  const videoSteps = run.steps.filter(
    (step) => step.kind === 'video' && step.status === 'succeeded' && step.taskId !== undefined,
  );
  const taskIds = videoSteps.map((step) => step.taskId as string);
  if (taskIds.length < 2) return null;

  const [sourceTaskId, ...appendTaskIds] = taskIds;
  const operations: EditScript['operations'] = [
    // CONTRACT §11：concat 只追加到 sourceTaskId 之后，**不含源片自身**。
    // 首镜已经作为 sourceTaskId，不能再进这里，否则成片会多出一整段首镜（F10）。
    { type: 'concat', taskIds: appendTaskIds },
  ];
  // transitions[i] = 第 i 段与第 i+1 段之间的转场文案（镜头序）。
  // 接缝数由**镜头总数**决定（N−1），不能拿 concat 的 append 列表长度（N−1）再算错一层。
  const seamCount = taskIds.length - 1;
  const seam = transitions
    .slice(0, seamCount)
    .map((raw) => raw?.trim())
    .find((raw) => raw !== undefined && raw !== '' && TRANSITION_MAP[raw] !== undefined);
  if (seam !== undefined) {
    operations.push({ type: 'xfade', transition: TRANSITION_MAP[seam]!, durationSec: 0.5 });
  }
  return {
    sourceTaskId: sourceTaskId!,
    operations,
  };
}

/** ③ 当前可提交的步骤（纯）：pending（或崩溃残留的 submitting-无-taskId）+ 依赖全部 succeeded + 视频门放行 */
export function readySteps(run: CreationRun): CreationRunStep[] {
  if (run.state !== 'running') return [];
  const hasImages = run.steps.some((step) => step.kind === 'image');
  const videoGate = run.mode === 'unattended' || run.confirmedAt !== undefined || !hasImages;
  return run.steps.filter((step) => {
    const submittable =
      step.status === 'pending' || (step.status === 'submitting' && step.taskId === undefined);
    if (!submittable) return false;
    if (step.kind === 'video' && !videoGate) return false;
    return step.dependsOn.every((dep) => {
      const upstream = run.steps.find((item) => item.id === dep);
      return upstream !== undefined && upstream.status === 'succeeded';
    });
  });
}

/**
 * ④ 步骤 → 生成请求（纯）。
 *
 * 结构兼容允许 dependsOn/referenceAssetIds 存到 4 个，但当前执行只消费：
 * - 1 个 image 依赖（first-frame / 定妆锚点）或 1 张无依赖用户参考；
 * - 第二个依赖/尾帧/多参考没有接线，B93 已在创建和本函数入口明确拒绝。
 * 不要把结构兼容上限写成执行能力。
 */
export function buildStepRequest(run: CreationRun, step: CreationRunStep): VideoGenerateRequest {
  // B93/F3：旧会话或绕过创建校验的输入也不能静默丢参考/把参考挤进未接线的尾帧。
  const referenceProblem = creationRunReferenceProblem(step);
  if (referenceProblem !== null) throw new Error(referenceProblem);
  const firstFrameImage =
    step.dependsOn.length === 0
      ? step.referenceAssetIds[0]
      : run.steps.find((item) => item.id === step.dependsOn[0] && item.status === 'succeeded')
          ?.outputAssetId;
  const lastFrameImage =
    step.dependsOn.length >= 2
      ? run.steps.find((item) => item.id === step.dependsOn[1] && item.status === 'succeeded')
          ?.outputAssetId
      : step.referenceAssetIds.length > (step.dependsOn.length > 0 ? 0 : 1)
        ? step.referenceAssetIds[step.dependsOn.length > 0 ? 0 : 1]
        : undefined;

  // **必须用 shared 的那张表**：这里曾经自己算 Math.round(base*16/9)，得到 853×480 / 1920×1080
  // —— 非 32 对齐、1080p 还越了档位预算，与界面显示的尺寸不是同一个数（B98）。档位表只能有一份。
  const resolution =
    step.resolutionTier === undefined ? undefined : resolveTierSize(step.resolutionTier, step.aspectRatio);

  if (step.kind === 'image') {
    // S9-A1：图步带依赖（定妆语义）→ 参考首镜产物继续出图（ReferenceLatent 模板在 provider 侧接住）
    const reference =
      step.dependsOn.length === 0
        ? step.referenceAssetIds[0]
        : run.steps.find((item) => item.id === step.dependsOn[0] && item.status === 'succeeded')
            ?.outputAssetId;
    return {
      prompt: step.prompt,
      mode: 't2i',
      ...(reference === undefined ? {} : { assets: { firstFrameImage: reference } }),
      aspectRatio: step.aspectRatio,
      ...(resolution === undefined ? {} : { resolution }),
      provider: run.provider,
      projectId: run.projectId,
    };
  }
  return {
    prompt: step.prompt,
    mode: firstFrameImage === undefined ? 't2v' : 'i2v',
    ...(firstFrameImage === undefined && lastFrameImage === undefined
      ? {}
      : {
          assets: {
            ...(firstFrameImage === undefined ? {} : { firstFrameImage }),
            ...(lastFrameImage === undefined ? {} : { lastFrameImage }),
          },
        }),
    aspectRatio: step.aspectRatio,
    ...(resolution === undefined ? {} : { resolution }),
    ...(step.durationSec === undefined ? {} : { params: { durationSec: step.durationSec } }),
    provider: run.provider,
    projectId: run.projectId,
  };
}

/**
 * 薄驱动：一次 tick = 刷新 → 推进 → 提交就绪步骤 → 落库。
 * 同一会话的 tick 串行（in-flight 集合），避免并发提交同一步骤。
 */
export class CreationRunService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly deps: {
      load: (id: string) => CreationRun | null;
      save: (run: CreationRun) => void;
      ports: RunEnginePorts;
      now?: () => number;
    },
  ) {}

  async tick(runId: string): Promise<CreationRun | null> {
    if (this.inFlight.has(runId)) return null;
    this.inFlight.add(runId);
    try {
      const run = this.deps.load(runId);
      if (run === null) return null;
      // S10-R1 / B92：planned 只是草稿，定时扫描/重启/直接 tick 都不能执行。
      // 只有 POST /start 才允许把 planned 迁移到 running（路由显式写入）。
      if (run.state === 'planned') return run;
      const now = this.deps.now?.() ?? Date.now();

      // S8-C：assembling = 已提交（或待提交）自动拼接任务；等它终态
      if (run.state === 'assembling') {
        if (run.assembledTaskId === undefined) {
          // S9：转场文案按镜头序收集（每步的 transition = 与下一镜的接缝）
          const transitions = run.steps
            .filter((step) => step.kind === 'video')
            .map((step) => step.transition);
          const script = buildAssemblyScript(run, transitions);
          if (script === null) {
            // 步骤状态不再满足拼接（异常输入）：如实失败，不硬拼
            run.state = 'failed';
            run.failure = { stepId: 'assembly', message: '会话进入拼接但找不到 ≥2 个成功视频步骤' };
            run.finishedAt = now;
          } else {
            try {
              const taskId = await this.deps.ports.submitEdit(
                script,
                // B99：**同一 attempt 用同一个键**（恢复/重复点击命中同一任务）；
                // 只有显式「重试拼接」把 assemblyAttempt +1，才换键 = 真新任务。
                creationRunStepKey(run.id, 'assembly', run.assemblyAttempt ?? 0),
                run.projectId,
              );
              run.assembledTaskId = taskId;
              run.updatedAt = now;
            } catch (err) {
              run.state = 'failed';
              run.failure = {
                stepId: 'assembly',
                message: (err instanceof Error ? err.message : String(err)).slice(0, 600),
              };
              run.finishedAt = now;
              run.updatedAt = now;
            }
          }
          this.deps.save(run);
          return run;
        }
        const assembly = this.deps.ports.getTask(run.assembledTaskId);
        if (assembly !== null && assembly.status === 'succeeded' && assembly.hasOutput) {
          run.state = 'succeeded';
          run.finishedAt = now;
          run.updatedAt = now;
        } else if (assembly !== null && assembly.status === 'failed') {
          run.state = 'failed';
          run.failure = {
            stepId: 'assembly',
            message: assembly.message?.slice(0, 600) ?? '自动拼接失败',
          };
          run.finishedAt = now;
          run.updatedAt = now;
        }
        this.deps.save(run);
        return run;
      }

      if (run.state !== 'running') return run;

      refreshFromTasks(run, this.deps.ports.getTask);
      deriveTransition(run, now);
      if (run.state !== 'running') {
        run.updatedAt = now;
        this.deps.save(run);
        return run;
      }

      for (const step of readySteps(run)) {
        const key = creationRunStepKey(run.id, step.id, step.attempt);
        const index = run.steps.findIndex((item) => item.id === step.id);
        try {
          const taskId = await this.deps.ports.submit(buildStepRequest(run, step), key);
          run.steps[index] = { ...run.steps[index]!, status: 'submitting', taskId };
          run.updatedAt = now;
        } catch (err) {
          // 提交被拒 = 该步骤失败（失败即停；不重试）
          run.steps[index] = {
            ...run.steps[index]!,
            status: 'failed',
            error: (err instanceof Error ? err.message : String(err)).slice(0, 600),
          };
          run.state = 'failed';
          run.failure = { stepId: step.id, message: run.steps[index]!.error ?? '提交被拒' };
          run.finishedAt = now;
          run.updatedAt = now;
          break;
        }
      }
      this.deps.save(run);
      return run;
    } finally {
      this.inFlight.delete(runId);
    }
  }
}
