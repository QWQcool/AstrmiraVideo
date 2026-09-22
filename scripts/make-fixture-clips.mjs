#!/usr/bin/env node
/**
 * OI-2 夹具片段合成脚本（PLAN §4「Step 2 补充」/ 决策 D10）。
 *
 * 为什么用 ffmpeg 现场合成而不是提交真实片段：
 *   - **确定性**：帧数 / 时长 / 尺寸 / 音轨全部已知，断言可钉死；
 *   - **体积**：脚本几 KB vs 真实片段 2–5MB/段（二进制在 git 无增量存储，每次替换永久留在历史）；
 *   - **边界覆盖**：真实素材提供不了"0.5s 带音轨""截断 moov"这类用例。
 *
 * 用法：node scripts/make-fixture-clips.mjs [--force]
 * 产物：tests/fixtures/clips/*.mp4（**已 gitignore，不入库**）
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLIPS_DIR = path.join(ROOT, 'tests', 'fixtures', 'clips');

/** ffmpeg 缺失时的中文指引（与 backend/src/lib/ffmpeg.ts 同一口径，P0-3） */
const INSTALL_HINT = [
  '未找到 ffmpeg：本项目要求系统安装 ffmpeg / ffprobe（仓库与镜像均不内置二进制）。',
  '请任选一种方式安装后重试：',
  '  Windows:  winget install Gyan.FFmpeg    （或 winget install BtbN.FFmpeg.GPL.8.1）',
  '  macOS:    brew install ffmpeg',
  '  Linux:    apt-get install -y ffmpeg',
  '  已有二进制时：设置 FFMPEG_PATH / FFPROBE_PATH 环境变量指向可执行文件。',
].join('\n');

/**
 * 9 条边界用例（PLAN §4 表，一条不少）。
 * 注：PLAN 表里「32 倍数不规整」写的是 831×479，此处用 **830×478**——
 * H.264 + yuv420p 要求宽高均为偶数，831/479 无法编码；830×478 同样“非 32 倍数”，
 * 边界意图完全一致（且是常见的“差一点对齐”尺寸）。
 */
export const FIXTURE_CLIPS = [
  { id: 'base-720p-landscape-5s-audio', width: 1280, height: 720, durationSec: 5, audio: true, note: '基线：720p 横屏 5s + 音轨' },
  { id: 'portrait-720x1280-5s-audio', width: 720, height: 1280, durationSec: 5, audio: true, note: '竖屏 9:16 分支' },
  { id: 'short-0.5s-no-audio', width: 1280, height: 720, durationSec: 0.5, audio: false, note: '短于请求（0.5s vs 5s）→ 循环拉伸 + 1 条告警' },
  { id: 'short-0.5s-with-audio', width: 1280, height: 720, durationSec: 0.5, audio: true, note: '短于请求且自带音轨 → 循环 + 静音 + 2 条告警' },
  { id: 'long-30s-with-audio', width: 1280, height: 720, durationSec: 30, audio: true, note: '长于请求（30s vs 5s）→ 必须裁切到 durationSec' },
  { id: 'no-audio-5s', width: 1280, height: 720, durationSec: 5, audio: false, note: '无音轨（-an）→ 拼接链路不崩' },
  { id: 'odd-size-830x478-5s', width: 830, height: 478, durationSec: 5, audio: false, note: '32 倍数不规整 → 规整后必为 32 倍数' },
  { id: 'single-frame', width: 1280, height: 720, durationSec: 0, audio: false, frames: 1, note: '极短 / 单帧 → 边界不崩' },
  { id: 'corrupted-truncated-moov', derivedFrom: 'base-720p-landscape-5s-audio', note: '截断 moov → 必须归 INVALID_ASSET / UPSTREAM_ERROR，且不进重试死循环' },
];

export function clipPathFor(id) {
  return path.join(CLIPS_DIR, `${id}.mp4`);
}

async function runFfmpeg(args) {
  const bin = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
  try {
    await execFileAsync(bin, ['-nostdin', '-hide_banner', '-loglevel', 'error', ...args], {
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'EACCES') {
      const e = new Error(INSTALL_HINT);
      e.cause = err;
      throw e;
    }
    throw err;
  }
}

function syntheticArgs(clip, outPath) {
  const { width, height, durationSec, audio, frames } = clip;
  const args = ['-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=24:duration=${Math.max(durationSec, 0.05)}`];

  if (audio) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${Math.max(durationSec, 0.05)}`);
  }

  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  else args.push('-an');
  if (frames) args.push('-frames:v', String(frames));
  args.push('-y', outPath);
  return args;
}

async function makeCorrupted(sourcePath, outPath) {
  const bytes = await readFile(sourcePath);
  // 丢掉尾部 30% —— ffmpeg 默认把 moov 放在文件末尾，截尾即破坏索引
  await writeFile(outPath, bytes.subarray(0, Math.floor(bytes.length * 0.7)));
}

/**
 * 生成全部夹具片段（幂等：已存在则跳过，`force` 时重建）。
 * @returns {Promise<{ dir: string, created: string[], skipped: string[] }>}
 */
export async function ensureFixtureClips({ force = false } = {}) {
  await mkdir(CLIPS_DIR, { recursive: true });

  const created = [];
  const skipped = [];

  for (const clip of FIXTURE_CLIPS) {
    const outPath = clipPathFor(clip.id);

    if (existsSync(outPath) && !force) {
      skipped.push(clip.id);
      continue;
    }

    if (clip.derivedFrom) {
      await makeCorrupted(clipPathFor(clip.derivedFrom), outPath);
    } else {
      await runFfmpeg(syntheticArgs(clip, outPath));
    }
    created.push(clip.id);
  }

  return { dir: CLIPS_DIR, created, skipped };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const force = process.argv.includes('--force');
  const { dir, created, skipped } = await ensureFixtureClips({ force });
  console.log(`夹具片段目录：${dir}`);
  console.log(`新生成 ${created.length} 条${created.length ? `：${created.join(', ')}` : ''}`);
  console.log(`已存在跳过 ${skipped.length} 条${skipped.length ? `：${skipped.join(', ')}` : ''}`);
}
