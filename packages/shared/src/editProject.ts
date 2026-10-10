import { z } from 'zod';
import type { EditScript } from './edit.js';

/**
 * 剪辑台 Remotion 改版（PLAN §9 台账 B34）的多轨数据模型：Project → Track → Clip。
 *
 * 归属与边界（2026-09-24 用户拍板）：
 * - P1~P3 它是**前端内部模型**（不跨网络、不进后端）；P4 契约迁移时**先改 CONTRACT §11-2**，
 *   再把它提升进 `packages/shared`（契约先行纪律，README 协作规范 7）。
 * - 时间基：所有时间量都是**工程帧**（`project.fps` 下的帧序号），与 Remotion 的
 *   `Sequence from` / `<Video trimBefore>` 同一单位，预览与导出逐帧一致。
 * - 模型组织借鉴 video-shotcraft workbench（Apache-2.0，docs/UPSTREAM.md #11），
 *   字段按本项目语义重写：`source` 指向服务端已落盘的成片（`/media/*`），而非本地卡片库。
 *
 * 四类轨道一次定型（`video` / `caption` / `transition` / `audio`）——
 * P1 只开放视频轨的编辑 UI，其余三类先占住形状（P3 属性面板开放）。
 */

// ── Schema ────────────────────────────────────────────────────────────────

export const EDIT_TRACK_KINDS = ['video', 'caption', 'transition', 'audio'] as const;
export const EditTrackKindSchema = z.enum(EDIT_TRACK_KINDS);
export type EditTrackKind = z.infer<typeof EditTrackKindSchema>;

/** 轨道默认名（UI 显示用） */
export const TRACK_KIND_LABELS: Record<EditTrackKind, string> = {
  video: '镜头',
  caption: '字幕',
  transition: '转场',
  audio: '音效',
};

/**
 * 素材引用：**成片**（`task:`）或**上传资产**（`asset:`，V2.10 / 台账 B57 的音频素材）。
 * `url` 是同源相对地址（`/media/*`），渲染时绝对化（P0 实测坑②）。
 *
 * 为什么 `taskId` 变成可选：音效轨要能取自**上传的音频素材**，而上传资产没有任务 id ——
 * 硬塞一个是伪造溯源。二者**至少有一个**由 `superRefine` 收口（都不给 = 无来源，拒绝）。
 * 消费方要用 `editSourceLabel()` 取显示名，不要直接读 `taskId`（它可能不存在）。
 */
export const EditClipSourceSchema = z
  .object({
    /** 成片来源（任务 id；溯源与「本片剪辑历史」联动用） */
    taskId: z.string().min(1).optional(),
    /** 上传资产来源（V2.10：音频素材） */
    assetId: z.string().min(1).optional(),
    /** 媒体地址（成片 `/media/<taskId>.mp4` / 资产 `/media/assets/<file>`） */
    url: z.string().startsWith('/media/'),
    /**
     * 源片真实时长（工程帧口径），由媒体元数据探测得出（`mediaProbe.ts`）。
     * 它是裁剪上限的唯一依据 —— 不可用请求参数里的 `durationSec` 代替（那是请求值，不是成片事实）。
     */
    durationFrames: z.number().int().min(1),
    /** 资产的可读名字（sidecar 的 `name`，仅显示用；成片来源没有） */
    name: z.string().max(120).optional(),
  })
  .superRefine((source, ctx) => {
    if (source.taskId === undefined && source.assetId === undefined) {
      ctx.addIssue({ code: 'custom', message: '来源必须指明 taskId 或 assetId' });
    }
  });
export type EditClipSource = z.infer<typeof EditClipSourceSchema>;

/**
 * 来源的**显示名**（V2.10）：`name`（上传资产的原始文件名）> `taskId` 前 8 位 > `assetId` 前 8 位。
 *
 * 为什么收口在这里：`taskId` 自 V2.10 起可为空（音频素材没有任务 id），
 * 时间轴标签与属性面板若各自 `slice(0, 8)` 会在资产来源上**崩在 undefined**。
 */
export function editSourceLabel(source: EditClipSource): string {
  if (source.name !== undefined && source.name !== '') return source.name;
  if (source.taskId !== undefined) return source.taskId.slice(0, 8);
  if (source.assetId !== undefined) return source.assetId.slice(0, 8);
  return '素材';
}

const ClipBaseShape = {
  id: z.string().min(1),
  /** 时间轴上的起点（工程帧） */
  startFrame: z.number().int().min(0),
  /** 在时间轴上占据的长度（工程帧） */
  durationFrames: z.number().int().min(1),
};

export const VideoClipSchema = z.object({
  ...ClipBaseShape,
  kind: z.literal('video'),
  source: EditClipSourceSchema,
  /** 裁入点：源片开头跳过多少（工程帧口径），对应 `<Video trimBefore>` */
  trimStartFrames: z.number().int().min(0),
  /** 变速倍率（0.25~4，与既有 EDL 契约 §11-2 同口径）；源片消耗时长 = `durationFrames × speed` */
  speed: z.number().min(0.25).max(4),
  /** 音量（0 = 静音，上限 2，与既有 EDL 契约同口径） */
  volume: z.number().min(0).max(2),
  /** 时间轨上显示的标签（缺省显示来源任务号） */
  label: z.string().max(80).optional(),
});
export type VideoClip = z.infer<typeof VideoClipSchema>;

/** 字幕预设（动效）；`plain` 是静态。动效技法借鉴 video-shotcraft 的 demos/typography（Apache-2.0） */
export const CAPTION_PRESETS = ['plain', 'fade', 'wordSlide', 'typewriter'] as const;
export const CaptionPresetSchema = z.enum(CAPTION_PRESETS);
export type CaptionPreset = z.infer<typeof CaptionPresetSchema>;

/** 字幕纵向位置（合成坐标，三档足够表达"下三分之一 / 居中 / 上三分之一"） */
export const CAPTION_POSITIONS = ['bottom', 'center', 'top'] as const;
export const CaptionPositionSchema = z.enum(CAPTION_POSITIONS);
export type CaptionPosition = z.infer<typeof CaptionPositionSchema>;

export const CAPTION_PRESET_LABELS: Record<CaptionPreset, string> = {
  plain: '静态',
  fade: '淡入淡出',
  wordSlide: '逐词入场（位移+模糊）',
  typewriter: '打字机',
};

export const CAPTION_POSITION_LABELS: Record<CaptionPosition, string> = {
  bottom: '底部',
  center: '居中',
  top: '顶部',
};

export const CaptionClipSchema = z.object({
  ...ClipBaseShape,
  kind: z.literal('caption'),
  text: z.string().min(1).max(200),
  position: CaptionPositionSchema,
  preset: CaptionPresetSchema,
});
export type CaptionClip = z.infer<typeof CaptionClipSchema>;

/** 转场类型（与既有 EDL 契约 §11-2 的 xfade 同口径：fade / wipeleft / slideright） */
export const EDIT_TRANSITIONS = ['fade', 'wipeleft', 'slideright'] as const;
export const ClipTransitionSchema = z.enum(EDIT_TRANSITIONS);
export type EditTransitionKind = z.infer<typeof ClipTransitionSchema>;

export const EDIT_TRANSITION_LABELS: Record<EditTransitionKind, string> = {
  fade: '淡入淡出',
  wipeleft: '左揭幕',
  slideright: '右滑入',
};

/**
 * 转场片段（P3 开放）：坐在 **from → to 两个相邻视频片段的接缝**上。
 *
 * 语义（与渲染实现严格一致，见 `transitionWindow`）：
 * - `from` 与 `to` 必须**同轨且严格相邻**（`to.startFrame === from.end`，加转场前）；
 * - 添加转场时把 `to` 及其后片段**左移 d 帧**（重叠区 = 转场窗口，总时长随之缩短 d）
 *   —— 这让时间轴显示与渲染结果**逐帧一致**（WYSIWYG），而不是"时间轴不动、成片偷偷变短"；
 * - 转场窗口 = `[from.end - d, from.end]`（= `[to.start, to.start + d]`）：
 *   窗口内两段同时在画面上做过渡（`fade` 交叉淡化 / `wipeleft` 揭示 / `slideright` 滑入）；
 * - **任何破坏相邻性的编辑**（移动/裁剪/删除参与方）都会**移除该转场并把 `to` 及其后右移 d 还原**
 *   （`pruneBrokenTransitions`；UI 会给出提示，不静默）。
 */
export const TransitionClipSchema = z.object({
  ...ClipBaseShape,
  kind: z.literal('transition'),
  transition: ClipTransitionSchema,
  fromClipId: z.string().min(1),
  toClipId: z.string().min(1),
});
export type TransitionClip = z.infer<typeof TransitionClipSchema>;

/**
 * 音效片段（V2.10 / 台账 B57）：来源可以是**成片的音轨**（`task:`）或**上传的音频素材**（`asset:`）；
 * `fadeInFrames` / `fadeOutFrames` 是广告片收尾必需的淡入淡出（0 = 不淡）。
 */
export const AudioClipSchema = z.object({
  ...ClipBaseShape,
  kind: z.literal('audio'),
  source: EditClipSourceSchema,
  trimStartFrames: z.number().int().min(0),
  volume: z.number().min(0).max(2),
  /** 淡入帧数（0~durationFrames；缺省 0）。语义见 `audioFadeFactor` 与 CONTRACT §11-2 */
  fadeInFrames: z.number().int().min(0).optional(),
  /** 淡出帧数（0~durationFrames；缺省 0） */
  fadeOutFrames: z.number().int().min(0).optional(),
});
export type AudioClip = z.infer<typeof AudioClipSchema>;

/**
 * 淡入淡出的音量系数（V2.10 / B57）——**预览与导出同一套实现**（渲染层只调用，不另写一份）。
 *
 * `frameInClip` = **相对片段起点**的帧号（`<Sequence from>` 内的 frame 就是这个口径）。
 * 规则：淡入段线性 `f/fadeIn`、淡出段线性 `(duration-f)/fadeOut`，**两段重叠时取较小值**
 * （不会因两段叠加而放大）；`fadeIn + fadeOut > duration` 时不报错（曲线语义是"最多这么长"）。
 * 边界：`f = 0` 时淡入系数为 0、`f = duration` 时淡出系数为 0（真正的淡入淡出而不是"少淡一点"）。
 */
export function audioFadeFactor(
  clip: Pick<AudioClip, 'durationFrames' | 'fadeInFrames' | 'fadeOutFrames'>,
  frameInClip: number,
): number {
  const total = Math.max(1, clip.durationFrames);
  const fadeIn = Math.min(clip.fadeInFrames ?? 0, total);
  const fadeOut = Math.min(clip.fadeOutFrames ?? 0, total);
  const frame = Math.min(Math.max(frameInClip, 0), total);
  let factor = 1;
  if (fadeIn > 0 && frame < fadeIn) factor = Math.min(factor, frame / fadeIn);
  if (fadeOut > 0 && frame > total - fadeOut) factor = Math.min(factor, (total - frame) / fadeOut);
  return factor;
}

/** 某帧的**实际音量** = `volume × audioFadeFactor`（渲染层用它，别自己算） */
export function audioVolumeAt(clip: AudioClip, frameInClip: number): number {
  return clip.volume * audioFadeFactor(clip, frameInClip);
}

/**
 * 传给渲染层 `volume` prop 的值（V2.10 / B57）：无淡入淡出时给**常量**
 * （Remotion 能走静态音量路径，不必逐帧求值），有淡变时给帧函数。
 *
 * 帧口径：Remotion 在 `<Sequence>` 内传给 volume 回调的帧就是**相对片段起点**的帧
 * （实测 `remotion/dist/cjs/audio/use-audio-frame.js`：`useCurrentFrame() + cumulatedNegativeFrom`），
 * 与 `audioVolumeAt` 的 `frameInClip` 同口径 —— 因此可以直传。
 */
export function audioVolumeProp(clip: AudioClip): number | ((frame: number) => number) {
  if ((clip.fadeInFrames ?? 0) === 0 && (clip.fadeOutFrames ?? 0) === 0) return clip.volume;
  return (frame: number) => audioVolumeAt(clip, frame);
}

export const EditClipSchema = z.discriminatedUnion('kind', [
  VideoClipSchema,
  CaptionClipSchema,
  TransitionClipSchema,
  AudioClipSchema,
]);
export type EditClip = z.infer<typeof EditClipSchema>;

export const EditTrackSchema = z
  .object({
    id: z.string().min(1),
    kind: EditTrackKindSchema,
    clips: z.array(EditClipSchema),
    muted: z.boolean().optional(),
  })
  .superRefine((track, ctx) => {
    // 判别联合管不住「字幕轨里塞视频片段」这种跨字段错误，在这里收口
    for (const clip of track.clips) {
      if (clip.kind !== track.kind) {
        ctx.addIssue({
          code: 'custom',
          message: `轨道「${track.kind}」里出现了 ${clip.kind} 片段`,
        });
      }
    }
  });
export type EditTrack = z.infer<typeof EditTrackSchema>;

export const EDIT_PROJECT_VERSION = 1;

/** 默认帧率：30（shotcraft 同口径）。源片 24fps 时按时间对齐而非帧对齐，不产生采样错位 */
export const DEFAULT_PROJECT_FPS = 30;
/** 探测不到源片尺寸时的兜底画幅（720p） */
export const DEFAULT_PROJECT_WIDTH = 1280;
export const DEFAULT_PROJECT_HEIGHT = 720;

export const EditProjectSchema = z.object({
  version: z.literal(EDIT_PROJECT_VERSION),
  fps: z.number().int().min(1).max(120),
  width: z.number().int().min(2),
  height: z.number().int().min(2),
  tracks: z.array(EditTrackSchema),
});
export type EditProject = z.infer<typeof EditProjectSchema>;

// ── 版本迁移（V2.21 / 台账 B66）─────────────────────────────────────────────

export interface EditProjectMigrationOk {
  ok: true;
  project: EditProject;
  /** 来自哪个版本（与当前版本相同 = null，表示没迁移过） */
  migratedFrom: number | null;
  /** 迁移过程中做了什么（**给人看的**，会出现在界面上） */
  notes: string[];
}

export interface EditProjectMigrationFail {
  ok: false;
  /** 给用户看的原因（含"该怎么做"） */
  reason: string;
  /** 来自更新的版本时带上它（调用方可以据此显示 vN > vM） */
  futureVersion?: number;
}

/**
 * 把一份**来路不明**的工程 JSON 迁到当前版本（n8n 的 node type versioning 思路，独立实现）。
 *
 * ## 为什么必须有它
 * 草稿是**存在浏览器里**的，而 schema 会随版本演进。没有迁移函数时，
 * `version: z.literal(1)` 一旦升到 2，**所有老草稿会全部读不出来** ——
 * 用户看到的现象是"我的剪辑怎么没了"。这也是"旧文件必须能被打开"这条 B 端硬要求的落点。
 *
 * ## 三条口径
 * 1. **只做前向兼容**：来自**更新**版本的文件明确拒绝，并说清"请升级后再打开"
 *    （假装能读一份未来格式 = 悄悄丢字段）；
 * 2. **每一步都要留痕**：做过什么迁移写进 `notes`，界面上如实展示；
 * 3. **失败不抛异常、不返回半成品**：给出原因字符串，调用方决定"保留原文 / 提示用户"。
 *
 * 加字段时的动作：把 `EDIT_PROJECT_VERSION` 加一，然后在下面的链里补一步
 * `if (version < N) { …改数据…; version = N; notes.push('…') }`，并补一条"老文件能打开"的测试。
 */
export function migrateEditProject(raw: unknown): EditProjectMigrationOk | EditProjectMigrationFail {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: '这不是一份剪辑工程（顶层不是对象）' };
  }

  const notes: string[] = [];
  // 结构上只复制一层：迁移步骤改的都是浅字段，深拷贝没必要（且要 JSON 往返，反而丢 undefined）
  const draft: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const rawVersion = draft['version'];

  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 1) {
    // 没有版本号：早期手写/被改过的文件。按 v1 试一遍，**并如实标注**
    draft['version'] = 1;
    notes.push('文件没有版本号，按 v1 处理');
  } else if (rawVersion > EDIT_PROJECT_VERSION) {
    return {
      ok: false,
      futureVersion: rawVersion,
      reason: `这份工程来自更新的版本（v${rawVersion} > 本机 v${EDIT_PROJECT_VERSION}）：请升级本机版本后再打开`,
    };
  }

  let version = typeof draft['version'] === 'number' ? (draft['version'] as number) : 1;
  const migratedFrom = version === EDIT_PROJECT_VERSION ? null : version;

  // ── 迁移链（目前只有 v1，所以这里是空的；加版本时在这里补步）──
  // 例：if (version < 2) { draft.someNewField = default; version = 2; notes.push('v1 → v2：补 someNewField'); }

  const parsed = EditProjectSchema.safeParse(draft);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: `工程内容不完整或格式不对${first === undefined ? '' : `：${first.path.join('.')} ${first.message}`}`,
    };
  }

  if (version !== EDIT_PROJECT_VERSION) {
    // 走到这里说明迁移链没把它带到当前版本（加版本时忘了补步）—— 明确报错而不是"装作成功"
    return { ok: false, reason: `内部错误：迁移链没把 v${version} 带到 v${EDIT_PROJECT_VERSION}` };
  }

  return { ok: true, project: parsed.data, migratedFrom, notes };
}

/** 剪辑来源摘要（`TaskProgress.origin` 的 edit 分支；两代剪辑产物共用一句人话） */
export type EditOriginLike = {
  sourceTaskId: string;
  script?: EditScript;
  project?: EditProject;
};

export function describeEditOrigin(origin: EditOriginLike): string {
  if (origin.project !== undefined) {
    const clips = origin.project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
    return `${origin.project.tracks.length} 轨 · ${clips} 个片段`;
  }
  if (origin.script !== undefined) return `${origin.script.operations.length} 步 EDL`;
  return '剪辑产物';
}

// ── 常量与 id ─────────────────────────────────────────────────────────────

/** 片段最小长度（工程帧）：再短就既点不中也没有语义 */
export const MIN_CLIP_FRAMES = 2;

let uidSeq = 0;
/** 进程内唯一 id（时间戳 + 自增；不需要密码学强度，只是 React key 与选择锚点） */
export function uid(prefix: string): string {
  uidSeq += 1;
  return `${prefix}_${Date.now().toString(36)}_${uidSeq.toString(36)}`;
}

// ── 纯函数（全部不可变更新：返回新 project，原对象不动） ──────────────────

export function clipEndFrame(clip: Pick<EditClip, 'startFrame' | 'durationFrames'>): number {
  return clip.startFrame + clip.durationFrames;
}

/**
 * 渲染层级（P3 定稿）：**由轨道类型决定**，不依赖 `tracks` 数组顺序
 * （数组顺序 = UI 阅读顺序：镜头 / 转场 / 字幕 / 音效，与用户的直觉一致）。
 * 返回顺序 = 从下往上：视频在下、字幕在上；转场不产生画面（只作用于接缝）、音效无画面。
 */
export const TRACK_RENDER_ORDER: readonly EditTrackKind[] = ['video', 'transition', 'caption', 'audio'];

/** 从源片创建初始工程：四轨一次建齐（镜头轨铺满源片全长，其余为空轨） */
export function createProjectFromSource(
  source: EditClipSource,
  opts?: { fps?: number; width?: number; height?: number; label?: string },
): EditProject {
  const fps = opts?.fps ?? DEFAULT_PROJECT_FPS;
  const clip: VideoClip = {
    kind: 'video',
    id: uid('clip'),
    startFrame: 0,
    durationFrames: source.durationFrames,
    trimStartFrames: 0,
    speed: 1,
    volume: 1,
    source,
    ...(opts?.label === undefined ? {} : { label: opts.label }),
  };
  return {
    version: EDIT_PROJECT_VERSION,
    fps,
    width: opts?.width ?? DEFAULT_PROJECT_WIDTH,
    height: opts?.height ?? DEFAULT_PROJECT_HEIGHT,
    // 顺序 = UI 阅读顺序（镜头 / 转场 / 字幕 / 音效）；渲染层级见 TRACK_RENDER_ORDER
    tracks: [
      { id: uid('track'), kind: 'video', clips: [clip] },
      { id: uid('track'), kind: 'transition', clips: [] },
      { id: uid('track'), kind: 'caption', clips: [] },
      { id: uid('track'), kind: 'audio', clips: [] },
    ],
  };
}

/** 取某类轨道（本模型每类轨道各一条；找不到返回 null） */
export function trackOfKind(project: EditProject, kind: EditTrackKind): EditTrack | null {
  return project.tracks.find((track) => track.kind === kind) ?? null;
}

/** 内容精确结束帧（最晚 clip 结束；导出时长用它） */
export function contentEndFrame(project: EditProject): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEndFrame(clip));
  }
  return end;
}

/** 预览总时长：内容结束 + 1s 余量，最短 2s（编辑时播放头有处可去；导出不用它） */
export function previewDurationFrames(project: EditProject): number {
  return Math.max(2 * project.fps, contentEndFrame(project) + project.fps);
}

export function findClip(
  project: EditProject,
  clipId: string,
): { track: EditTrack; clip: EditClip } | null {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === clipId) return { track, clip };
    }
  }
  return null;
}

/** 在第一条视频轨末尾（或 `atFrame`）追加一个铺满源片全长的 clip；没有视频轨则创建 */
export function addVideoClip(
  project: EditProject,
  source: EditClipSource,
  atFrame?: number,
): { project: EditProject; clipId: string } {
  const clip: VideoClip = {
    kind: 'video',
    id: uid('clip'),
    startFrame: 0,
    durationFrames: source.durationFrames,
    trimStartFrames: 0,
    speed: 1,
    volume: 1,
    source,
  };

  const tracks = [...project.tracks];
  let trackIndex = tracks.findIndex((track) => track.kind === 'video');
  if (trackIndex === -1) {
    tracks.unshift({ id: uid('track'), kind: 'video', clips: [] });
    trackIndex = 0;
  }
  const track = tracks[trackIndex]!;
  const start = atFrame ?? track.clips.reduce((end, item) => Math.max(end, clipEndFrame(item)), 0);
  const placed: VideoClip = { ...clip, startFrame: Math.max(0, Math.round(start)) };
  tracks[trackIndex] = { ...track, clips: [...track.clips, placed] };
  return { project: { ...project, tracks }, clipId: placed.id };
}

/**
 * 添加字幕片段（P3）：放在 `atFrame`（缺省 0），若与现有字幕重叠则**依次右推**到最近的空位。
 * 时长缺省 2s（`fps × 2`）。
 */
export function addCaptionClip(
  project: EditProject,
  opts?: { atFrame?: number; text?: string; durationFrames?: number },
): { project: EditProject; clipId: string } {
  const duration = Math.max(MIN_CLIP_FRAMES, Math.round(opts?.durationFrames ?? project.fps * 2));
  const track = trackOfKind(project, 'caption');
  const others = (track?.clips ?? []).slice().sort((a, b) => a.startFrame - b.startFrame);
  let start = Math.max(0, Math.round(opts?.atFrame ?? 0));
  // 重叠则右推到最近的空位（字幕轨上不允许两条字幕叠着显示）
  for (let guard = 0; guard < 64; guard += 1) {
    const hit = others.find(
      (other) => start < clipEndFrame(other) && start + duration > other.startFrame,
    );
    if (hit === undefined) break;
    start = clipEndFrame(hit);
  }
  const clip: CaptionClip = {
    kind: 'caption',
    id: uid('clip'),
    startFrame: start,
    durationFrames: duration,
    text: opts?.text ?? '字幕文本',
    position: 'bottom',
    preset: 'plain',
  };
  return { project: appendClipToTrack(project, 'caption', clip), clipId: clip.id };
}

/** 添加音效片段（P3）：素材取自成片（`/media/*`），默认追加在音效轨末尾 */
export function addAudioClip(
  project: EditProject,
  source: EditClipSource,
  atFrame?: number,
): { project: EditProject; clipId: string } {
  const track = trackOfKind(project, 'audio');
  const start =
    atFrame ?? (track?.clips ?? []).reduce((end, clip) => Math.max(end, clipEndFrame(clip)), 0);
  const clip: AudioClip = {
    kind: 'audio',
    id: uid('clip'),
    startFrame: Math.max(0, Math.round(start)),
    durationFrames: source.durationFrames,
    trimStartFrames: 0,
    volume: 1,
    source,
  };
  return { project: appendClipToTrack(project, 'audio', clip), clipId: clip.id };
}

/** 往某类轨道追加片段（轨不存在时创建；内部用） */
function appendClipToTrack(project: EditProject, kind: EditTrackKind, clip: EditClip): EditProject {
  const track = trackOfKind(project, kind);
  if (track === null) {
    return { ...project, tracks: [...project.tracks, { id: uid('track'), kind, clips: [clip] }] };
  }
  return {
    ...project,
    tracks: project.tracks.map((item) =>
      item.id === track.id ? { ...item, clips: [...item.clips, clip] } : item,
    ),
  };
}

// ── 属性面板的字段更新（P3；面板是 schema 驱动的通用渲染器，见 clipProperties.ts） ──

/** 面板可写的字段集合（按 clip 种类判别；值域在此收口，面板只负责采集输入） */
export type ClipPatch =
  | { kind: 'video'; speed?: number; volume?: number; label?: string | null }
  | { kind: 'caption'; text?: string; position?: CaptionPosition; preset?: CaptionPreset }
  | { kind: 'audio'; volume?: number; fadeInFrames?: number; fadeOutFrames?: number }
  | { kind: 'transition'; transition?: EditTransitionKind; durationFrames?: number };

/**
 * 按 `ClipPatch` 更新片段字段。**非法值被就地钳制**（而不是报错丢掉整次编辑），
 * 但 `kind` 不匹配（例如给字幕发 speed）直接原样返回 —— 那属于调用方的 bug，不该静默生效。
 */
export function updateClipFields(project: EditProject, clipId: string, patch: ClipPatch): EditProject {
  const found = findClip(project, clipId);
  if (found === null || found.clip.kind !== patch.kind) return project;
  const clip = found.clip;

  if (clip.kind === 'video' && patch.kind === 'video') {
    const sourceAvailable = clip.source.durationFrames - clip.trimStartFrames;
    const maxSpeed = Math.max(0.25, Math.min(4, sourceAvailable / Math.max(1, clip.durationFrames)));
    const speed = patch.speed === undefined ? clip.speed : clamp(patch.speed, 0.25, maxSpeed);
    const volume = patch.volume === undefined ? clip.volume : clamp(patch.volume, 0, 2);
    const next: VideoClip = {
      ...clip,
      speed: Math.round(speed * 100) / 100,
      volume: Math.round(volume * 100) / 100,
    };
    if (patch.label !== undefined) {
      const label = (patch.label ?? '').trim();
      if (label === '') {
        delete next.label;
      } else {
        next.label = label.slice(0, 80);
      }
    }
    return mapClip(project, clipId, () => next);
  }

  if (clip.kind === 'caption' && patch.kind === 'caption') {
    const next: CaptionClip = {
      ...clip,
      text: patch.text === undefined ? clip.text : patch.text.trim().slice(0, 200) || clip.text,
      position: patch.position ?? clip.position,
      preset: patch.preset ?? clip.preset,
    };
    return mapClip(project, clipId, () => next);
  }

  if (clip.kind === 'audio' && patch.kind === 'audio') {
    const volume = patch.volume === undefined ? clip.volume : clamp(patch.volume, 0, 2);
    const next: AudioClip = { ...clip, volume: Math.round(volume * 100) / 100 };
    // 淡入淡出（V2.10 / B57）：钳到 [0, durationFrames] —— 曲线语义是"最多这么长"，
    // 两段之和可以超过总长（重叠时取较小值，见 audioFadeFactor），因此不做"和 ≤ 总长"的额外约束
    if (patch.fadeInFrames !== undefined) {
      next.fadeInFrames = clamp(Math.round(patch.fadeInFrames), 0, clip.durationFrames);
    }
    if (patch.fadeOutFrames !== undefined) {
      next.fadeOutFrames = clamp(Math.round(patch.fadeOutFrames), 0, clip.durationFrames);
    }
    return mapClip(project, clipId, () => next);
  }

  if (clip.kind === 'transition' && patch.kind === 'transition') {
    // 时长变更要走「移除 + 重加」：它同时改变后继片段的左移量（重叠区）
    if (patch.durationFrames !== undefined) {
      const from = findClip(project, clip.fromClipId);
      const to = findClip(project, clip.toClipId);
      if (from === null || to === null || from.clip.kind !== 'video' || to.clip.kind !== 'video') {
        return project;
      }
      const limit = maxTransitionFrames(project, from.clip, to.clip);
      if (limit === null) return project;
      const duration = clamp(Math.round(patch.durationFrames), MIN_TRANSITION_FRAMES, limit);
      const without = removeTransitionInternal(project, clip.id);
      const readded = addTransition(
        without,
        clip.fromClipId,
        patch.transition ?? clip.transition,
        duration,
      );
      if (!readded.ok) return project;
      // 「移除 + 重加」会生成新 id —— 把 id 改回原值，选择态与属性面板不因一次改值而失焦
      return {
        ...readded.project,
        tracks: readded.project.tracks.map((track) => ({
          ...track,
          clips: track.clips.map((item) =>
            item.id === readded.clipId ? { ...item, id: clip.id } : item,
          ),
        })),
      };
    }
    return mapClip(project, clipId, () => ({ ...clip, transition: patch.transition ?? clip.transition }));
  }

  return project;
}

/**
 * 某视频片段参与的两个转场（渲染用）：`in` = 它是后段、`out` = 它是前段。
 * 两个窗口都是 `durationFrames` 长、紧贴接缝 —— Composition 用它做过渡样式插值。
 */
export function transitionWindow(
  project: EditProject,
  clipId: string,
): { in: TransitionClip | null; out: TransitionClip | null } {
  const track = trackOfKind(project, 'transition');
  let incoming: TransitionClip | null = null;
  let outgoing: TransitionClip | null = null;
  for (const clip of track?.clips ?? []) {
    if (clip.kind !== 'transition') continue;
    if (clip.toClipId === clipId) incoming = clip;
    if (clip.fromClipId === clipId) outgoing = clip;
  }
  return { in: incoming, out: outgoing };
}

/**
 * 同轨邻居边界（防重叠约束的依据）：`prevEnd` = 完全在本 clip 之前的最大尾帧，
 * `nextStart` = 完全在本 clip 之后的最小首帧（无则 null）。
 *
 * 为什么要防重叠：同一条视频轨上两个 clip 重叠 = 两路画面叠加播放，剪辑语义是坏的
 * （剪映 / Premiere 的同轨都是磁吸撞墙）。拖拽全程 clip 被钳制在同一空隙内，
 * 因此邻居集合在拖动中稳定不变（自洽）。
 */
export function neighborBounds(
  project: EditProject,
  clipId: string,
): { prevEnd: number; nextStart: number | null } | null {
  const found = findClip(project, clipId);
  if (found === null) return null;
  let prevEnd = 0;
  let nextStart: number | null = null;
  for (const other of found.track.clips) {
    if (other.id === clipId) continue;
    if (clipEndFrame(other) <= found.clip.startFrame) {
      prevEnd = Math.max(prevEnd, clipEndFrame(other));
    } else if (other.startFrame >= clipEndFrame(found.clip)) {
      nextStart = nextStart === null ? other.startFrame : Math.min(nextStart, other.startFrame);
    }
  }
  return { prevEnd, nextStart };
}

/** 移动 clip 到指定起点（取整；钳制在「0 点 ~ 同轨邻居空隙」内，空隙放不下则原地不动） */
export function moveClip(project: EditProject, clipId: string, toFrame: number): EditProject {
  // 移动 = 破坏参与方转场的相邻性 → 先移除转场并还原布局（与移动同一帧完成，不产生中间态）
  const clean = removeTransitionsInvolving(project, clipId).project;
  const bounds = neighborBounds(clean, clipId);
  if (bounds === null) return clean;
  const found = findClip(clean, clipId);
  if (found === null) return clean;
  const duration = found.clip.durationFrames;
  const maxStart =
    bounds.nextStart === null
      ? Number.MAX_SAFE_INTEGER
      : bounds.nextStart - duration;
  if (maxStart < bounds.prevEnd) return clean; // 空隙比 clip 短：哪儿也去不了
  const start = clamp(Math.round(toFrame), bounds.prevEnd, maxStart);
  return mapClip(clean, clipId, (clip) => ({ ...clip, startFrame: start }));
}

/** clip 的几何快照（拖拽起点处的值；裁剪拖拽以此为基准，避免增量钳制累积误差） */
export interface ClipGeometry {
  startFrame: number;
  durationFrames: number;
  trimStartFrames: number;
  speed: number;
  /** 源片约束下的最大时长（帧）；无源片的 clip（字幕/转场）为 null */
  maxDurationFrames: number | null;
}

/** clip 当前的几何快照（裁剪拖拽的基准；TimelineClip 与 trimClip 共用） */
export function clipGeometry(clip: EditClip): ClipGeometry {
  const hasSource = clip.kind === 'video' || clip.kind === 'audio';
  const trimStartFrames = hasSource ? clip.trimStartFrames : 0;
  const speed = clip.kind === 'video' ? clip.speed : 1;
  return {
    startFrame: clip.startFrame,
    durationFrames: clip.durationFrames,
    trimStartFrames,
    speed,
    maxDurationFrames: hasSource
      ? Math.floor((clip.source.durationFrames - trimStartFrames) / speed)
      : null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 裁剪 clip 边缘。`side='left'` 动起点（同步平移 startFrame 与 trimStartFrames），
 * `side='right'` 动时长。约束：起点 ≥ 0、时长 ≥ MIN_CLIP_FRAMES、裁入点 ≥ 0、
 * 不超过源片真实时长（`maxDurationFrames`）、不与同轨邻居重叠（`neighborBounds`）。
 * `base` 缺省时以 clip 当前几何为基准。
 */
export function trimClip(
  project: EditProject,
  clipId: string,
  side: 'left' | 'right',
  deltaFrames: number,
  base?: ClipGeometry,
): EditProject {
  const pruned = removeTransitionsInvolving(project, clipId);
  const clean = pruned.project;
  const found = findClip(clean, clipId);
  if (found === null) return clean;
  // 移除过转场时，`to` 片段的实际位置刚被还原（+d），拖拽基准快照随之过期 → 重新取几何
  const geo = pruned.removed > 0 || base === undefined ? clipGeometry(found.clip) : base;
  const bounds = neighborBounds(clean, clipId);
  const hasSource = found.clip.kind === 'video' || found.clip.kind === 'audio';

  if (side === 'left') {
    const delta = clamp(
      Math.round(deltaFrames),
      Math.max(
        -geo.startFrame,
        Math.ceil(-geo.trimStartFrames / geo.speed),
        (bounds?.prevEnd ?? 0) - geo.startFrame,
      ),
      geo.durationFrames - MIN_CLIP_FRAMES,
    );
    return mapClip(clean, clipId, (clip) => ({
      ...clip,
      startFrame: geo.startFrame + delta,
      durationFrames: geo.durationFrames - delta,
      ...(hasSource ? { trimStartFrames: geo.trimStartFrames + Math.round(delta * geo.speed) } : {}),
    }));
  }

  const delta = clamp(
    Math.round(deltaFrames),
    MIN_CLIP_FRAMES - geo.durationFrames,
    Math.min(
      geo.maxDurationFrames === null
        ? Number.MAX_SAFE_INTEGER
        : geo.maxDurationFrames - geo.durationFrames,
      bounds?.nextStart === null || bounds === null
        ? Number.MAX_SAFE_INTEGER
        : bounds.nextStart - geo.startFrame - geo.durationFrames,
    ),
  );
  return mapClip(clean, clipId, (clip) => ({
    ...clip,
    durationFrames: geo.durationFrames + delta,
  }));
}

export function removeClip(project: EditProject, clipId: string): EditProject {
  // 删掉转场参与方 → 先移除该转场并把被左移的片段还原，再删（避免留下"重叠但无转场"的坏状态）
  const clean = removeTransitionsInvolving(project, clipId).project;
  return {
    ...clean,
    tracks: clean.tracks.map((track) =>
      track.clips.some((clip) => clip.id === clipId)
        ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }
        : track,
    ),
  };
}

// ── 转场（P3）：添加 / 移除 / 破损清理 ──────────────────────────────────────

/** 转场时长范围（工程帧）：太短看不清，太长会吃掉整个镜头 */
export const MIN_TRANSITION_FRAMES = 6;
export const MAX_TRANSITION_FRAMES = 60;
/** 新转场的默认时长（0.5s @30fps；面板里可改） */
export const DEFAULT_TRANSITION_FRAMES = 15;

/**
 * 转场窗口的可行时长上限：受两端片段长度与 `MAX_TRANSITION_FRAMES` / 2s 共同约束。
 * 返回 null = 这个接缝放不下任何转场（片段太短）。
 */
export function maxTransitionFrames(project: EditProject, from: VideoClip, to: VideoClip): number | null {
  const limit = Math.min(
    MAX_TRANSITION_FRAMES,
    project.fps * 2,
    from.durationFrames - 1,
    to.durationFrames - 1,
  );
  return limit < MIN_TRANSITION_FRAMES ? null : limit;
}

/** 把某轨上「起点 ≥ fromStartFrame 的其它片段」整体平移（内部用；只在转场增删时调用） */
function shiftTrackFrom(track: EditTrack, anchorClipId: string, delta: number): EditTrack {
  const anchor = track.clips.find((clip) => clip.id === anchorClipId);
  if (anchor === undefined || delta === 0) return track;
  const shifted = track.clips.map((clip) =>
    clip.id === anchorClipId || clip.startFrame >= anchor.startFrame
      ? { ...clip, startFrame: Math.max(0, clip.startFrame + delta) }
      : clip,
  );
  return { ...track, clips: shifted };
}

/** 把某轨上「起点 ≥ anchor.startFrame 的其它片段」整体右移（转场移除时的还原动作） */
function restoreShift(track: EditTrack, anchorClipId: string, delta: number): EditTrack {
  return shiftTrackFrom(track, anchorClipId, Math.max(0, delta));
}

/** 某个转场是否仍然成立（两端存在、同轨、严格符合窗口定义） */
function isTransitionIntact(project: EditProject, transition: TransitionClip): boolean {
  const from = findClip(project, transition.fromClipId);
  const to = findClip(project, transition.toClipId);
  if (from === null || to === null) return false;
  if (from.clip.kind !== 'video' || to.clip.kind !== 'video') return false;
  if (from.track.id !== to.track.id) return false;
  const windowStart = clipEndFrame(from.clip) - transition.durationFrames;
  return (
    transition.durationFrames >= MIN_TRANSITION_FRAMES &&
    to.clip.startFrame === windowStart &&
    transition.startFrame === windowStart
  );
}

/** 移除一个转场：把被左移的 `to` 及其后片段右移还原，再删掉转场块（内部用，不做存在性校验） */
function removeTransitionInternal(project: EditProject, transitionClipId: string): EditProject {
  const transitionTrack = trackOfKind(project, 'transition');
  const transition = transitionTrack?.clips.find(
    (clip): clip is TransitionClip => clip.id === transitionClipId && clip.kind === 'transition',
  );
  if (transitionTrack === null || transition === undefined) return project;

  const videoTrack = trackOfKind(project, 'video');
  const restored =
    videoTrack === null
      ? project
      : {
          ...project,
          tracks: project.tracks.map((track) =>
            track.id === videoTrack.id
              ? restoreShift(track, transition.toClipId, transition.durationFrames)
              : track,
          ),
        };
  return {
    ...restored,
    tracks: restored.tracks.map((track) =>
      track.id === transitionTrack.id
        ? { ...track, clips: track.clips.filter((clip) => clip.id !== transitionClipId) }
        : track,
    ),
  };
}

/**
 * 清掉「已经不成立」的转场（两端被移动/裁剪/删除，或窗口定义被破坏）。
 * `onlyClipId` 给出时只检查与该片段相关的转场（移动/裁剪/删除的热路径）。
 * 返回新工程与被移除的数量 —— 数量 > 0 时 UI 应给用户一条提示（不静默）。
 */
export function pruneBrokenTransitions(
  project: EditProject,
  onlyClipId?: string,
): { project: EditProject; removed: number } {
  const transitionTrack = trackOfKind(project, 'transition');
  if (transitionTrack === null || transitionTrack.clips.length === 0) {
    return { project, removed: 0 };
  }
  let result = project;
  let removed = 0;
  for (const clip of transitionTrack.clips) {
    if (clip.kind !== 'transition') continue;
    if (onlyClipId !== undefined && clip.fromClipId !== onlyClipId && clip.toClipId !== onlyClipId) {
      continue;
    }
    if (isTransitionIntact(result, clip)) continue;
    result = removeTransitionInternal(result, clip.id);
    removed += 1;
  }
  return { project: result, removed };
}

/**
 * 无条件移除**所有**与该片段相关的转场（移动/裁剪/删除的热路径）。
 *
 * 为什么不是"只移除已破损的"：破损是**这次编辑将要造成**的，
 * 编辑前它们是完好的（prune 检测不到）；而一旦移动到一半再检查，
 * 还原位移（把 `to` 右移 d）就会叠加在用户的新位置上 —— 语义就乱了。
 * 所以规则是：**动它 = 它的转场先退场**（与剪映等编辑器一致），编辑在干净布局上执行。
 */
export function removeTransitionsInvolving(
  project: EditProject,
  clipId: string,
): { project: EditProject; removed: number } {
  const transitionTrack = trackOfKind(project, 'transition');
  if (transitionTrack === null || transitionTrack.clips.length === 0) {
    return { project, removed: 0 };
  }
  let result = project;
  let removed = 0;
  for (const clip of transitionTrack.clips) {
    if (clip.kind !== 'transition') continue;
    if (clip.fromClipId !== clipId && clip.toClipId !== clipId) continue;
    result = removeTransitionInternal(result, clip.id);
    removed += 1;
  }
  return { project: result, removed };
}

export type AddTransitionResult =
  | { ok: true; project: EditProject; clipId: string }
  | { ok: false; reason: string };

/**
 * 在 `fromClipId` 与其**同轨相邻**后继片段之间添加转场：
 * 把后继片段及其后片段左移 d 帧，转场块落在接缝窗口上（WYSIWYG，见 TransitionClipSchema 注释）。
 */
export function addTransition(
  project: EditProject,
  fromClipId: string,
  kind: EditTransitionKind,
  durationFrames: number,
): AddTransitionResult {
  const found = findClip(project, fromClipId);
  if (found === null || found.clip.kind !== 'video' || found.track.kind !== 'video') {
    return { ok: false, reason: '转场只能加在两个视频片段之间' };
  }

  // 该片段已有出向转场 → 先移除（还原被左移的后继），再重加 = 替换
  // （必须在相邻性检查之前做：左移后 `next.start < from.end`，直接查找会误判"没有相邻片段"）
  const existing = trackOfKind(project, 'transition')?.clips.find(
    (clip): clip is TransitionClip => clip.kind === 'transition' && clip.fromClipId === fromClipId,
  );
  const base = existing === undefined ? project : removeTransitionInternal(project, existing.id);

  const baseFound = findClip(base, fromClipId);
  if (baseFound === null || baseFound.clip.kind !== 'video') {
    return { ok: false, reason: '转场只能加在两个视频片段之间' };
  }
  const from = baseFound.clip;
  const sameTrack = baseFound.track.clips
    .filter((clip): clip is VideoClip => clip.kind === 'video')
    .sort((a, b) => a.startFrame - b.startFrame);
  const next = sameTrack.find((clip) => clip.id !== from.id && clip.startFrame >= clipEndFrame(from));
  if (next === undefined) {
    return { ok: false, reason: '该片段后面没有相邻片段（转场需要两段首尾相接）' };
  }
  if (next.startFrame !== clipEndFrame(from)) {
    return { ok: false, reason: '两个片段之间有空隙（转场需要首尾相接，先把后一段拖到紧贴）' };
  }
  const limit = maxTransitionFrames(base, from, next);
  if (limit === null) {
    return { ok: false, reason: '片段太短，放不下转场（至少需要 6 帧窗口）' };
  }
  const duration = clamp(Math.round(durationFrames), MIN_TRANSITION_FRAMES, limit);

  const transition: TransitionClip = {
    kind: 'transition',
    id: uid('clip'),
    startFrame: clipEndFrame(from) - duration,
    durationFrames: duration,
    transition: kind,
    fromClipId: from.id,
    toClipId: next.id,
  };
  const tracks = base.tracks.map((track) => {
    if (track.id === found.track.id) {
      return shiftTrackFrom(track, next.id, -duration);
    }
    if (track.kind === 'transition') {
      return { ...track, clips: [...track.clips, transition] };
    }
    return track;
  });
  return { ok: true, project: { ...base, tracks }, clipId: transition.id };
}

/** 显式移除转场（UI 的「移除转场」动作）：移除 + 把后继片段右移还原 */
export function removeTransition(project: EditProject, transitionClipId: string): EditProject {
  return removeTransitionInternal(project, transitionClipId);
}

function mapClip(
  project: EditProject,
  clipId: string,
  fn: (clip: EditClip) => EditClip,
): EditProject {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.clips.some((clip) => clip.id === clipId)
        ? { ...track, clips: track.clips.map((clip) => (clip.id === clipId ? fn(clip) : clip)) }
        : track,
    ),
  };
}

// ── 吸附（时间轴拖拽用） ──────────────────────────────────────────────────

/** 吸附候选：时间轴 0 点 + 播放头 + 其他 clip 的首尾（帧） */
export function collectSnapTargets(
  project: EditProject,
  excludeClipId: string,
  playheadFrame: number,
): number[] {
  const targets = [0, playheadFrame];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.push(clip.startFrame, clipEndFrame(clip));
    }
  }
  return targets;
}

/** 起点或尾缘进入容差则吸附到候选帧；否则原样返回 */
export function applySnap(
  startFrame: number,
  durationFrames: number,
  targets: number[],
  toleranceFrames: number,
): number {
  for (const target of targets) {
    if (Math.abs(startFrame - target) < toleranceFrames) return Math.round(target);
    if (Math.abs(startFrame + durationFrames - target) < toleranceFrames) {
      return Math.round(target - durationFrames);
    }
  }
  return startFrame;
}
