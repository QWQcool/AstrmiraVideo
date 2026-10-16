import {
  PLAN_RETRY_DEFAULT_BACKOFF_MS,
  type CanvasPlan,
  type CanvasPlanNode,
  type VideoGenerateRequest,
} from '@astrmira/shared';
import { getLanguage, translate, type Language } from './i18n';
import {
  planExecutionOrder,
  planIdempotencyKey,
  planIncomingEdges,
  planNodeBlockReason,
  planRetainedTaskId,
  planRunScope,
  planRunSeq,
  toGenerateRequest,
} from './canvasPlan';

/**
 * 编排执行器（CONTRACT §11-6 的执行语义；台账 A5 片 A + 片 B）。
 *
 * ## 为什么是"注入 submit 的纯驱动"
 * 执行的全部正确性都在**顺序、阻断、幂等键、范围**四件事上；网络只是最后一步。
 * 把 submit 注入进来，这四件事就能在单测里完整覆盖（本仓前端没有 jsdom，
 * 网络层靠冒烟的真浏览器覆盖 —— 两层各管一半，不重叠）。
 *
 * ## 与契约逐条对应
 * - 拓扑序提交、**不等全图终态**（下游只等"它要引用的那条上游"出片）；
 * - 幂等键 = `plan:<planId>:<nodeId>[:r<代数>]` —— 同代数重复点运行不重复计费；
 * - **显式重跑 = 代数 +1**（键全变 → 真的新建任务，界面必须写清这是花钱动作）；
 * - **部分重跑**：范围外的节点 `kept`（不提交），下游引用它 `pinnedTaskId ?? lastTaskId`；
 * - **不猜上游**：不能跑的节点进 `skipped` 并带原因（不带着错误输入去跑）；
 * - 环 → `cycle` 非空且**一个都不提交**；
 * - 结果只是界面状态，不落库（真相在 `tasks` 表）。
 *
 * ## 语言迁移第十批：结果里的原因走字典
 * 那些 `message`（"上游没有提交成功" / "等待出片超时"…）是**给用户看的**（节点卡片 + 运行报告），
 * 所以它们进了 `canvas.run.*`；语言从 `deps.language` 取（缺省 `getLanguage()`，
 * 见 `PlanRunnerDeps.language` 的说明）。
 *
 * ⚠️ 重试判据（`isRetryableSubmitError`）里的 `超时` **没有迁、也不该迁** ——
 * 它是**匹配模式**（契约 §11-6 第 10 条），行内有 `i18n-exempt` 标记说明原因。
 */

export type PlanNodeRunState = 'submitted' | 'failed' | 'skipped' | 'kept';

export interface PlanNodeRunResult {
  nodeId: string;
  state: PlanNodeRunState;
  /** `submitted` 时必有（可在视频库 / 事实图里找到它） */
  taskId?: string;
  /** 后三种状态都带原因（给人看的；`kept` 也要说清为什么没跑） */
  message?: string;
}

export interface PlanRunOutcome {
  /** 实际提交顺序（拓扑序；有环时为空数组） */
  order: string[];
  /** 有环时 = 环上的节点（**整体拒绝执行**的依据） */
  cycle: string[];
  results: PlanNodeRunResult[];
  /** 本轮用的代数（界面如实展示"第 N 轮"） */
  runSeq: number;
}

/** 等上游出片：默认 2s 一问、上限 6 分钟（云端一次出片 60~120s；本地轨远不止，所以超时是**如实失败**而不是死等） */
export const PLAN_POLL_INTERVAL_MS = 2_000;
export const PLAN_WAIT_TIMEOUT_MS = 6 * 60 * 1000;

export interface PlanRunnerDeps {
  /**
   * 提交一次生成（生产传 `submitGenerate` 的包一层；单测注入假实现）。
   *
   * `planRunId` = **本次运行的 id**（整轮运行共用同一个）—— 它是 `x-plan-run` 头的值：
   * 服务端据此把"一串节点"当成**一次有意动作**，只吃一次 60s 冷却（见 backend/security/rateLimit.ts
   * 的 `PlanRunRegistry`）。没有它，第 2 个节点起会被防线 5 挡成 429。
   */
  submit: (
    body: VideoGenerateRequest,
    idempotencyKey: string,
    planRunId: string,
  ) => Promise<{ taskId: string }>;
  /**
   * 查一条任务的状态（**等上游出片**用）。
   *
   * 为什么必须等：`task:<id>` 引用在服务端提交那一刻就会被核验 ——
   * 要求那条任务**已有可用成片**（`succeeded` + `outputVideoUrl`）。
   * 上游刚提交时还在 `queued`，直接引用会被 404 挡回（实测踩到）。
   *
   * V2.29 起它还有第二个用途：**校验"保留 / 固定"的产物是否还在**（被容量淘汰的成片
   * 不能拿来当引用 —— 那会在提交那一刻被服务端拒，不如在这里就说清）。
   */
  queryTask?: (taskId: string) => Promise<{ status: string; outputVideoUrl?: string | null }>;
  /**
   * 本轮**要重跑的节点**（B68 部分重跑）。省略 = 全部（「运行 / 重跑全部」的语义）。
   *
   * 这只是"用户点的那几个"；提交范围 = 它们 **∪ 它们的下游**（见 `planRunScope`）。
   */
  scope?: ReadonlyArray<string>;
  /** 运行 id 的时钟（可注入以便测试；默认 `Date.now`） */
  now?: () => number;
  /** 轮询间隔与等待上限（测试注入小值） */
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  /** 睡眠（测试注入立即 resolve） */
  sleep?: (ms: number) => Promise<void>;
  /**
   * 结果文案的语言（语言迁移第十批）。
   *
   * 为什么**在这层就可以注入**：结果里的那些原因（"上游没有提交成功" / "等待出片超时"…）
   * 会显示在节点卡片与运行报告上，所以它们跟着界面语言走；而这一层本就是
   * "注入驱动"的形态（`submit` / `queryTask` / `now` 全可注入），语言只是多一个注入位。
   * 缺省 `getLanguage()`（与 `canvasPlan.planNodeBlockReason` 同一手法，
   * 于是那份 **42 例**断言中文的单测一字未改 —— Node 里默认就是中文）。
   */
  language?: Language;
}

function describeThrown(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * 抛错对象里的 HTTP 状态码（能取到就取；取不到退回消息里的 `HTTP 4xx/5xx` 字面量，
 * 与 `isRetryableSubmitError` 同一口径 —— 前端拿不到统一的状态码对象）。
 */
function httpStatusOf(caught: unknown): number | null {
  if (typeof caught === 'object' && caught !== null && 'status' in caught) {
    const status = (caught as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  const match = /HTTP (\d{3})/.exec(describeThrown(caught));
  return match === null ? null : Number(match[1]);
}

const SETTLED_FAILURE = new Set(['failed', 'cancelled']);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 这次提交失败**值不值得再试一次**（B74）。
 *
 * 三条判据（都是"能不能靠重试变好"）：
 * - **`HTTP 4xx` 不重试** —— 参数被拒 / 找不到引用 / 幂等冲突，重试一百次还是同一个结果；
 *   其中**429（冷却）特意不重试**：那是防线的意思是"等一下再点"，自动重试只会连撞，
 *   界面已经如实告诉用户"请在 Xs 后重试"；
 * - `HTTP 5xx`、网络层错误（`Failed to fetch` / 超时）→ 重试；
 * - 认不出来的一律**不重试**（宁可如实失败，也不做"悄悄多花一次钱"的猜测）。
 *
 * ⚠️ 判据是错误消息里的字面量：前端拿不到 HTTP 状态码对象（`submitGenerate` 抛的是带
 * "HTTP 5xx"字样的 Error）。这条依赖写在契约里（§11-6 第 10 条），改动要一起改。
 */
export function isRetryableSubmitError(caught: unknown): boolean {
  const message = describeThrown(caught);
  if (/\bHTTP 4\d\d\b/.test(message)) return false;
  if (/\bHTTP 5\d\d\b/.test(message)) return true;
  // 要认出上游/网络层回的"超时"，该口径写在契约 §11-6 第 10 条
  // （`Failed to fetch` / 超时 / ECONN 系列）—— 改它要一起改契约。
  // i18n-exempt: 判据字面量（匹配模式），不是界面文案 —— 理由见上两行
  return /failed to fetch|network|timeout|timed out|超时|ECONNRESET|ECONNREFUSED/i.test(message);
}

/**
 * 提交（带节点级重试）。
 *
 * **重试沿用同一个幂等键**（这是 B74 最要紧的一条）：提交失败有两种 ——
 * ①请求根本没到服务端；②服务端**已经建了任务**、只是响应丢了。
 * 换键重试会把 ② 变成**重复计费**；同键重试在 ① 情况下照样新建、在 ② 情况下幂等命中同一条。
 * 所以重试**不换键**（换键是"显式重跑"才有的动作）。
 */
async function submitWithRetry(
  deps: PlanRunnerDeps,
  node: CanvasPlanNode,
  body: VideoGenerateRequest,
  idempotencyKey: string,
  planRunId: string,
): Promise<{ taskId: string }> {
  const maxAttempts = node.retry?.maxAttempts ?? 1;
  const backoffMs = node.retry?.backoffMs ?? PLAN_RETRY_DEFAULT_BACKOFF_MS;
  const sleep = deps.sleep ?? defaultSleep;

  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await deps.submit(body, idempotencyKey, planRunId);
    } catch (caught) {
      last = caught;
      if (attempt >= maxAttempts || !isRetryableSubmitError(caught)) break;
      await sleep(backoffMs);
    }
  }
  throw last;
}

/**
 * 等一条任务走到"有可用成片"（`succeeded` + `outputVideoUrl`）。
 *
 * 三态如实：成功 / 失败（终态但没有成片）/ 超时 —— 后两者都返回 `ok: false` + **给人看的原因**，
 * 调用方据此把下游标成 `skipped`（而不是带着一条不存在的成片去提交）。
 *
 * V2.35（A5 片 B 收口）补第四态：**查询本身失败**（最典型的是"这条任务在本服务上不存在" ——
 * 导入的编排会带来这种引用）。它同样返回 `ok: false` + 可执行原因，**不抛异常**：
 * 抛出去会把整轮运行中断成"运行失败：HTTP 404"，那对用户既看不懂也做不了下一步。
 */
async function waitForTaskReady(
  taskId: string,
  deps: PlanRunnerDeps,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (deps.queryTask === undefined) return { ok: true }; // 未注入 = 不做等待（老调用方的零改动路径）

  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const interval = deps.pollIntervalMs ?? PLAN_POLL_INTERVAL_MS;
  const deadline = now() + (deps.waitTimeoutMs ?? PLAN_WAIT_TIMEOUT_MS);
  const short = taskId.slice(0, 8);
  const lang = deps.language ?? getLanguage();

  for (;;) {
    let task: { status: string; outputVideoUrl?: string | null };
    try {
      task = await deps.queryTask(taskId);
    } catch (caught) {
      /**
       * V2.35（A5 片 B 收口）：**查不到 / 查不动**时如实跳过，而不是让异常冒出去把整轮运行中断。
       *
       * 中断的形态是"运行失败：HTTP 404"—— 用户既看不懂、也做不了下一步；而这条分支在
       * **导入的编排**上必然遇到（文件里记着来源机器的产物 ID，本部署里没有那条任务）。
       * 4xx（不存在 / 查不动那些记录）给"重跑这一段"的可执行下一步；其它（网络 / 5xx）如实说清是查询失败。
       */
      const status = httpStatusOf(caught);
      return {
        ok: false,
        message:
          status === 404
            ? translate(lang, 'canvas.run.upstreamMissing', { short })
            : translate(lang, 'canvas.run.upstreamQueryFailed', {
                short,
                reason: describeThrown(caught),
              }),
      };
    }
    if (task.status === 'succeeded') {
      if (typeof task.outputVideoUrl === 'string' && task.outputVideoUrl !== '') return { ok: true };
      return { ok: false, message: translate(lang, 'canvas.run.upstreamNoOutput', { short }) };
    }
    if (SETTLED_FAILURE.has(task.status)) {
      return {
        ok: false,
        message: translate(lang, 'canvas.run.upstreamFailed', { short, status: task.status }),
      };
    }
    if (now() >= deadline) {
      return { ok: false, message: translate(lang, 'canvas.run.upstreamTimeout', { short }) };
    }
    await sleep(interval);
  }
}

export async function runCanvasPlan(plan: CanvasPlan, deps: PlanRunnerDeps): Promise<PlanRunOutcome> {
  const { order, cycle } = planExecutionOrder(plan);
  const runSeq = planRunSeq(plan);
  if (cycle.length > 0) return { order: [], cycle, results: [], runSeq };

  const scope = planRunScope(plan, deps.scope);
  // 本轮运行的 id（**整轮共用一个**）：服务端按它豁免"同一次动作内"的重复冷却。
  // 它**不带代数**：代数只影响幂等键；而"一次点击"本来就有自己的 `now`，
  // 两轮运行的 runId 天然不同（早先写过带代数的版本，改了格式却没有任何收益 —— 已回退）。
  const planRunId = `${plan.id}-${(deps.now ?? Date.now)()}`;
  const lang = deps.language ?? getLanguage();
  const results: PlanNodeRunResult[] = [];
  const taskIdByNode = new Map<string, string>();

  for (const nodeId of order) {
    const node = plan.nodes.find((item) => item.id === nodeId);
    if (node === undefined) continue; // 防御：order 来自同一份 plan，理论上不会缺

    // ① 本轮不提交的两种情形（部分重跑的范围外 / 被固定）
    if (!scope.submit.has(nodeId)) {
      results.push({
        nodeId,
        state: 'kept',
        message: translate(
          lang,
          scope.pinnedOverride.has(nodeId) ? 'canvas.run.keptPinned' : 'canvas.run.keptOutOfScope',
        ),
      });
      continue;
    }

    const blocked = planNodeBlockReason(plan, nodeId);
    if (blocked !== null) {
      results.push({ nodeId, state: 'skipped', message: blocked });
      continue;
    }

    // `planNodeBlockReason` 已保证入边 ≤ 1 条；这里取那一条（v2v 的数据流来源）
    const upstreamId = planIncomingEdges(plan, nodeId)[0]?.from;
    let upstreamTaskId: string | undefined;
    if (upstreamId !== undefined) {
      const upstreamNode = plan.nodes.find((item) => item.id === upstreamId);
      const submitted = taskIdByNode.get(upstreamId);
      const triedThisRun = scope.submit.has(upstreamId);

      // ⚠️ 这里**不能**写成 `submitted ?? planRetainedTaskId(upstreamNode)`：
      // 上游本轮**试过但失败了**、而它上一轮的产物还在时，那样写会让下游**悄悄接在旧产物上跑** ——
      // 用户会以为"下游是按新上游出的"，实际不是。所以：本轮试过且没成功 → 一律跳过。
      const ref =
        submitted ??
        (triedThisRun || upstreamNode === undefined ? null : planRetainedTaskId(upstreamNode));

      if (ref === null) {
        results.push({
          nodeId,
          state: 'skipped',
          message: translate(
            lang,
            triedThisRun ? 'canvas.run.upstreamNotSubmitted' : 'canvas.run.upstreamNoRecord',
          ),
        });
        continue;
      }
      // 等上游出片：`task:` 引用在服务端要求"已有可用成片"（否则下游提交必然 404）
      const ready = await waitForTaskReady(ref, deps);
      if (!ready.ok) {
        results.push({ nodeId, state: 'skipped', message: ready.message });
        continue;
      }
      upstreamTaskId = ref;
    }

    try {
      const { taskId } = await submitWithRetry(
        deps,
        node,
        toGenerateRequest(node, upstreamTaskId),
        planIdempotencyKey(plan.id, nodeId, runSeq),
        planRunId,
      );
      taskIdByNode.set(nodeId, taskId);
      results.push({ nodeId, state: 'submitted', taskId });
    } catch (caught) {
      results.push({ nodeId, state: 'failed', message: describeThrown(caught) });
    }
  }

  return { order, cycle: [], results, runSeq };
}
