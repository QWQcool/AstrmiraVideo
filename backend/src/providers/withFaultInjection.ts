import { setTimeout as sleep } from 'node:timers/promises';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { ProviderFailureError } from '../errors.js';

/**
 * 开发期故障注入层（PLAN §4「Step 2 补充」/ 决策 D13）。
 *
 * 位置：provider 与调度器**之间**的薄包装（`withFaultInjection(provider, plan)`）。
 * 为什么要真包装而不是 mock：`stream_cut` / `disk_full` 要验的是**真实调用链上的中断与半包**，
 * mock 不产生真实文件、真实进度与真实落盘，验不到对象本身。
 *
 * 安全闸：默认关闭（`FAULT_INJECT !== '1'` 时原样返回）；
 * **生产环境挂载直接抛错**（启动即拒绝，不留"误开"的可能）。
 */

export const FAULT_KINDS = [
  'delay', // 前端轮询进度与超时表现
  'rate_limit', // 防线 5：限流与前端冷却
  'upstream_5xx', // UPSTREAM_ERROR 的有限退避
  'stream_cut', // 下载中断 / 半包
  'disk_full', // DISK_FULL 分支与清理提示
  'slow_progress', // 进度推进与刷新重挂载（防线 2）
  'uncertain', // 防线 7：UNCERTAIN_RESULT 不自动重提
] as const;

export type FaultKind = (typeof FAULT_KINDS)[number];

export interface FaultPlan {
  kind: FaultKind;
  /** `delay`：注入的毫秒数 */
  ms?: number;
  /** `stream_cut`：在进度的百分之几处中断（默认 40） */
  atPercent?: number;
  /** `slow_progress`：分几步推进（默认 3） */
  steps?: number;
}

export function isFaultKind(value: unknown): value is FaultKind {
  return typeof value === 'string' && (FAULT_KINDS as readonly string[]).includes(value);
}

/** 包装 provider 注入指定故障；调用方负责保证只在开发期挂载 */
export function withFaultInjection(provider: VideoProvider, plan: FaultPlan): VideoProvider {
  /** `slow_progress` 的已轮询次数 */
  let pollCount = 0;
  /** `stream_cut` 是否已在"下载中断"处抛出过 */
  let streamCutFired = false;

  const atPercent = plan.atPercent ?? 40;

  return {
    id: provider.id,
    name: `${provider.name}（故障注入：${plan.kind}）`,

    checkHealth: () => provider.checkHealth(),

    async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
      switch (plan.kind) {
        case 'rate_limit':
          // 限流发生在触达上游**之前**（不产生上游调用）
          throw new ProviderFailureError('RATE_LIMITED', '注入：60s 防抖窗口内重复提交');
        case 'disk_full':
          throw new ProviderFailureError('DISK_FULL', '注入：输出目录磁盘空间不足');
        case 'delay': {
          await sleep(plan.ms ?? 2000);
          break;
        }
        default:
          break;
      }

      const submitted = await provider.submit(request);

      if (plan.kind === 'uncertain') {
        // 已提交上游、但结果无法确认（禁止自动重提）
        throw new ProviderFailureError(
          'UNCERTAIN_RESULT',
          '注入：已提交上游但无响应，结果不明',
        );
      }

      if (plan.kind === 'upstream_5xx') {
        // 上游**明确返回**错误（有响应体可读）→ 属 UPSTREAM_ERROR
        throw new ProviderFailureError('UPSTREAM_ERROR', '注入：上游返回 502 Bad Gateway');
      }

      return submitted;
    },

    async queryStatus(taskId: string): Promise<TaskProgress> {
      switch (plan.kind) {
        case 'stream_cut':
          if (!streamCutFired) {
            streamCutFired = true;
            throw new ProviderFailureError(
              'UNCERTAIN_RESULT',
              `注入：下载在 ${atPercent}% 处中断（半包）`,
            );
          }
          break;
        case 'upstream_5xx':
          throw new ProviderFailureError('UPSTREAM_ERROR', '注入：轮询时上游返回 500');
        case 'slow_progress': {
          const total = plan.steps ?? 3;
          pollCount += 1;
          if (pollCount <= total) {
            return {
              taskId,
              status: 'running',
              progressPercent: Math.round((pollCount / (total + 1)) * 100),
              requestSnapshot: { prompt: '', mode: 't2v', aspectRatio: '16:9', provider: provider.id },
              message: `注入：进度推进中（${pollCount}/${total}）`,
            };
          }
          break;
        }
        default:
          break;
      }

      return provider.queryStatus(taskId);
    },

    cancel: (taskId: string) => provider.cancel(taskId),
  };
}

/**
 * 从 env 解析故障计划（手工联调用）。
 * `FAULT_INJECT=1` 但缺 `FAULT_KIND`（或非法）时**显式报错**，不猜默认值。
 */
export function resolveFaultPlanFromEnv(env: NodeJS.ProcessEnv = process.env): FaultPlan | null {
  if (env.FAULT_INJECT !== '1') return null;

  if (!isFaultKind(env.FAULT_KIND)) {
    throw new Error(
      `FAULT_INJECT=1 但 FAULT_KIND 非法或缺省（可选值：${FAULT_KINDS.join(' / ')}）`,
    );
  }

  return {
    kind: env.FAULT_KIND,
    ms: env.FAULT_DELAY_MS === undefined ? undefined : Number(env.FAULT_DELAY_MS),
    atPercent: env.FAULT_AT_PERCENT === undefined ? undefined : Number(env.FAULT_AT_PERCENT),
    steps: env.FAULT_STEPS === undefined ? undefined : Number(env.FAULT_STEPS),
  };
}

/**
 * 带安全闸的挂载：生产环境**直接抛错**（启动即拒绝），开发/测试环境正常包装。
 */
export function createFaultInjectedProvider(
  provider: VideoProvider,
  plan: FaultPlan,
  env: NodeJS.ProcessEnv = process.env,
): VideoProvider {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      '故障注入层禁止在生产环境挂载（PLAN §4「Step 2 补充」）：请检查 FAULT_INJECT / NODE_ENV',
    );
  }
  return withFaultInjection(provider, plan);
}
