import { z } from 'zod';

/**
 * 可观测与 SLA 基线（V2.16 / 台账 B53，契约 §16）。
 *
 * ## 它解决什么
 * 私有化交付后，"服务是不是还行"必须有**可查的数字**，而不是"客户说卡"。本模块给出：
 * ① **live / ready 分级**（进程活着 ≠ 能干活 —— 现有 `/api/health` 只回答前者，且不碰数据库）；
 * ② 一份 `GET /api/metrics` 快照（队列 / 任务 / 存储 / 数据库 / Webhook / 成本口径）；
 * ③ **阈值告警的判定规则**（纯函数，可单测；告警不发明新的外发通道，先在快照与运维面板里可见）。
 *
 * ## 三条口径（都是"不假装"）
 * 1. **live 永远快且不碰依赖**：探针若在数据库卡住时也变慢，编排器会把它当成"进程死了"并重启 ——
 *    那会把"依赖故障"放大成"服务不可用"。
 * 2. **ready 必须真做一次**：磁盘要**真写一个临时文件**再删（"能不能写"只有写过才知道，
 *    与"上游链路要真发一次请求"同一条纪律）。
 * 3. **告警给的是"越线的事实"**，不是"建议"：每条带 `value` 与 `threshold`（可复核），
 *    没越线就**不出现**（噪声纪律 —— 常年挂着一条 info 的告警等于没有告警）。
 */

// ── 阈值（默认值；部署可用 env 覆盖，见 CONTRACT §16 的 METRICS_* 变量）──────

export const METRICS_DEFAULTS = {
  /** 存储用量比例 ≥ 此值 → warn */
  storageWarnRatio: 0.85,
  /** 存储用量比例 ≥ 此值 → critical（淘汰器会开始删最旧的成片） */
  storageCriticalRatio: 0.95,
  /** 存在超过此秒数仍未投出去的 Webhook → warn（客户系统可能挂了） */
  webhookPendingWarnSec: 300,
  /** 永久失败的 Webhook 投递 ≥ 此值 → warn */
  webhookFailedWarnCount: 1,
  /** 任务 running 超过此秒数 → warn（上游挂住 / 本地推理卡死） */
  taskStuckWarnSec: 1_800,
  /** 数据库文件 ≥ 此值 → warn（日志与任务表长期增长） */
  databaseWarnBytes: 512 * 1024 * 1024,
} as const;

export const AlertSeveritySchema = z.enum(['info', 'warn', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const SystemAlertSchema = z.object({
  /** 稳定 id（同一类越线只产生一条；界面与巡检脚本按它去重） */
  id: z.string(),
  severity: AlertSeveritySchema,
  title: z.string(),
  detail: z.string(),
  /** 实测值（可复核；无意义时为 null） */
  value: z.number().nullable(),
  /** 触发阈值（可复核；无意义时为 null） */
  threshold: z.number().nullable(),
});
export type SystemAlert = z.infer<typeof SystemAlertSchema>;

export interface AlertInputs {
  storageUsageRatio: number;
  storageOverThreshold: boolean;
  webhookPending: number;
  webhookOldestPendingSec: number | null;
  webhookFailed: number;
  runningTasks: number;
  oldestRunningSec: number | null;
  databaseBytes: number;
}

export type MetricsThresholds = {
  -readonly [K in keyof typeof METRICS_DEFAULTS]: number;
};

export function resolveThresholds(
  overrides: Partial<MetricsThresholds> = {},
): MetricsThresholds {
  const result = { ...METRICS_DEFAULTS } as MetricsThresholds;
  for (const key of Object.keys(METRICS_DEFAULTS) as Array<keyof MetricsThresholds>) {
    const value = overrides[key];
    // 只接受有限数：坏 env（空串 / NaN）**不覆盖**默认值（否则一个手误就让告警永远不响）
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = value;
  }
  return result;
}

/** env 变量名 ↔ 阈值键（**一处定义**：文档、`.env.example`、解析都从这里来） */
export const METRICS_ENV_KEYS: Record<keyof MetricsThresholds, string> = {
  storageWarnRatio: 'METRICS_STORAGE_WARN_RATIO',
  storageCriticalRatio: 'METRICS_STORAGE_CRITICAL_RATIO',
  webhookPendingWarnSec: 'METRICS_WEBHOOK_PENDING_WARN_SEC',
  webhookFailedWarnCount: 'METRICS_WEBHOOK_FAILED_WARN_COUNT',
  taskStuckWarnSec: 'METRICS_TASK_STUCK_WARN_SEC',
  databaseWarnBytes: 'METRICS_DATABASE_WARN_BYTES',
};

/**
 * 从 env 读阈值覆盖。坏值（空串 / 非数字 / 负数）**静默忽略**并回落默认 ——
 * 这里不报错是有意的：告警阈值配错不该让服务起不来，但**也不能悄悄变成 0**（那会让告警永远不响）。
 */
export function readThresholdsFromEnv(
  env: Record<string, string | undefined>,
): Partial<MetricsThresholds> {
  const overrides: Partial<MetricsThresholds> = {};
  for (const key of Object.keys(METRICS_ENV_KEYS) as Array<keyof MetricsThresholds>) {
    const raw = env[METRICS_ENV_KEYS[key]];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) overrides[key] = parsed;
  }
  return overrides;
}

/**
 * 纯函数：把实测值翻译成告警列表。**没越线就不出现**（噪声纪律）。
 * 顺序 = 严重程度优先（critical 先），便于界面与巡检脚本"从头读最重要的一条"。
 */
export function buildAlerts(
  input: AlertInputs,
  thresholds: MetricsThresholds = resolveThresholds(),
): SystemAlert[] {
  const alerts: SystemAlert[] = [];

  if (input.storageUsageRatio >= thresholds.storageCriticalRatio || input.storageOverThreshold) {
    alerts.push({
      id: 'storage.critical',
      severity: 'critical',
      title: '存储即将压满',
      detail: '容量淘汰器已按最旧的成片开始删（历史与血缘保留）。建议清理或调大 OUTPUTS_MAX_BYTES。',
      value: Number(input.storageUsageRatio.toFixed(4)),
      threshold: thresholds.storageCriticalRatio,
    });
  } else if (input.storageUsageRatio >= thresholds.storageWarnRatio) {
    alerts.push({
      id: 'storage.warn',
      severity: 'warn',
      title: '存储用量偏高',
      detail: '接近淘汰阈值，成片随时可能被淘汰（任务记录与血缘不受影响）。',
      value: Number(input.storageUsageRatio.toFixed(4)),
      threshold: thresholds.storageWarnRatio,
    });
  }

  if (input.webhookFailed >= thresholds.webhookFailedWarnCount) {
    alerts.push({
      id: 'webhook.failed',
      severity: 'warn',
      title: 'Webhook 有永久失败的投递',
      detail: '重试用尽仍未成功（客户系统长时间不可用）。客户系统需自己拉历史补。',
      value: input.webhookFailed,
      threshold: thresholds.webhookFailedWarnCount,
    });
  }

  if (
    input.webhookOldestPendingSec !== null &&
    input.webhookOldestPendingSec >= thresholds.webhookPendingWarnSec
  ) {
    alerts.push({
      id: 'webhook.pending',
      severity: 'warn',
      title: 'Webhook 投递积压',
      detail: '存在长时间未投出去的终态事件 —— 客户系统可能已宕机。',
      value: Math.round(input.webhookOldestPendingSec),
      threshold: thresholds.webhookPendingWarnSec,
    });
  }

  if (
    input.oldestRunningSec !== null &&
    input.oldestRunningSec >= thresholds.taskStuckWarnSec &&
    input.runningTasks > 0
  ) {
    alerts.push({
      id: 'task.stuck',
      severity: 'warn',
      title: '有任务长时间停在运行中',
      detail: '可能是上游挂住或本地推理卡死；终态不明时不要盲目重提（会重复计费）。',
      value: Math.round(input.oldestRunningSec),
      threshold: thresholds.taskStuckWarnSec,
    });
  }

  if (input.databaseBytes >= thresholds.databaseWarnBytes) {
    alerts.push({
      id: 'database.size',
      severity: 'warn',
      title: '数据库文件偏大',
      detail: '任务表与操作日志长期增长。可清理操作日志（日志页）或归档历史任务。',
      value: input.databaseBytes,
      threshold: thresholds.databaseWarnBytes,
    });
  }

  const rank: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ── live / ready 分级 ──────────────────────────────────────────────────────

export const MetricCheckSchema = z.object({
  id: z.string(),
  ok: z.boolean(),
  /** true = 它不通过则整机 not ready；false = 只如实陈述（如凭据缺失，BYOK 部署下不算故障） */
  required: z.boolean(),
  detail: z.string(),
});
export type MetricCheck = z.infer<typeof MetricCheckSchema>;

/**
 * 纯函数：`required` 里有不通过 → `degraded`（端点回 **503**，编排器停止导流）。
 * **非 required 的不通过不降级** —— 否则 BYOK 部署（服务端没有 Key）会被误判为不健康。
 */
export function summarizeReadiness(checks: MetricCheck[]): 'ready' | 'degraded' {
  return checks.some((check) => check.required && !check.ok) ? 'degraded' : 'ready';
}

export const HealthLiveResponseSchema = z.object({
  status: z.literal('ok'),
  name: z.string(),
  version: z.string(),
  timestamp: z.string(),
  uptimeSec: z.number(),
});
export type HealthLiveResponse = z.infer<typeof HealthLiveResponseSchema>;

export const HealthReadyResponseSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  timestamp: z.string(),
  version: z.string(),
  checks: z.array(MetricCheckSchema),
});
export type HealthReadyResponse = z.infer<typeof HealthReadyResponseSchema>;

// ── 指标快照 ───────────────────────────────────────────────────────────────

export const MetricsResponseSchema = z.object({
  generatedAt: z.number().int(),
  uptimeSec: z.number(),
  /** ok = 无告警；degraded = 至少一条 warn/critical（**不是**"进程不健康"） */
  status: z.enum(['ok', 'degraded']),
  service: z.object({
    name: z.string(),
    version: z.string(),
    nodeVersion: z.string(),
    pid: z.number().int(),
    cpuCount: z.number().int(),
    rssBytes: z.number(),
    heapUsedBytes: z.number(),
  }),
  tasks: z.object({
    byStatus: z.record(z.string(), z.number().int()),
    running: z.object({ cloud: z.number().int(), local: z.number().int() }),
    /** `disposition='uncertain'`：可能已产生费用（与 §13 同一口径） */
    uncertain: z.number().int(),
    window24h: z.object({
      succeeded: z.number().int(),
      failed: z.number().int(),
      total: z.number().int(),
    }),
  }),
  queue: z.object({
    queued: z.number().int(),
    running: z.number().int(),
    oldestQueuedAgeSec: z.number().nullable(),
  }),
  storage: z.object({
    totalBytes: z.number(),
    videoBytes: z.number(),
    thumbBytes: z.number(),
    assetBytes: z.number(),
    maxBytes: z.number(),
    usageRatio: z.number(),
    overThreshold: z.boolean(),
  }),
  /** 只给体积，**不给路径**（路径属部署信息，快照可能被贴进工单里） */
  database: z.object({
    fileBytes: z.number(),
    walBytes: z.number(),
  }),
  webhooks: z.object({
    enabled: z.number().int(),
    pending: z.number().int(),
    failed: z.number().int(),
    oldestPendingAgeSec: z.number().nullable(),
  }),
  alerts: z.array(SystemAlertSchema),
  thresholds: z.record(z.string(), z.number()),
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

/** 快照整体判定：有告警 = degraded（只描述"有事发生"，不描述进程健康） */
export function summarizeMetricsStatus(alerts: SystemAlert[]): 'ok' | 'degraded' {
  return alerts.length === 0 ? 'ok' : 'degraded';
}
