import type { EventLogStore } from '../store/eventLog.js';

/**
 * 操作日志的保留策略（V2.18 / 台账 B23）。
 *
 * ## 为什么现在做（而不是"等库大了再说"）
 * 操作日志**只增不删**是 V2.1 起的有意设计（"由你手动删"）—— 对个人使用完全够用；
 * 但私有化部署会**长跑数月**，而 B53 刚加的 `database.size` 告警（库 + WAL ≥ 512MB）会**先响**。
 * 与其让运维收到一条"数据库偏大"的告警然后手工去日志页点"清空"，不如把保留策略做出来、说清楚。
 *
 * ## 四条口径
 * 1. **只删操作日志**（`event_log`）。任务 / 项目 / Webhook 流水是业务数据，一条都不动 ——
 *    这是"保留策略"与"数据清理"的分界线，也是本模块只依赖 `EventLogStore.prune` 的原因；
 * 2. **两条判据各自可关**（`LOG_RETENTION_DAYS=0` / `LOG_MAX_ROWS=0`）：**0 = 关掉这条判据**，
 *    而不是"当作没配"（后者会让"我想只按时间保留"变成不可能）；
 * 3. **两条都关 → 启动时给出警告**：那等于回到"无限增长"，它会先把磁盘吃掉的是日志不是成片；
 * 4. **真删了才留痕**（`log.prune` 操作日志）：与容量淘汰（`storage.evict`）同一条噪声纪律 ——
 *    没删就不写。留痕里带**删了多少、按哪条判据删的、现在还剩多少**（这是"日志怎么少了"的答案）。
 */

export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_MAX_ROWS = 200_000;
/** 每天一次就够：保留策略是"慢性"治理，跑得比写入频率还密只是浪费 */
export const DEFAULT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  maxAgeDays: number;
  maxRows: number;
}

export interface PruneOutcome extends RetentionPolicy {
  deleted: number;
  remaining: number;
  deletedByAge: number;
  deletedByCount: number;
}

export interface LogRetentionOptions {
  /** `countAll` 是"关闭保留策略时也要能如实报出日志在涨"用的 */
  store: Pick<EventLogStore, 'prune' | 'countAll'>;
  policy?: Partial<RetentionPolicy>;
  intervalMs?: number;
  now?: () => number;
  /** 真删了才回调（调用方在这里写 `log.prune` 操作日志） */
  onPrune?: (outcome: PruneOutcome) => void;
  onError?: (error: unknown) => void;
}

export interface LogRetentionHandle {
  stop(): void;
  /** 等在飞的一轮结束（关库前必须调，与 capacity 淘汰器同一纪律） */
  drain(): Promise<void>;
  runOnce(): Promise<PruneOutcome>;
  policy(): RetentionPolicy;
}

/** 读 env 里的数字（空串/非数字 → 用默认值；**0 是合法值** = 关掉该判据） */
function readCount(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function resolveRetentionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): RetentionPolicy {
  return {
    maxAgeDays: readCount(env['LOG_RETENTION_DAYS'], DEFAULT_RETENTION_DAYS),
    maxRows: readCount(env['LOG_MAX_ROWS'], DEFAULT_MAX_ROWS),
  };
}

export function isRetentionDisabled(policy: RetentionPolicy): boolean {
  return policy.maxAgeDays <= 0 && policy.maxRows <= 0;
}

export function startLogRetention(options: LogRetentionOptions): LogRetentionHandle {
  const defaultPolicy: RetentionPolicy = {
    maxAgeDays: DEFAULT_RETENTION_DAYS,
    maxRows: DEFAULT_MAX_ROWS,
  };
  const resolved: RetentionPolicy = { ...defaultPolicy, ...options.policy };

  const now = (): number => options.now?.() ?? Date.now();
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<PruneOutcome> | null = null;

  const runOnce = async (): Promise<PruneOutcome> => {
    if (isRetentionDisabled(resolved)) {
      // 两条判据都关：什么都不删，但**仍然查一次真实条数** —— 那是"日志正在无限增长"的证据，
      // 返回 0 会把"没在长"与"没统计"混成一样（顶层会在启动时警告，这条路径给运维看实况）。
      return {
        ...resolved,
        deleted: 0,
        remaining: options.store.countAll(),
        deletedByAge: 0,
        deletedByCount: 0,
      };
    }
    const outcome: PruneOutcome = {
      ...resolved,
      ...options.store.prune({
        maxAgeDays: resolved.maxAgeDays,
        maxRows: resolved.maxRows,
        now: now(),
      }),
    };
    if (outcome.deleted > 0) options.onPrune?.(outcome);
    return outcome;
  };

  const tick = (): void => {
    if (inFlight !== null) return; // 单飞：上一轮没跑完就不开新的一轮
    inFlight = runOnce()
      .catch((error: unknown) => {
        options.onError?.(error);
        return {
          ...resolved,
          deleted: 0,
          remaining: options.store.countAll(),
          deletedByAge: 0,
          deletedByCount: 0,
        } satisfies PruneOutcome;
      })
      .finally(() => {
        inFlight = null;
      });
  };

  // 启动时先跑一次（长跑部署重启后立刻把该清的清掉），之后按间隔跑
  tick();
  timer = setInterval(tick, options.intervalMs ?? DEFAULT_PRUNE_INTERVAL_MS);
  timer.unref?.();

  return {
    stop: () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    drain: async () => {
      if (inFlight !== null) await inFlight;
    },
    runOnce: async () => {
      if (inFlight !== null) return inFlight;
      inFlight = runOnce().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    policy: () => ({ ...resolved }),
  };
}
