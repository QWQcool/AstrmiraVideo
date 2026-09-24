import { z } from 'zod';

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

/** 素材引用：服务端已落盘的成片。`url` 是同源相对地址（`/media/*`），渲染时绝对化（P0 实测坑②） */
export const EditClipSourceSchema = z.object({
  /** 来源任务 id（溯源与「本片剪辑历史」联动用） */
  taskId: z.string().min(1),
  /** 成片地址（`/media/<file>.mp4`） */
  url: z.string().startsWith('/media/'),
  /**
   * 源片真实时长（工程帧口径），由 `<video>` 元数据探测得出（`mediaProbe.ts`）。
   * 它是裁剪上限的唯一依据 —— 不可用请求参数里的 `durationSec` 代替（那是请求值，不是成片事实）。
   */
  durationFrames: z.number().int().min(1),
});
export type EditClipSource = z.infer<typeof EditClipSourceSchema>;

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

export const CaptionClipSchema = z.object({
  ...ClipBaseShape,
  kind: z.literal('caption'),
  text: z.string().min(1).max(200),
});
export type CaptionClip = z.infer<typeof CaptionClipSchema>;

/** P3 开放编辑与渲染；P1 只占住形状（转场类型届时扩充） */
export const TransitionClipSchema = z.object({
  ...ClipBaseShape,
  kind: z.literal('transition'),
  transition: z.enum(['fade']),
});
export type TransitionClip = z.infer<typeof TransitionClipSchema>;

export const AudioClipSchema = z.object({
  ...ClipBaseShape,
  kind: z.literal('audio'),
  source: EditClipSourceSchema,
  trimStartFrames: z.number().int().min(0),
  volume: z.number().min(0).max(2),
});
export type AudioClip = z.infer<typeof AudioClipSchema>;

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

/** 从源片创建初始工程：一条视频轨 + 一个铺满源片全长的 clip */
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
    tracks: [{ id: uid('track'), kind: 'video', clips: [clip] }],
  };
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
  const bounds = neighborBounds(project, clipId);
  if (bounds === null) return project;
  const found = findClip(project, clipId);
  if (found === null) return project;
  const duration = found.clip.durationFrames;
  const maxStart =
    bounds.nextStart === null
      ? Number.MAX_SAFE_INTEGER
      : bounds.nextStart - duration;
  if (maxStart < bounds.prevEnd) return project; // 空隙比 clip 短：哪儿也去不了
  const start = clamp(Math.round(toFrame), bounds.prevEnd, maxStart);
  return mapClip(project, clipId, (clip) => ({ ...clip, startFrame: start }));
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
  const found = findClip(project, clipId);
  if (found === null) return project;
  const geo = base ?? clipGeometry(found.clip);
  const bounds = neighborBounds(project, clipId);
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
    return mapClip(project, clipId, (clip) => ({
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
  return mapClip(project, clipId, (clip) => ({
    ...clip,
    durationFrames: geo.durationFrames + delta,
  }));
}

export function removeClip(project: EditProject, clipId: string): EditProject {
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.clips.some((clip) => clip.id === clipId)
        ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }
        : track,
    ),
  };
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
