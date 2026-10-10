import { createProjectFromSource, type EditProject, type PlatformPreset } from '@astrmira/shared';
import { DEFAULT_PROJECT_FPS } from '@astrmira/shared';
import { preflightEditExport, renderEditProject } from '../edit/exporter';
import { probeVideoMeta } from '../edit/mediaProbe';

/**
 * 交付规格转码（V2.14 / 台账 B49 片 B，契约 §14）。
 *
 * ## 复用什么、不引什么
 * "把成片对齐平台画幅"这件事**不需要新依赖**：剪辑台的导出链路（Remotion composition →
 * `@remotion/web-renderer` → WebCodecs → mediabunny 封装）本来就能"用目标画幅渲染一段视频"。
 * 所以转码 = **构造一个目标画幅的工程（单镜头 = 这条成片）→ 渲染一遍**。
 * 收益：零新依赖、零服务器 CPU（与 §11-2「渲染在浏览器」同一取向），
 * 代价：**耗时与片长成正比**（几秒的片子十几秒 ~ 几十秒，进度条如实显示）。
 *
 * ## 三条口径（都不是"顺手做"的取舍）
 * 1. **裁切而不是拉伸**：画幅不一致时按 `cover` 裁掉多余部分（`.ed-comp-media { object-fit: cover }`）。
 *    拉伸会让人脸变形 —— 交付物里这是不可接受的；裁切是平台自己也会做的事。
 * 2. **时长不截断**：只对齐画幅与帧率，**不动时长**（截断是内容决定，不是交付工具的职责；
 *    超过平台上限由片 A 的 `presetWarnings` 提示）。
 * 3. **帧率归一到工程帧率**（默认 30）：转码必然重采样，说清口径比假装没变化好。
 */

export interface TranscodeSource {
  /** 成片直链（同源 `/media/*`） */
  url: string;
  /** 归属任务（进 `EditClipSource`，便于"这包是哪条任务转出来的"可追溯） */
  taskId: string;
}

export interface TranscodePlan {
  /** 是否需要转（已经就是目标尺寸且帧率一致 → false，省一次渲染） */
  needed: boolean;
  /** 人话原因（该说的时候必须说，包括"不需要转"的原因） */
  reason: string;
  width: number;
  height: number;
}

/**
 * 纯函数部分：**先探测源片事实，再决定要不要转**。
 * `source` 为 null = 探测前（未知尺寸）；只有探测后给出的尺寸才允许判断"不需要转"。
 */
export function planTranscode(
  source: { width: number; height: number; fps: number } | null,
  preset: PlatformPreset,
  projectFps: number = DEFAULT_PROJECT_FPS,
): TranscodePlan {
  if (source === null) {
    return {
      needed: true,
      reason: `未探测到源片尺寸 → 按预设 ${preset.width}×${preset.height} 渲染`,
      width: preset.width,
      height: preset.height,
    };
  }
  if (source.width === preset.width && source.height === preset.height && source.fps === projectFps) {
    return {
      needed: false,
      reason: `已经是 ${preset.width}×${preset.height} @${projectFps}fps，跳过转码`,
      width: preset.width,
      height: preset.height,
    };
  }
  return {
    needed: true,
    reason:
      source.width === preset.width && source.height === preset.height
        ? `画幅已一致，但帧率 ${source.fps}→${projectFps} 需要重采样`
        : `${source.width}×${source.height} → ${preset.width}×${preset.height}（画幅按 cover 裁切，不拉伸）`,
    width: preset.width,
    height: preset.height,
  };
}

export interface TranscodeResult {
  blob: Blob;
  /** 渲染耗时（如实回报；客户据此判断"要不要在部署机上再跑一次"） */
  elapsedMs: number;
  durationFrames: number;
  width: number;
  height: number;
  fps: number;
  /** 是否真的渲染了（false = 已对齐，直接复用原文件） */
  transcoded: boolean;
  reason: string;
}

export async function transcodeToPreset(
  source: TranscodeSource,
  preset: PlatformPreset,
  options: {
    projectFps?: number;
    onProgress?: (message: string, ratio: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<TranscodeResult> {
  const projectFps = options.projectFps ?? DEFAULT_PROJECT_FPS;
  options.onProgress?.('探测源片尺寸…', 0);

  // 1) 探测**真实**时长与尺寸：不能用请求参数里的 durationSec（实测成片 5.09s vs 请求 5s），
  //    否则转码会把尾巴切掉 —— 交付物里这是"看起来对、其实少帧"的那种错。
  const meta = await probeVideoMeta(source.url, projectFps);
  const plan = planTranscode(
    { width: meta.width, height: meta.height, fps: projectFps },
    preset,
    projectFps,
  );

  if (!plan.needed) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`取源片失败（HTTP ${response.status}）`);
    return {
      blob: await response.blob(),
      elapsedMs: 0,
      durationFrames: meta.durationFrames,
      width: meta.width,
      height: meta.height,
      fps: projectFps,
      transcoded: false,
      reason: plan.reason,
    };
  }

  // 2) 目标画幅的**单镜头工程** —— 复用剪辑台的合成（同一套渲染链路，预览与产物逐帧一致）
  const project: EditProject = createProjectFromSource(
    { taskId: source.taskId, url: source.url, durationFrames: meta.durationFrames },
    { fps: projectFps, width: preset.width, height: preset.height, label: preset.label },
  );

  // 3) 能力预检：不能渲染就**如实说**（而不是点了才炸出一个看不懂的错）
  const preflight = await preflightEditExport(project);
  if (!preflight.canRender) {
    const detail = preflight.issues.map((issue) => issue.message).join('；');
    throw new Error(`这台浏览器无法渲染转码（${detail || '未知原因'}）`);
  }

  options.onProgress?.(plan.reason, 0.05);
  const result = await renderEditProject({
    project,
    mediaBaseUrl: window.location.origin,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    onProgress: (progress) => {
      // `EditExportProgress.progress` 是 0~1 的渲染进度
      options.onProgress?.(plan.reason, 0.05 + progress.progress * 0.95);
    },
  });

  return {
    blob: result.blob,
    elapsedMs: result.elapsedMs,
    durationFrames: meta.durationFrames,
    width: preset.width,
    height: preset.height,
    fps: projectFps,
    transcoded: true,
    reason: plan.reason,
  };
}
