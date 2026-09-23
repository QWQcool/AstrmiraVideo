import type { EventLogEntry, StorageUsage, TaskProgress } from '@astrmira/shared';

/**
 * 总览页的**聚合纯函数**（V9 · B3）。
 *
 * 三条口径纪律（Step 6-AC2："不许出现算不出来的指标"）：
 * 1. 每个数字都能在界面上说清**它算的是什么**（分母是"最近 50 条里的终态任务"，
 *    不是"全部历史"——`/api/history` 只给最近 50 条，假装是全部就是撒谎）；
 * 2. **除零要显式**：没有终态任务时成功率返回 `null` 而不是 0（0% 与"还没有数据"是两回事）；
 * 3. 时间一律用**本地时区**的日界（"今日"对用户而言就是他的今天）。
 *
 * 放在 `lib/` 而不是组件里：这四卡最容易悄悄算错（改一行就偏一个数量级），
 * 纯函数才能被单测钉住（`overviewStats.test.ts`）。
 */

export interface OverviewStats {
  /** 今日生成的条数（`createdAt >= 本地今日 0:00`） */
  todayCount: number;
  /** 成功率；**没有终态任务时为 `null`**（不是 0） */
  successRate: number | null;
  /** 终态任务数（成功率的分母） */
  settledCount: number;
  /** 队列中：`queued` + `running` */
  inFlight: number;
  /** 存储占用（目录级聚合，来自响应里的 `storage`） */
  storage: StorageUsage;
}

const SETTLED: ReadonlySet<TaskProgress['status']> = new Set(['succeeded', 'failed', 'cancelled']);

/** 本地时区下"今天 0:00"的时间戳 */
export function startOfToday(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function computeOverviewStats(
  items: readonly TaskProgress[],
  storage: StorageUsage,
  now: number,
): OverviewStats {
  const dayStart = startOfToday(now);

  let todayCount = 0;
  let inFlight = 0;
  let succeeded = 0;
  let settledCount = 0;

  for (const item of items) {
    if (item.createdAt >= dayStart) todayCount += 1;
    if (item.status === 'queued' || item.status === 'running') inFlight += 1;
    if (SETTLED.has(item.status)) {
      settledCount += 1;
      if (item.status === 'succeeded') succeeded += 1;
    }
  }

  return {
    todayCount,
    successRate: settledCount === 0 ? null : succeeded / settledCount,
    settledCount,
    inFlight,
    storage,
  };
}

export interface RecentShot {
  taskId: string;
  createdAt: number;
  /** 缩略图（可能缺：抽帧失败 / 旧记录）——缺时界面回落为占位块，不挂 <video> */
  thumbnailUrl?: string;
  /** 时长文案（来自请求快照的 `params.durationSec`；快照里没有就不显示） */
  durationLabel?: string;
  mode: TaskProgress['requestSnapshot']['mode'];
}

/** 最近的成片（只要 `succeeded` 且有成片地址），按 `createdAt` 降序 */
export function recentShots(items: readonly TaskProgress[], limit = 9): RecentShot[] {
  return items
    .filter((item) => item.status === 'succeeded' && item.outputVideoUrl !== undefined)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((item) => {
      const seconds = item.requestSnapshot.params?.durationSec;
      return {
        taskId: item.taskId,
        createdAt: item.createdAt,
        mode: item.requestSnapshot.mode,
        ...(item.thumbnailUrl === undefined ? {} : { thumbnailUrl: item.thumbnailUrl }),
        ...(seconds === undefined ? {} : { durationLabel: `${seconds}s` }),
      };
    });
}

export type FeedTone = 'ok' | 'warn' | 'bad';

export interface FeedEntry {
  id: number;
  ts: number;
  /** 中文动作名（由调用方用 `logActionLabel` 译好传入，避免这里依赖 i18n 细节） */
  label: string;
  tone: FeedTone;
  path: string;
  taskId?: string;
  errorCode?: string;
}

/**
 * 状态码 → 色点。口径与日志页一致：
 * 5xx / 有错误码 = bad；4xx（限流、拒收）= warn；其余 ok。
 */
function toneOf(entry: EventLogEntry): FeedTone {
  if (entry.errorCode !== undefined) return entry.statusCode !== undefined && entry.statusCode < 500 ? 'warn' : 'bad';
  const status = entry.statusCode;
  if (status === undefined) return 'ok';
  if (status >= 500) return 'bad';
  if (status >= 400) return 'warn';
  return 'ok';
}

/** 最近操作 feed：按时间降序、取前 `limit` 条 */
export function buildActivityFeed(
  entries: readonly EventLogEntry[],
  labelOf: (action: string | undefined) => string,
  limit = 6,
): FeedEntry[] {
  return entries
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      ts: entry.ts,
      label: labelOf(entry.action),
      tone: toneOf(entry),
      path: entry.path,
      ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
      ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
    }));
}

/** 字节数 → 人类可读（总览"存储占用"卡用；MB 以下不给小数，避免"0.0 GB"这种噪声） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

/** 相对时间（feed 用）：刚刚 / N 分钟前 / N 小时前 / MM-DD HH:mm */
export function formatRelativeTime(ts: number, now: number): string {
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
