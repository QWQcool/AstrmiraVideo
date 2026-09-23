import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskProgress, VideoGenerateRequest, VideoProvider } from '@astrmira/shared';
import { assertMediaToolsAvailable, probeMedia, runMediaTool } from '../../lib/ffmpeg.js';
import { cropToAspect } from '../../pipeline/smartCrop.js';

/**
 * OI-2 `fixture-local` 夹具 provider（PLAN §4「Step 2 补充」，AC5）。
 *
 * 定位：**开发期校验用，不属于产品线**。它是唯一「无 Key、无网、无 GPU、零成本、结果确定」
 * 的 provider，用于把真实产物链路（清洗 → 时长对齐 → 落盘 → ffprobe 校验）跑通，
 * 并为 CI 提供可复现的确定性输入。
 *
 * 契约：`VideoProvider`（CONTRACT §4）——不得新增专属请求字段；私有参数走 `options`。
 * 私有 options（本 provider 专用）：
 *   - `fixtureClip?: string`  指定夹具片段文件名（测试用，绕过确定性选片）
 */

const EPSILON_SEC = 0.05;

function repoRoot(): string {
  // src/providers/fixture → packages/backend → repo root（dist 下层级一致）
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

export interface FixtureProviderOptions {
  clipsDir?: string;
  outputDir?: string;
  defaultDurationSec?: number;
}

export class FixtureLocalProvider implements VideoProvider {
  readonly id = 'fixture-local' as const;
  readonly name = '夹具 Provider（开发期校验 · 零外网）';

  private readonly clipsDir: string;
  private readonly outputDir: string;
  private readonly defaultDurationSec: number;
  /** 任务状态表。S1 为最小实现（同步完成）；排队 / 进度推进由 S2 的 JobQueue + 任务存储接管 */
  private readonly tasks = new Map<string, TaskProgress>();

  constructor(options: FixtureProviderOptions = {}) {
    const root = repoRoot();
    this.clipsDir = options.clipsDir ?? path.join(root, 'tests', 'fixtures', 'clips');
    this.outputDir = options.outputDir ?? path.join(root, 'outputs');
    this.defaultDurationSec = options.defaultDurationSec ?? 5;
  }

  async checkHealth(): Promise<{ available: boolean; reason?: string }> {
    try {
      await assertMediaToolsAvailable();
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }

    const clips = await this.listClips();
    if (clips.length === 0) {
      return {
        available: false,
        reason: `夹具片段目录为空：${this.clipsDir}（请先运行 node scripts/make-fixture-clips.mjs）`,
      };
    }
    return { available: true };
  }

  async submit(request: VideoGenerateRequest): Promise<{ taskId: string }> {
    const taskId = randomUUID();
    const clipPath = await this.resolveClip(request);

    this.tasks.set(taskId, {
      taskId,
      status: 'running',
      progressPercent: 0,
      requestSnapshot: request,
      message: '夹具渲染中',
      // V2.3：任务创建时间（夹具自己就是"上游"，它知道得最准）
      createdAt: Date.now(),
    });

    const progress = await this.render(taskId, request, clipPath);
    this.tasks.set(taskId, progress);

    return { taskId };
  }

  async queryStatus(taskId: string): Promise<TaskProgress> {
    const progress = this.tasks.get(taskId);
    if (progress === undefined) {
      throw new Error(`夹具 provider 未持有该任务：${taskId}`);
    }
    return progress;
  }

  async cancel(_taskId: string): Promise<boolean> {
    // 最小实现：渲染在 submit 内同步完成，不存在可取消窗口
    return false;
  }

  // ── 内部实现 ───────────────────────────────────────────────────────────────

  /** 确定性选片：目录扫描 + 文件名升序；测试可用 `options.fixtureClip` 指定 */
  private async resolveClip(request: VideoGenerateRequest): Promise<string> {
    const override = request.options?.['fixtureClip'];
    if (typeof override === 'string' && override.trim() !== '') {
      return path.join(this.clipsDir, path.basename(override.trim()));
    }

    const clips = await this.listClips();
    if (clips.length === 0) {
      throw new Error(
        `夹具片段目录为空：${this.clipsDir}（请先运行 node scripts/make-fixture-clips.mjs）`,
      );
    }

    const portraitWanted = request.aspectRatio === '9:16';
    const preferred = clips.find((name) =>
      portraitWanted ? name.includes('portrait') : name.includes('base'),
    );
    return path.join(this.clipsDir, preferred ?? clips[0]);
  }

  private async listClips(): Promise<string[]> {
    try {
      const entries = await readdir(this.clipsDir);
      return entries.filter((name) => name.endsWith('.mp4')).sort();
    } catch {
      return [];
    }
  }

  /** 渲染：时长对齐（长→裁切 / 短→循环拉伸 + 告警 / 循环时静音 + 第二条告警）+ 32 倍数居中裁切 */
  private async render(
    taskId: string,
    request: VideoGenerateRequest,
    clipPath: string,
  ): Promise<TaskProgress> {
    const source = await probeMedia(clipPath);
    const targetSec = request.params?.durationSec ?? this.defaultDurationSec;
    const warnings: string[] = [];
    const args: string[] = [];

    const needsLoop = source.durationSec < targetSec - EPSILON_SEC;
    const needsTrim = source.durationSec > targetSec + EPSILON_SEC;

    if (needsLoop) {
      // `-stream_loop -1` 必须位于输入之前
      args.push('-stream_loop', '-1');
      warnings.push('素材短于请求时长，已循环拉伸');
    }

    args.push('-i', clipPath);

    if (source.width !== undefined && source.height !== undefined) {
      const target = cropToAspect(source.width, source.height, request.aspectRatio);
      args.push(
        '-vf',
        `crop=${target.width}:${target.height}:(iw-${target.width})/2:(ih-${target.height})/2`,
      );
    }

    if (needsLoop && source.hasAudio) {
      args.push('-an');
      warnings.push('循环素材自带音轨，已静音');
    }

    args.push('-t', targetSec.toFixed(3));
    args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
    if (source.hasAudio && !needsLoop) {
      args.push('-c:a', 'aac');
    } else if (needsLoop) {
      args.push('-an');
    }

    await mkdir(this.outputDir, { recursive: true });
    const outputName = `${taskId}.mp4`;
    const outputPath = path.join(this.outputDir, outputName);
    args.push('-y', outputPath);

    // V2.3：沿用 submit 时记下的创建时间（拿不到才回落，避免上下文丢失时崩）
    const createdAt = this.tasks.get(taskId)?.createdAt ?? Date.now();

    try {
      await runMediaTool('ffmpeg', args);
    } catch (err) {
      return {
        taskId,
        status: 'failed',
        progressPercent: 0,
        requestSnapshot: request,
        createdAt,
        error: {
          code: 'UPSTREAM_ERROR',
          message: `夹具渲染失败：${(err as Error).message}`,
          disposition: 'retryable',
        },
      };
    }

    return {
      taskId,
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: request,
      outputVideoUrl: `/media/${outputName}`,
      warnings,
      createdAt,
      message: needsTrim ? '夹具渲染完成（已裁切到请求时长）' : '夹具渲染完成',
    };
  }
}
