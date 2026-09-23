import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TaskProgress, VideoGenerateRequest } from '@astrmira/shared';
import { probeMedia } from '../../lib/ffmpeg.js';
import { isAlignedTo32 } from '../../pipeline/smartCrop.js';
import { FixtureLocalProvider } from './FixtureLocalProvider.js';

/**
 * OI-2 夹具 provider 验收（PLAN §5 的 S1 条目 / AC5）。
 * 9 条边界用例一条不少（PLAN §4 表）；全部零外网、零配额、确定性。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUTPUTS_DIR = path.join(ROOT, 'outputs');

const provider = new FixtureLocalProvider();
const producedFiles: string[] = [];

function request(overrides: Partial<VideoGenerateRequest> & { clip: string }): VideoGenerateRequest {
  const { clip, ...rest } = overrides;
  return {
    prompt: '夹具用例：雨夜街头的中景镜头',
    mode: 't2v',
    aspectRatio: '16:9',
    provider: 'fixture-local',
    params: { durationSec: 5 },
    options: { fixtureClip: clip },
    ...rest,
  };
}

async function renderOnce(req: VideoGenerateRequest): Promise<{ progress: TaskProgress; outputPath: string }> {
  const { taskId } = await provider.submit(req);
  const progress = await provider.queryStatus(taskId);

  expect(progress.status).toBe('succeeded');
  expect(progress.outputVideoUrl).toMatch(/^\/media\/.+\.mp4$/);

  const outputPath = path.join(OUTPUTS_DIR, path.basename(progress.outputVideoUrl as string));
  producedFiles.push(outputPath);
  return { progress, outputPath };
}

beforeAll(() => {
  // 合成夹具片段（幂等；二进制不入库，CI 上现场生成）
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-fixture-clips.mjs')], {
    stdio: 'pipe',
  });
}, 180_000);

afterAll(() => {
  for (const file of producedFiles) {
    rmSync(file, { force: true });
  }
});

describe('FixtureLocalProvider · checkHealth', () => {
  it('ffmpeg/ffprobe 可用且夹具目录非空时报 available', async () => {
    const health = await provider.checkHealth();
    expect(health.available, health.reason).toBe(true);
  });
});

describe('FixtureLocalProvider · 9 条边界用例（AC5：真实可播 MP4 + ffprobe 校验）', () => {
  it('① 基线 720p 横屏 5s + 音轨：时长/音轨/32 倍数尺寸全部对齐', async () => {
    const { progress, outputPath } = await renderOnce(
      request({ clip: 'base-720p-landscape-5s-audio.mp4' }),
    );

    const out = await probeMedia(outputPath);
    expect(out.durationSec).toBeCloseTo(5, 1);
    expect(out.hasAudio).toBe(true);
    expect(out.hasVideo).toBe(true);
    expect(isAlignedTo32(out.width as number)).toBe(true);
    expect(isAlignedTo32(out.height as number)).toBe(true);
    expect(progress.warnings ?? []).toHaveLength(0);
  });

  it('② 竖屏 9:16：输出为竖向且尺寸规整', async () => {
    const { outputPath } = await renderOnce(
      request({ clip: 'portrait-720x1280-5s-audio.mp4', aspectRatio: '9:16' }),
    );

    const out = await probeMedia(outputPath);
    expect(out.height as number).toBeGreaterThan(out.width as number);
    expect(isAlignedTo32(out.width as number)).toBe(true);
    expect(isAlignedTo32(out.height as number)).toBe(true);
  });

  it('③ 短于请求（0.5s vs 5s，无音轨）：循环拉伸 + 恰好 1 条告警，输出时长 = 请求时长', async () => {
    const { progress, outputPath } = await renderOnce(request({ clip: 'short-0.5s-no-audio.mp4' }));

    const warnings = progress.warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('循环拉伸');
    expect((await probeMedia(outputPath)).durationSec).toBeCloseTo(5, 1);
  });

  it('④ 短于请求且素材带音轨：循环 + 静音 = 2 条告警，输出音轨已静音', async () => {
    const { progress, outputPath } = await renderOnce(
      request({ clip: 'short-0.5s-with-audio.mp4' }),
    );

    const warnings = progress.warnings ?? [];
    expect(warnings).toHaveLength(2);
    expect(warnings.join('|')).toContain('循环拉伸');
    expect(warnings.join('|')).toContain('已静音');
    expect((await probeMedia(outputPath)).hasAudio).toBe(false);
  });

  it('⑤ 长于请求（30s vs 5s）：必须裁切到请求时长，不许多出', async () => {
    const { progress, outputPath } = await renderOnce(request({ clip: 'long-30s-with-audio.mp4' }));

    const out = await probeMedia(outputPath);
    expect(out.durationSec).toBeCloseTo(5, 1);
    expect(out.durationSec).toBeLessThan(5.5);
    expect(progress.warnings ?? []).toHaveLength(0);
  });

  it('⑥ 无音轨（-an）：链路不崩，输出无音轨', async () => {
    const { progress, outputPath } = await renderOnce(request({ clip: 'no-audio-5s.mp4' }));

    expect((await probeMedia(outputPath)).hasAudio).toBe(false);
    expect(progress.status).toBe('succeeded');
  });

  it('⑦ 32 倍数不规整（830×478）：输出尺寸必为 32 倍数', async () => {
    const { outputPath } = await renderOnce(request({ clip: 'odd-size-830x478-5s.mp4' }));

    const out = await probeMedia(outputPath);
    expect(isAlignedTo32(out.width as number)).toBe(true);
    expect(isAlignedTo32(out.height as number)).toBe(true);
  });

  it('⑧ 极短 / 单帧：边界不崩（按短于请求处理 → 循环拉伸）', async () => {
    const { progress, outputPath } = await renderOnce(request({ clip: 'single-frame.mp4' }));

    expect(progress.status).toBe('succeeded');
    expect((await probeMedia(outputPath)).durationSec).toBeCloseTo(5, 1);
  });

  it('⑨ 损坏文件（截断 moov）：显式失败且快速失败，不进重试死循环', async () => {
    const started = Date.now();

    // 精确锚定我们的探测失败文案：排除"工具参数错误 / 工具缺失"这类假绿（曾实测踩到过）
    await expect(provider.submit(request({ clip: 'corrupted-truncated-moov.mp4' }))).rejects.toThrow(
      /媒体探测失败/,
    );

    // "快速失败"的可测口径：单次尝试即返回（不重试），远小于任何重试退避
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});

describe('FixtureLocalProvider · 接口契约（CONTRACT §4）', () => {
  it('未登记的任务 queryStatus 必须报错（不返回假状态）', async () => {
    await expect(provider.queryStatus('not-a-real-task')).rejects.toThrow(/未持有该任务/);
  });

  it('同步完成的渲染不存在可取消窗口 → cancel 返回 false', async () => {
    expect(await provider.cancel('any-task')).toBe(false);
  });
});
