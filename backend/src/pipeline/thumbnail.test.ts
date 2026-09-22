import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeMedia, runMediaTool } from '../lib/ffmpeg.js';
import {
  THUMBNAIL_DIR_NAME,
  createTaskThumbnail,
  resolveLocalVideoPath,
  thumbnailUrlOf,
} from './thumbnail.js';

/**
 * 画廊封面抽帧（V1.9）。
 *
 * 三条断言对应三条真实风险：
 * 1. **路径守卫**：入参来自 provider 的返回值，若它被污染（或日后有人改成传上游 URL），
 *    抽帧就会变成一个"任意路径读取"的口子 —— 所以守卫必须单独测；
 * 2. **真的出了 JPEG**：只看返回值不够（那正是"看着成功、文件是空的"这类错误），
 *    这里读回文件校验魔数与尺寸；
 * 3. **失败不留半成品**：0 字节的 jpg 会让画廊显示一块白，比没有缩略图更糟。
 *
 * 测试自己合成源片（`-c:v mpeg4`，不依赖 GPL 的 libx264），因此**不依赖 `tests/fixtures/clips`**。
 */
describe('resolveLocalVideoPath · 只接受同源 /media/ 直链', () => {
  const outputsDir = path.join('C:', 'tmp', 'outputs');

  it('接受 /media/<name>，落到 outputsDir 内', () => {
    expect(resolveLocalVideoPath(outputsDir, '/media/abc-123.mp4')).toBe(
      path.join(outputsDir, 'abc-123.mp4'),
    );
  });

  it('拒绝绝对地址 / 上游 URL（抽帧不得成为任意路径读取的口子）', () => {
    expect(resolveLocalVideoPath(outputsDir, 'https://upstream.example/v/1.mp4')).toBeNull();
    expect(resolveLocalVideoPath(outputsDir, '/etc/passwd')).toBeNull();
    expect(resolveLocalVideoPath(outputsDir, '')).toBeNull();
  });

  it('拒绝含 .. 的路径（只取 basename 之外还要显式拦一层）', () => {
    expect(resolveLocalVideoPath(outputsDir, '/media/../../etc/passwd')).toBeNull();
  });

  it('缩略图直链形状固定为 /media/thumbs/<taskId>.jpg', () => {
    expect(thumbnailUrlOf('t-1')).toBe(`/media/${THUMBNAIL_DIR_NAME}/t-1.jpg`);
  });
});

describe('createTaskThumbnail · 真实抽帧', () => {
  let workDir: string;
  let outputsDir: string;
  let sourcePath: string;

  beforeAll(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'astrmira-thumb-'));
    outputsDir = path.join(workDir, 'outputs');
    sourcePath = path.join(outputsDir, 'task-under-test.mp4');

    await mkdir(outputsDir, { recursive: true });

    // 源片 640×360（比缩略图宽大，才能验到"被缩到 480"而不是被放大）
    await runMediaTool('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=10',
      '-t',
      '1',
      '-c:v',
      'mpeg4',
      '-pix_fmt',
      'yuv420p',
      sourcePath,
    ]);
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('抽出的确实是 JPEG，且宽度缩到 480（画廊卡片 84px 的 3 倍屏够用）', async () => {
    const url = await createTaskThumbnail({
      outputsDir,
      taskId: 'task-under-test',
      videoUrl: '/media/task-under-test.mp4',
    });

    expect(url).toBe('/media/thumbs/task-under-test.jpg');

    const bytes = await readFile(path.join(outputsDir, THUMBNAIL_DIR_NAME, 'task-under-test.jpg'));
    // JPEG 魔数 + 有内容（不是 0 字节的空文件）
    expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(bytes.byteLength).toBeGreaterThan(1000);

    const info = await probeMedia(path.join(outputsDir, THUMBNAIL_DIR_NAME, 'task-under-test.jpg'));
    expect(info.width).toBe(480);
    // 640:360 = 16:9 → 480:270；`-2` 保证是偶数，不是 32 倍数（JPEG 无此约束）
    expect(info.height).toBe(270);
  });

  it('源片不存在时抛错，且**不留半成品**（0 字节的封面比没有封面更糟）', async () => {
    await expect(
      createTaskThumbnail({
        outputsDir,
        taskId: 'missing-source',
        videoUrl: '/media/missing-source.mp4',
      }),
    ).rejects.toThrow();

    await expect(
      stat(path.join(outputsDir, THUMBNAIL_DIR_NAME, 'missing-source.jpg')),
    ).rejects.toThrow();
  });

  it('不同任务的文件名互不覆盖（画廊里两条任务的封面必须各是各的）', async () => {
    await runMediaTool('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=10',
      '-t',
      '1',
      '-c:v',
      'mpeg4',
      '-pix_fmt',
      'yuv420p',
      path.join(outputsDir, 'another-task.mp4'),
    ]);

    const first = await createTaskThumbnail({
      outputsDir,
      taskId: 'task-under-test',
      videoUrl: '/media/task-under-test.mp4',
    });
    const second = await createTaskThumbnail({
      outputsDir,
      taskId: 'another-task',
      videoUrl: '/media/another-task.mp4',
    });

    expect(first).not.toBe(second);
    expect(
      (await stat(path.join(outputsDir, THUMBNAIL_DIR_NAME, 'another-task.jpg'))).isFile(),
    ).toBe(true);
  });
});
