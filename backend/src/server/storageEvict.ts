import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { THUMBNAIL_DIR_NAME } from '../pipeline/thumbnail.js';
import type { TaskStore } from '../store/taskStore.js';
import { readStorageUsage } from './storageUsage.js';

/**
 * 容量淘汰（V2.8 / 台账 B22；CONTRACT §7 的口径，逐字对应）。
 *
 * 为什么是后台扫描而不是"每次出片顺手看看"：淘汰要**从最旧的一端**挑（LRU），
 * 而"刚出片"恰好是最新的一端；后台扫描（默认 5 分钟 + 启动一次）与请求路径完全解耦，
 * 也永远不会让用户的一次提交因为"正在删文件"而变慢。
 *
 * 四条纪律（写在最前面，改代码前先读）：
 * 1. **未超阈值不做任何事**：不删文件、不写日志（噪声纪律）；
 * 2. **只删文件，保留任务记录**：画廊显示"成片已清理"、血缘画布显示 ghost ——
 *    历史与血缘不断裂（这是与"手动 DELETE 整条任务"的本质区别）；
 * 3. **三类保护**：在跑的任务不在候选里（查询就只取 `succeeded`）；被 `task:` 引用的成片不淘汰
 *    （否则"参数一键回填"再提交会 404）；**参考资产不参与淘汰**（用户数据 + 体积小）；
 * 4. **单飞**：上一轮没跑完就不再开新的一轮（避免并发删同一批）。
 */

/** 默认阈值 4GiB（env `OUTPUTS_MAX_BYTES` 可调）；目标水位 = 阈值的 80% */
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
export const DEFAULT_TARGET_RATIO = 0.8;
export const DEFAULT_INTERVAL_MS = 5 * 60_000;

/** 单轮最多看多少条候选（防御性上限：一轮只处理这么多，剩下的留给下一轮） */
export const CANDIDATE_SCAN_LIMIT = 200;

export interface StorageEvictOutcome {
  beforeBytes: number;
  /** 估算值 = before - freed（不再重扫目录：淘汰期间新产出的文件不该被算进来） */
  afterBytes: number;
  freedBytes: number;
  evictedTaskIds: string[];
  /** 因"被其它任务以 task: 引用"而跳过的条数（如实报告，便于解释"为什么没腾出空间"） */
  skippedReferenced: number;
}

export interface StorageEvictOptions {
  outputsDir: string;
  store: Pick<TaskStore, 'listOldestWithOutput' | 'countTasksReferencingTaskRef'>;
  /** 触发阈值（bytes）；缺省用 env `OUTPUTS_MAX_BYTES`，再缺省 4GiB */
  maxBytes?: number;
  /** 目标水位比例；缺省用 env `OUTPUTS_TARGET_RATIO`，再缺省 0.8 */
  targetRatio?: number;
}

async function sizeOf(file: string): Promise<number> {
  try {
    const info = await stat(file);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0; // 文件已不在：不是错误，只是没有可释放的
  }
}

/** 读 env 里的数字配置（非数字/非正数一律当作"没配"） */
function readPositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 触发阈值（bytes）：env `OUTPUTS_MAX_BYTES` → 缺省 4GiB。
 * **淘汰器与指标快照（B53）共用这一个函数** —— 两处各读一次 env 迟早会出现
 * "面板说没超、淘汰器已经在删"这种互相打脸的场面。
 */
export function resolveOutputsMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  return readPositiveNumber(env.OUTPUTS_MAX_BYTES) ?? DEFAULT_MAX_BYTES;
}

function resolveMaxBytes(options: StorageEvictOptions): number {
  return options.maxBytes ?? resolveOutputsMaxBytes();
}

function resolveTargetRatio(options: StorageEvictOptions): number {
  const ratio =
    options.targetRatio ?? readPositiveNumber(process.env.OUTPUTS_TARGET_RATIO) ?? DEFAULT_TARGET_RATIO;
  return ratio >= 0.1 && ratio < 1 ? ratio : DEFAULT_TARGET_RATIO;
}

/**
 * 跑一轮淘汰。**返回 `null` = 未超阈值（什么都别做）**；
 * 返回 outcome 时若 `freedBytes === 0`，说明"超了阈值但没腾出空间"（候选都被保护或文件已不在）——
 * 这种情况调用方**不写日志**（契约：真正删了文件才写 `storage.evict`）。
 */
export async function runStorageEvict(
  options: StorageEvictOptions,
): Promise<StorageEvictOutcome | null> {
  const maxBytes = resolveMaxBytes(options);
  const targetRatio = resolveTargetRatio(options);

  const usage = await readStorageUsage(options.outputsDir);
  if (usage.totalBytes <= maxBytes) return null;

  const targetBytes = Math.floor(maxBytes * targetRatio);
  const candidates = options.store.listOldestWithOutput(CANDIDATE_SCAN_LIMIT);

  const evictedTaskIds: string[] = [];
  let freedBytes = 0;
  let skippedReferenced = 0;

  for (const task of candidates) {
    if (usage.totalBytes - freedBytes <= targetBytes) break;

    if (options.store.countTasksReferencingTaskRef(task.taskId) > 0) {
      skippedReferenced += 1;
      continue;
    }

    const videoFile = path.join(
      options.outputsDir,
      path.basename(task.outputVideoUrl ?? `${task.taskId}.mp4`),
    );
    const thumbFile = path.join(options.outputsDir, THUMBNAIL_DIR_NAME, `${task.taskId}.jpg`);

    const freedForTask = (await sizeOf(videoFile)) + (await sizeOf(thumbFile));
    await rm(videoFile, { force: true }).catch(() => undefined);
    await rm(thumbFile, { force: true }).catch(() => undefined);

    if (freedForTask <= 0) continue; // 文件本就不在（例如此前手动删过）：不算"淘汰"
    freedBytes += freedForTask;
    evictedTaskIds.push(task.taskId);
  }

  return {
    beforeBytes: usage.totalBytes,
    afterBytes: usage.totalBytes - freedBytes,
    freedBytes,
    evictedTaskIds,
    skippedReferenced,
  };
}

export interface StorageEvictorOptions extends StorageEvictOptions {
  intervalMs?: number;
  /** 真正删了文件时回调（装配点在这里写 `storage.evict` 操作日志） */
  onEvict?: (outcome: StorageEvictOutcome) => void;
  onError?: (err: unknown) => void;
}

export interface StorageEvictor {
  stop(): void;
  /** 手动跑一轮（测试/运维用） */
  runOnce(): Promise<StorageEvictOutcome | null>;
  /** 停表 + 等在飞的一轮收尾（与调度器同一条收尾纪律：关库前必须排空） */
  drain(): Promise<void>;
}

export function startStorageEvictor(options: StorageEvictorOptions): StorageEvictor {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  const inFlight = new Set<Promise<void>>();

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const launch = (): void => {
    if (running) return; // 单飞
    running = true;
    const work = runStorageEvict(options)
      .then((outcome) => {
        if (outcome !== null && outcome.freedBytes > 0) options.onEvict?.(outcome);
      })
      .catch((err: unknown) => {
        options.onError?.(err);
      });
    const tracked = work.finally(() => {
      running = false;
      inFlight.delete(tracked);
    });
    inFlight.add(tracked);
  };

  timer = setInterval(launch, intervalMs);
  timer.unref?.(); // 不阻止进程退出（测试里便于收尾）
  launch(); // 启动先跑一次：重启后立刻回收一次空间

  return {
    stop,
    runOnce: () => runStorageEvict(options),
    drain: async () => {
      stop();
      await Promise.allSettled(Array.from(inFlight));
    },
  };
}
