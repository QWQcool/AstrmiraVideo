import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildAlerts,
  resolveThresholds,
  summarizeMetricsStatus,
  type MetricsResponse,
  type MetricsThresholds,
  type MetricCheck,
  type StorageUsage,
} from '@astrmira/shared';
import { readStorageUsage } from '../server/storageUsage.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../version.js';
import type { TaskStore } from '../store/taskStore.js';

/**
 * 可观测采集器（V2.16 / 台账 B53，契约 §16）。
 *
 * ## 为什么单独一层、而不是把查询散在路由里
 * `GET /api/metrics` 要串起四个存储（任务 / 投递 / 目录 / 数据库文件），"少查一处"
 * 或"同一个数字两处算法不同"是最容易发生的事。这里把它们收在一处，路由只负责序列化。
 *
 * ## 一次采集的代价
 * 目录扫描（`readStorageUsage`）是唯一的重活：本项目规模下是毫秒级（见 storageUsage 的注释），
 * 但仍有必要说清 —— 所以**快照不做自动轮询**（契约 §16：调用方自己决定频率，默认建议 15s~60s）。
 */

export interface ObservabilityDeps {
  tasks: Pick<
    TaskStore,
    | 'countByStatus'
    | 'countRunning'
    | 'countUncertain'
    | 'oldestCreatedAt'
    | 'databaseFileBytes'
  >;
  outputsDir: string;
  /** 存储触发阈值（与淘汰器共用 `resolveOutputsMaxBytes`） */
  maxBytes: number;
  thresholds?: MetricsThresholds;
  now?: () => number;
  /** 进程信息（测试注入，避免断言真实内存） */
  processInfo?: {
    nodeVersion: string;
    pid: number;
    cpuCount: number;
    rssBytes: number;
    heapUsedBytes: number;
    uptimeSec: number;
  };
  /** 测试注入：存储用量（默认扫目录） */
  readStorage?: (dir: string) => Promise<StorageUsage>;
  /** 测试注入：媒体工具自检 */
  checkMediaTools?: () => Promise<{ ok: boolean; detail: string }>;
}

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

function processInfo(): NonNullable<ObservabilityDeps['processInfo']> {
  const memory = process.memoryUsage();
  return {
    nodeVersion: process.version,
    pid: process.pid,
    // `availableParallelism` 在部分 @types/node 版本里没声明 —— 用 os 模块（行为一致、类型确定）
    cpuCount: os.availableParallelism?.() ?? os.cpus().length,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    uptimeSec: Math.round(process.uptime()),
  };
}

export async function collectMetrics(deps: ObservabilityDeps): Promise<MetricsResponse> {
  const now = deps.now?.() ?? Date.now();
  const thresholds = deps.thresholds ?? resolveThresholds();
  const readStorage = deps.readStorage ?? readStorageUsage;
  const info = deps.processInfo ?? processInfo();

  const byStatus = deps.tasks.countByStatus();
  const window = deps.tasks.countByStatus({ since: now - WINDOW_24H_MS });
  const storage = await readStorage(deps.outputsDir);
  const dbBytes = deps.tasks.databaseFileBytes();

  const oldestQueuedAt = deps.tasks.oldestCreatedAt('queued');
  const oldestRunningAt = deps.tasks.oldestCreatedAt('running');
  const runningTasks = byStatus.running;

  const alerts = buildAlerts(
    {
      storageUsageRatio: deps.maxBytes > 0 ? storage.totalBytes / deps.maxBytes : 0,
      storageOverThreshold: storage.totalBytes > deps.maxBytes,
      runningTasks,
      oldestRunningSec: oldestRunningAt === null ? null : (now - oldestRunningAt) / 1000,
      databaseBytes: dbBytes.fileBytes + dbBytes.walBytes,
    },
    thresholds,
  );

  return {
    generatedAt: now,
    uptimeSec: info.uptimeSec,
    status: summarizeMetricsStatus(alerts),
    service: {
      name: SERVICE_NAME,
      version: SERVICE_VERSION,
      nodeVersion: info.nodeVersion,
      pid: info.pid,
      cpuCount: info.cpuCount,
      rssBytes: info.rssBytes,
      heapUsedBytes: info.heapUsedBytes,
    },
    tasks: {
      byStatus,
      running: {
        cloud: deps.tasks.countRunning('cloud'),
        local: deps.tasks.countRunning('local'),
      },
      uncertain: deps.tasks.countUncertain(),
      window24h: {
        succeeded: window.succeeded,
        failed: window.failed,
        total: window.succeeded + window.failed + window.cancelled + window.running + window.queued,
      },
    },
    queue: {
      queued: byStatus.queued,
      running: runningTasks,
      oldestQueuedAgeSec: oldestQueuedAt === null ? null : Math.round((now - oldestQueuedAt) / 1000),
    },
    storage: {
      totalBytes: storage.totalBytes,
      videoBytes: storage.videoBytes,
      thumbBytes: storage.thumbBytes,
      assetBytes: storage.assetBytes,
      maxBytes: deps.maxBytes,
      usageRatio: deps.maxBytes > 0 ? Number((storage.totalBytes / deps.maxBytes).toFixed(4)) : 0,
      overThreshold: storage.totalBytes > deps.maxBytes,
    },
    database: { fileBytes: dbBytes.fileBytes, walBytes: dbBytes.walBytes },
    alerts,
    thresholds: { ...thresholds },
  };
}

/**
 * **能写**探针：真写一个小文件再删掉。
 *
 * 为什么不满足于"目录存在"：`stat` 能成功、`write` 却可能因只读挂载 / 磁盘满 / 权限位而失败 ——
 * "能不能写"只有**写过**才知道（与"上游链路要真发一次请求"同一条纪律）。
 * 探针文件走 `.ready-probe` 前缀且**立即删除**；失败时**尽力删除**（不掩盖原始错误）。
 */
export async function probeWritableDir(dir: string, now = Date.now()): Promise<{ ok: boolean; detail: string }> {
  const probe = path.join(dir, `.ready-probe-${process.pid}-${now}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, String(now), 'utf8');
    await rm(probe, { force: true });
    return { ok: true, detail: '输出目录可写' };
  } catch (error) {
    await rm(probe, { force: true }).catch(() => undefined);
    return {
      ok: false,
      detail: `输出目录不可写：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * readiness 检查项（契约 §16）。
 *
 * `required` 的判定**刻意保守**：只有"真干不了活"才算 —— 数据库读不了、磁盘写不了。
 * 凭据缺失、ffmpeg 缺失、存储在阈值附近都**不降级**（它们在 BYOK / 纯云端部署下并不影响出片），
 * 但会**如实出现在 checks 里**（不假装它们是绿的）。
 */
export async function collectReadinessChecks(deps: ObservabilityDeps): Promise<MetricCheck[]> {
  const checks: MetricCheck[] = [];

  try {
    const counts = deps.tasks.countByStatus();
    checks.push({
      id: 'database',
      ok: true,
      required: true,
      detail: `任务表可读（${Object.values(counts).reduce((sum, value) => sum + value, 0)} 条任务）`,
    });
  } catch (error) {
    checks.push({
      id: 'database',
      ok: false,
      required: true,
      detail: `任务表读取失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const writable = await probeWritableDir(deps.outputsDir, deps.now?.() ?? Date.now());
  checks.push({ id: 'storage.writable', required: true, ...writable });

  const readStorage = deps.readStorage ?? readStorageUsage;
  try {
    const usage = await readStorage(deps.outputsDir);
    const ratio = deps.maxBytes > 0 ? usage.totalBytes / deps.maxBytes : 0;
    const over = usage.totalBytes > deps.maxBytes;
    checks.push({
      id: 'storage.headroom',
      ok: !over,
      required: false,
      detail: over
        ? `已超容量阈值（${Math.round(ratio * 100)}%）：淘汰器会开始删最旧的成片`
        : `容量余量 ${Math.round((1 - ratio) * 100)}%（${usage.totalBytes} / ${deps.maxBytes} 字节）`,
    });
  } catch (error) {
    checks.push({
      id: 'storage.headroom',
      ok: false,
      required: false,
      detail: `容量统计失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (deps.checkMediaTools !== undefined) {
    const media = await deps.checkMediaTools();
    checks.push({
      id: 'media.tools',
      ok: media.ok,
      // 不降级：云端轨不需要 ffmpeg；只有本地轨与缩略图需要（如实陈述即可）
      required: false,
      detail: media.detail,
    });
  }

  return checks;
}
