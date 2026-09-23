import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EditOperation, EditScript } from '@astrmira/shared';
import { runMediaTool } from '../lib/ffmpeg.js';
import type { JobQueue, QueueJob } from '../queue/JobQueue.js';
import type { TaskStore } from '../store/taskStore.js';

/**
 * 轻剪辑台执行器（V9 · B9；CONTRACT §11-2）。
 *
 * ## 它是什么、不是什么
 * 它是**时间轴上的确定性操作**：把 EDL 里的操作按顺序喂给本地 ffmpeg。
 * 它**不是**语义编辑（"把灯换个形状"只能重新生成 —— 那是 D38 抽帧闭环要解决的问题）。
 *
 * ## concat 与 xfade 的关系（本实现的口径）
 * `concat` 只**登记**要并入的片段，接缝怎么处理由紧随其后的 `xfade` 决定：
 * - `concat` → `xfade`：用真正的转场（`xfade` + `acrossfade`）连起来；
 * - `concat` → 其它操作（或到 EDL 末尾）：退化为**流拷贝直拼**（快、无损）。
 *
 * 为什么不让 `concat` 立即拼：那样 `xfade` 就没有"两段"可用了 —— 转场的语义天然属于**接缝**。
 * 因此"转场必须紧跟在拼接之后"是一条**显式规则**（违反时如实报错，不静默跳过：
 * 安静地不转场会让用户以为转了）。
 *
 * ## 三条纪律
 * 1. **零上游调用**：本文件不 import 任何 provider、不读凭据 —— 连"偷偷调一次云端"都做不到；
 * 2. **中间产物落 `outputs/.tmp/<taskId>/`**，成败都在 finally 里删掉（防线 3）；
 * 3. **失败要分类**：ffmpeg 缺失 → `PROVIDER_UNAVAILABLE`（terminal）；执行失败 → `UPSTREAM_ERROR`
 *    + `retryable`（本地操作没有"结果不明"这一态，§11-2）。
 */

export interface EditJobDeps {
  store: TaskStore;
  queue: JobQueue;
  outputsDir: string;
}

function mediaBase(outputsDir: string, taskId: string): string {
  return path.join(outputsDir, `${taskId}.mp4`);
}

/**
 * 任务 id → 磁盘上的成片路径。
 *
 * ⚠️ 必须走**任务记录的 `outputVideoUrl`**，不能自己拼 `<taskId>.mp4`：
 * provider 落盘用的是**它自己的上游 id**（夹具与云端各有一套命名），服务端 taskId 与文件名
 * **不一定相同**。B9 首轮实现就是拼错了名字，症状是"剪辑总是报源成片不存在"——
 * 而且集成测试最初也没抓到（测试里的种子文件名恰好与 taskId 一致，属于替身过于理想）。
 */
function resolveMediaPath(deps: EditJobDeps, taskId: string): string | null {
  const url = deps.store.get(taskId)?.outputVideoUrl;
  if (url === undefined || url === '') return null;
  return path.join(deps.outputsDir, path.basename(url));
}

async function existsFile(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

/** ffprobe 读时长（秒）；读不到返回 null（调用方给出可读错误，而不是拿 NaN 去算 offset） */
async function probeDurationSec(file: string): Promise<number | null> {
  try {
    const { stdout } = await runMediaTool('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      file,
    ]);
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** 无转场的直拼（concat demuxer + 流拷贝：所有片段都是我们自己产出的 h264/aac） */
async function concatDirect(parts: string[], output: string, tmpDir: string): Promise<void> {
  const listFile = path.join(tmpDir, `concat-${randomUUID()}.txt`);
  await writeFile(
    listFile,
    parts.map((part) => `file '${part.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8',
  );
  await runMediaTool('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy',
    output,
  ]);
}

/** 带转场的拼接：把 `head` 与 `rest` 依次用 xfade/acrossfade 连起来 */
async function concatWithTransition(
  head: string,
  rest: string[],
  operation: Extract<EditOperation, { type: 'xfade' }>,
  output: string,
): Promise<void> {
  let current = head;
  let currentDuration = await probeDurationSec(current);
  if (currentDuration === null) throw new Error('转场失败：无法读取当前片段的时长');

  for (let index = 0; index < rest.length; index += 1) {
    const next = rest[index] as string;
    const stepOutput = `${output}.xfade-${index}.mp4`;
    // offset = 前一段时长 − 转场时长：转场期间两段重叠，所以总时长会比"相加"少一个转场时长
    const offset = Math.max(0, currentDuration - operation.durationSec);

    await runMediaTool('ffmpeg', [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', current,
      '-i', next,
      '-filter_complex',
      `[0:v][1:v]xfade=transition=${operation.transition}:duration=${operation.durationSec}:offset=${offset}[v];` +
        `[0:a][1:a]acrossfade=d=${operation.durationSec}[a]`,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac',
      stepOutput,
    ]);

    const stepDuration = await probeDurationSec(stepOutput);
    if (stepDuration === null) throw new Error('转场失败：无法读取产物时长');

    await rm(current, { force: true }).catch(() => undefined);
    current = stepOutput;
    currentDuration = stepDuration;
  }

  await rm(output, { force: true }).catch(() => undefined);
  await copyFile(current, output);
  await rm(current, { force: true }).catch(() => undefined);
}

/** 视频类操作（不做"待拼接段"的状态处理 —— 那在外层循环里） */
async function applyVideoOperation(
  op: Exclude<EditOperation, { type: 'concat' } | { type: 'xfade' }>,
  input: string,
  output: string,
): Promise<void> {
  switch (op.type) {
    case 'trim':
      await runMediaTool('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        // `-ss` 放在 `-i` 之前：快速定位（不必解码前面的帧）
        '-ss', String(op.startSec), '-to', String(op.endSec),
        '-i', input,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac',
        output,
      ]);
      return;
    case 'volume':
      await runMediaTool('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', input,
        '-af', `volume=${op.gain}`,
        '-c:v', 'copy', '-c:a', 'aac',
        output,
      ]);
      return;
    case 'speed':
      // 视频用 setpts、音频用 atempo：两者必须同时改，否则音画不同步
      await runMediaTool('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', input,
        '-filter_complex', `[0:v]setpts=PTS/${op.factor}[v];[0:a]atempo=${op.factor}[a]`,
        '-map', '[v]', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac',
        output,
      ]);
      return;
  }
}

/** 抽帧：产物落 `outputs/assets/<assetId>.jpg`（与上传资产同目录同规则） */
async function extractFrame(input: string, assetId: string, atSec: number, outputsDir: string): Promise<void> {
  // 先探测片长再抽帧：ffmpeg 对超范围的 `-ss` 只会报"encoder 打不开"（实测），
  // 那句话既不能定位也不能指导用户 —— 所以这里给出"多少秒超出多长的片"这种可读错误。
  const duration = await probeDurationSec(input);
  if (duration !== null && atSec > duration) {
    throw new Error(`抽帧失败：${atSec}s 超出片长（该片长 ${duration.toFixed(2)}s）`);
  }

  const target = path.join(outputsDir, 'assets', `${assetId}.jpg`);
  await mkdir(path.dirname(target), { recursive: true });

  await runMediaTool('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(atSec), '-i', input,
    '-frames:v', '1', '-q:v', '2',
    target,
  ]);

  // 时间点超出片长时 ffmpeg 可能"成功"但产出 0 字节 —— 显式检查，不产空文件
  if (!(await existsFile(target))) {
    throw new Error(`抽帧失败：${atSec}s 超出片长（请检查时间点）`);
  }
}

/** 建一个"剪辑任务执行器"，装配进调度器（`JobDispatcherOptions.runEditJob`） */
export function createEditJobRunner(deps: EditJobDeps): (job: QueueJob) => Promise<void> {
  return async function runEditJob(job: QueueJob): Promise<void> {
    const record = deps.store.get(job.taskId);
    const script: EditScript | undefined = job.editScript ?? record?.editScript;

    if (script === undefined) {
      await deps.queue.fail(job.taskId, {
        code: 'INVALID_REQUEST',
        message: '剪辑任务缺少 EDL（edit_script）',
        disposition: 'terminal',
      });
      return;
    }

    const sourcePath = resolveMediaPath(deps, script.sourceTaskId);
    if (sourcePath === null || !(await existsFile(sourcePath))) {
      await deps.queue.fail(job.taskId, {
        code: 'TASK_NOT_FOUND',
        message: `源成片不存在或已被清理：${script.sourceTaskId}`,
        disposition: 'terminal',
      });
      return;
    }

    const tmpDir = path.join(deps.outputsDir, '.tmp', job.taskId);
    await mkdir(tmpDir, { recursive: true });

    const request = record?.requestSnapshot ?? job.request;
    await deps.queue.heartbeat(job.taskId, {
      taskId: job.taskId,
      status: 'running',
      progressPercent: 10,
      requestSnapshot: request,
      message: `剪辑中（${script.operations.length} 步）`,
    });

    const extractedAssetIds: string[] = [];

    try {
      let current = sourcePath;
      /** 已登记、尚未决定接缝处理方式的待并入片段（见文件头注释） */
      let pendingConcat: string[] | null = null;
      let step = 0;

      for (const op of script.operations) {
        step += 1;

        if (op.type === 'concat') {
          if (pendingConcat !== null) {
            throw new Error('连续两次「拼接」不受支持：请先在它们之间给出一个「转场」');
          }
          const parts: string[] = [];
          for (const id of op.taskIds) {
            const resolved = resolveMediaPath(deps, id);
            if (resolved === null || !(await existsFile(resolved))) {
              throw new Error(`拼接素材缺失：${id.slice(0, 8)}（可能已被删除或尚未成功）`);
            }
            parts.push(resolved);
          }
          pendingConcat = parts;
        } else if (op.type === 'xfade') {
          if (pendingConcat === null) {
            throw new Error('「转场」必须紧跟在「拼接」之后（转场的语义属于两段之间的接缝）');
          }
          const next = path.join(tmpDir, `step-${step}.mp4`);
          await concatWithTransition(current, pendingConcat, op, next);
          current = next;
          pendingConcat = null;
        } else {
          // 其它操作遇到"待拼接段"：先直拼（无转场），再执行本操作
          if (pendingConcat !== null) {
            const merged = path.join(tmpDir, `merge-${step}.mp4`);
            await concatDirect([current, ...pendingConcat], merged, tmpDir);
            current = merged;
            pendingConcat = null;
          }
          const next = path.join(tmpDir, `step-${step}.mp4`);
          if (op.type === 'extractFrame') {
            const assetId = randomUUID();
            await extractFrame(current, assetId, op.atSec, deps.outputsDir);
            extractedAssetIds.push(assetId);
          } else {
            await applyVideoOperation(op, current, next);
            current = next;
          }
        }

        await deps.queue.heartbeat(job.taskId, {
          taskId: job.taskId,
          status: 'running',
          progressPercent: Math.min(95, 10 + Math.round((step / script.operations.length) * 85)),
          requestSnapshot: request,
          message: `剪辑中（${step}/${script.operations.length}）`,
        });
      }

      // EDL 结束时仍有待拼接段 → 直拼收尾
      if (pendingConcat !== null) {
        const merged = path.join(tmpDir, 'merge-final.mp4');
        await concatDirect([current, ...pendingConcat], merged, tmpDir);
        current = merged;
      }

      // 最终产物拷到 `outputs/<taskId>.mp4`（与生成任务同一命名规则，画廊与 /media 一视同仁）
      const finalPath = mediaBase(deps.outputsDir, job.taskId);
      if (current !== finalPath) {
        await copyFile(current, finalPath);
      }

      // 抽帧产物随任务落库（D38：它们可直接当参考资产用）
      deps.store.update(job.taskId, { extractedAssetIds });

      await deps.queue.complete(job.taskId, {
        videoUrl: `/media/${job.taskId}.mp4`,
        message: `剪辑完成（${script.operations.length} 步）`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missingTool = /未找到 ffmpeg|未找到 ffprobe/.test(message);
      await deps.queue.fail(job.taskId, {
        code: missingTool ? 'PROVIDER_UNAVAILABLE' : 'UPSTREAM_ERROR',
        message: missingTool ? `本服务未装 ffmpeg：${message}` : `剪辑失败：${message}`,
        disposition: missingTool ? 'terminal' : 'retryable',
      });
    } finally {
      // 防线 3：中间产物成败都清
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}
