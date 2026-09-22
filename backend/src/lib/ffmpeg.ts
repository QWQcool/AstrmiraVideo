import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * 媒体工具层（P0-2 / P0-3）：ffmpeg 与 ffprobe 的**系统安装**（仓库与镜像都不内置二进制）。
 *
 * 两条硬纪律：
 * 1. 缺失时抛**中文安装指引**并显式失败，不许崩栈（P0-3）；
 * 2. 一律带 `-nostdin` 与进程级超时——ffmpeg 处理不可信输入时不得挂死 worker（PLAN §7 加固口径）。
 *
 * 解析顺序：`FFMPEG_PATH` / `FFPROBE_PATH`（env 覆盖）→ PATH 中的 `ffmpeg` / `ffprobe`。
 */

export class MediaToolUnavailableError extends Error {
  constructor(public readonly tool: 'ffmpeg' | 'ffprobe') {
    super(
      [
        `未找到 ${tool}：本项目要求系统安装 ffmpeg / ffprobe（仓库与镜像均不内置二进制）。`,
        '请任选一种方式安装后重试：',
        '  Windows:  winget install Gyan.FFmpeg    （或 winget install BtbN.FFmpeg.GPL.8.1）',
        '  macOS:    brew install ffmpeg',
        '  Linux:    apt-get install -y ffmpeg',
        '  已有二进制时：在 .env 中设置 FFMPEG_PATH / FFPROBE_PATH 指向可执行文件。',
      ].join('\n'),
    );
    this.name = 'MediaToolUnavailableError';
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

export function resolveFfmpegPath(): string {
  const override = process.env.FFMPEG_PATH;
  return typeof override === 'string' && override.trim() !== '' ? override.trim() : 'ffmpeg';
}

export function resolveFfprobePath(): string {
  const override = process.env.FFPROBE_PATH;
  return typeof override === 'string' && override.trim() !== '' ? override.trim() : 'ffprobe';
}

export interface MediaToolResult {
  stdout: string;
  stderr: string;
}

/** 统一执行入口（`-nostdin -hide_banner` + 超时 + 大 stdout 上限由调用方指定） */
export async function runMediaTool(
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  options: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<MediaToolResult> {
  const bin = tool === 'ffmpeg' ? resolveFfmpegPath() : resolveFfprobePath();
  // 注意：`-nostdin` 是 **ffmpeg 专有**全局选项，ffprobe 会把它解析成"需要取值"的选项
  // （报 `Failed to set value '-hide_banner' for option 'nostdin'`）。因此只对 ffmpeg 加。
  const globalArgs = tool === 'ffmpeg' ? ['-nostdin', '-hide_banner'] : ['-hide_banner'];

  try {
    const { stdout, stderr } = await execFileAsync(
      bin,
      [...globalArgs, ...args],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
      },
    );
    return { stdout, stderr };
  } catch (err) {
    if (isNotFoundError(err)) throw new MediaToolUnavailableError(tool);
    throw err;
  }
}

function isNotFoundError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ENOENT' || code === 'EACCES';
}

/** ffprobe 结果的最小子集（S1 只用到时长 / 尺寸 / 音轨） */
export interface MediaInfo {
  durationSec: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
}

/** 媒体探测失败（文件损坏 / 非媒体文件 / 索引缺失）——上层应归 `INVALID_ASSET` 或 `UPSTREAM_ERROR` */
export class MediaProbeError extends Error {
  constructor(
    public readonly filePath: string,
    cause: unknown,
  ) {
    super(`媒体探测失败（文件可能损坏或非媒体文件）：${filePath}\n${(cause as Error).message}`);
    this.name = 'MediaProbeError';
    this.cause = cause;
  }
}

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
}

/**
 * 探测媒体信息。**解析失败（含损坏文件）会抛错**——调用方须把它归入
 * `INVALID_ASSET` 或 `UPSTREAM_ERROR`，不得静默当成"无音轨"。
 */
export async function probeMedia(filePath: string): Promise<MediaInfo> {
  let stdout: string;
  try {
    ({ stdout } = await runMediaTool('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]));
  } catch (err) {
    // 工具缺失照原样上抛（那是环境问题，不是文件问题）
    if (err instanceof MediaToolUnavailableError) throw err;
    // 其余（含 `moov atom not found`、`Invalid data found`）统一包装为探测失败
    throw new MediaProbeError(filePath, err);
  }

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: FfprobeStream[];
  };

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const duration = Number.parseFloat(parsed.format?.duration ?? '');

  if (!Number.isFinite(duration)) {
    throw new Error(`ffprobe 未能解析时长（文件可能损坏或非媒体文件）：${filePath}`);
  }

  return {
    durationSec: duration,
    hasVideo: video !== undefined,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    width: video?.width,
    height: video?.height,
  };
}

/** 前置自检：两个工具都存在时静默返回；任一缺失即抛中文指引（P0-3） */
export async function assertMediaToolsAvailable(): Promise<void> {
  await runMediaTool('ffmpeg', ['-version']);
  await runMediaTool('ffprobe', ['-version']);
}
