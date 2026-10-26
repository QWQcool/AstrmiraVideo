import { taskOutput, type CreationRun, type CreationRunStep, type TaskProgress } from '@astrmira/shared';
import { resolveMediaUrl } from './api';

/**
 * B96：会话详情的**真实媒体**解析（纯函数）。
 *
 * ## 为什么不能从 `outputAssetId` 截断字符串猜 URL
 * `outputAssetId` 是 `task:<taskId>` 形态的**引用**，不是可播放地址。真实地址只有任务接口
 * （`GET /api/tasks/:id`）才知道；截断 id 拼 `/media/...` 会在产物被清理、扩展名不同
 * （png / mp4 / jpg 缩略图）或任务尚未终态时变成一个**看起来像成功**的坏链接。
 *
 * 因此这里只做两件事：把任务事实翻译成"可显示 / 不可显示 + 为什么"，以及**拒绝非同源**地址
 * （与 `resolveMediaUrl` 同一条安全边界）。
 *
 * ## 状态口径（诚实优先）
 * - `none`：这一步还没有产物（未成功 / 未开始）——不是错误；
 * - `loading`：步骤已成功，但任务详情还没取到（或任务仍在跑）——等下一轮；
 * - `failed`：步骤或任务失败——显示失败，不显示上一版图片冒充当前产物；
 * - `missing`：任务成功但**没有可用媒体**（无产物 / 非 `/media` 地址）——如实说"产物不可用"，
 *   绝不回退到旧图或占位假图。
 */
export type RunMedia =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'missing'; reason: 'no-output' | 'unsafe-url' }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string; thumbnailUrl?: string };

function mediaOfTask(task: TaskProgress): RunMedia {
  if (task.status === 'failed' || task.status === 'cancelled') return { kind: 'failed' };
  if (task.status !== 'succeeded') return { kind: 'loading' };
  const output = taskOutput(task);
  if (output.kind === 'none') return { kind: 'missing', reason: 'no-output' };
  const url = resolveMediaUrl(output.url);
  if (url === null) return { kind: 'missing', reason: 'unsafe-url' };
  if (output.kind === 'image') return { kind: 'image', url };
  const thumbnailUrl = resolveMediaUrl(task.thumbnailUrl);
  return { kind: 'video', url, ...(thumbnailUrl === null ? {} : { thumbnailUrl }) };
}

/** 单个步骤的媒体状态（首帧图 / 视频步产物） */
export function stepMedia(
  step: CreationRunStep,
  task: TaskProgress | undefined,
): RunMedia {
  if (step.status === 'failed') return { kind: 'failed' };
  if (step.status !== 'succeeded') return { kind: 'none' };
  if (step.taskId === undefined) return { kind: 'missing', reason: 'no-output' };
  if (task === undefined) return { kind: 'loading' };
  return mediaOfTask(task);
}

export type RunFinalMedia =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'missing'; reason: 'no-output' | 'unsafe-url' }
  | { kind: 'video'; url: string; thumbnailUrl?: string; taskId: string };

/**
 * 成片媒体：
 * - 单镜会话（视频步 = 1）→ 该视频步的产物；
 * - 多镜会话（视频步 ≥2）→ 自动拼接产物（`assembledTaskId`）；
 * - 会话未成功 → `none` / `failed`（失败时**不**拿某个镜头的视频冒充成片）。
 */
export function runFinalMedia(
  run: CreationRun,
  tasks: ReadonlyMap<string, TaskProgress>,
): RunFinalMedia {
  if (run.state === 'failed') return { kind: 'failed' };
  if (run.state !== 'succeeded') return { kind: 'none' };

  const videos = run.steps.filter(
    (step) => step.kind === 'video' && step.status === 'succeeded' && step.taskId !== undefined,
  );
  const targetTaskId = videos.length >= 2 ? run.assembledTaskId : videos[0]?.taskId;
  if (targetTaskId === undefined) return { kind: 'missing', reason: 'no-output' };

  const task = tasks.get(targetTaskId);
  if (task === undefined) return { kind: 'pending' };
  const media = mediaOfTask(task);
  if (media.kind === 'video') return { ...media, taskId: targetTaskId };
  if (media.kind === 'image') {
    // 会话成片必须是视频；图片产物出现在这里说明数据异常，如实报缺失而不是拿图冒充
    return { kind: 'missing', reason: 'no-output' };
  }
  if (media.kind === 'failed') return { kind: 'failed' };
  if (media.kind === 'loading') return { kind: 'pending' };
  return media;
}
