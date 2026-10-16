import { useSyncExternalStore } from 'react';
import { getLanguage, translate } from '../lib/i18n';
import {
  addAudioClip,
  addCaptionClip,
  addTransition,
  addVideoClip,
  moveClip,
  previewDurationFrames,
  removeClip,
  removeTransition,
  trimClip,
  updateClipFields,
  type ClipGeometry,
  type ClipPatch,
  type EditClipSource,
  type EditProject,
  type EditTransitionKind,
} from './model';

/**
 * 剪辑台编辑器 store（B34 · P1）。
 *
 * 为什么不引 zustand：项目纪律是零全家桶（PLAN §6-D4 连 react-query 都不引），
 * 而一个 `useSyncExternalStore` 封装只要几十行。播放中的高频更新（播放头每帧）
 * 也走它 —— 但**只有播放头竖线 / 走带时间码订阅 playheadFrame**（shotcraft 同款纪律），
 * 其余组件按字段切片订阅，project 不可变更新保证「没改就不重渲染」。
 *
 * 选择器纪律：`useEditStore` 的 selector 只能取**原始字段**（state 切片），
 * 不得做派生计算（每次返回新对象会让 useSyncExternalStore 抖动重渲染）。
 */

export interface EditUiState {
  project: EditProject;
  selectedClipId: string | null;
  /** 播放头（工程帧）。播放中由 Player 的 frameupdate 事件驱动，拖标尺时由时间轴驱动 */
  playheadFrame: number;
  playing: boolean;
  /** 时间轴缩放：每帧多少像素 */
  pxPerFrame: number;
  /**
   * 一次性提示（如"移动已移除受影响的转场"）。
   * 存在的意义 = **不静默**：模型会替用户做的"破坏性修补"必须说出来。
   * 任何新的编辑动作开始时清掉（由 `set()` 自动处理见 `clearNoticeOnMutation`）。
   */
  notice: string | null;
}

export const MIN_PX_PER_FRAME = 0.5;
export const MAX_PX_PER_FRAME = 20;
const DEFAULT_PX_PER_FRAME = 4;

export class EditStore {
  private state: EditUiState;
  private readonly listeners = new Set<() => void>();

  constructor(project: EditProject) {
    this.state = {
      project,
      selectedClipId: null,
      playheadFrame: 0,
      playing: false,
      pxPerFrame: DEFAULT_PX_PER_FRAME,
      notice: null,
    };
  }

  getState = (): EditUiState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(partial: Partial<EditUiState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  // ── 选择 / 播放头 / 缩放 ──

  select = (clipId: string | null): void => {
    if (this.state.selectedClipId !== clipId) this.set({ selectedClipId: clipId });
  };

  setPlayhead = (frame: number): void => {
    const clamped = Math.max(
      0,
      Math.min(Math.round(frame), previewDurationFrames(this.state.project)),
    );
    if (clamped === this.state.playheadFrame) return;
    this.set({ playheadFrame: clamped });
  };

  setPlaying = (playing: boolean): void => {
    if (this.state.playing !== playing) this.set({ playing });
  };

  setZoom = (pxPerFrame: number): void => {
    this.set({
      pxPerFrame: Math.min(MAX_PX_PER_FRAME, Math.max(MIN_PX_PER_FRAME, pxPerFrame)),
    });
  };

  setNotice = (notice: string | null): void => {
    if (this.state.notice !== notice) this.set({ notice });
  };

  /**
   * **整份替换工程**（V2.21 / 台账 B66）—— 恢复历史快照用。
   *
   * 为什么不是"逐条对齐"：历史快照就是**当时那份工程**，逐条 diff 出"该怎么改"本身就是伪需求。
   * 恢复后把选择与播放头复位（它们指向的片段可能已经不在了）—— 这比"保留一个悬空选择"诚实。
   */
  replaceProject = (project: EditProject, notice: string | null = null): void => {
    this.set({ project, selectedClipId: null, playheadFrame: 0, playing: false, notice });
  };

  // ── 工程编辑（约束全部收口在 model 纯函数里，这里只做派发与附带状态清理） ──

  /** 编辑动作统一入口：清掉上一条提示（提示只描述"刚刚发生的那一下"） */
  private mutate(project: EditProject, partial?: Partial<EditUiState>): void {
    this.set({ project, notice: null, ...partial });
  }

  addClip = (source: EditClipSource, atFrame?: number): string => {
    const { project, clipId } = addVideoClip(this.state.project, source, atFrame);
    this.mutate(project, { selectedClipId: clipId });
    return clipId;
  };

  moveClip = (clipId: string, toFrame: number): void => {
    const before = countTransitions(this.state.project);
    const project = moveClip(this.state.project, clipId, toFrame);
    this.mutateTransitionAware(project, before);
  };

  /** `base` = 拖拽起点处的 clip 几何（避免增量钳制累积误差，见 model.trimClip） */
  trimClip = (clipId: string, side: 'left' | 'right', deltaFrames: number, base?: ClipGeometry): void => {
    const before = countTransitions(this.state.project);
    const project = trimClip(this.state.project, clipId, side, deltaFrames, base);
    this.mutateTransitionAware(project, before);
  };

  removeClip = (clipId: string): void => {
    const before = countTransitions(this.state.project);
    const project = removeClip(this.state.project, clipId);
    this.set({
      project,
      notice: transitionNotice(before, project),
      selectedClipId: this.state.selectedClipId === clipId ? null : this.state.selectedClipId,
      playheadFrame: Math.min(this.state.playheadFrame, previewDurationFrames(project)),
    });
  };

  // ── P3：字幕 / 音效 / 转场 / 属性 ──

  /** 在播放头处添加一条字幕（默认 2s，自动避开已有字幕） */
  addCaption = (): string => {
    const { project, clipId } = addCaptionClip(this.state.project, {
      atFrame: this.state.playheadFrame,
    });
    this.mutate(project, { selectedClipId: clipId });
    return clipId;
  };

  addAudio = (source: EditClipSource): string => {
    const { project, clipId } = addAudioClip(this.state.project, source);
    this.mutate(project, { selectedClipId: clipId });
    return clipId;
  };

  /** 在选中视频片段与其相邻后继之间加转场（失败给提示，不静默） */
  addTransitionAfterSelected = (kind: EditTransitionKind, durationFrames: number): void => {
    const selected = this.state.selectedClipId;
    if (selected === null) {
      this.setNotice(translate(getLanguage(), 'edit.store.pickVideoFirst'));
      return;
    }
    const result = addTransition(this.state.project, selected, kind, durationFrames);
    if (!result.ok) {
      this.setNotice(result.reason);
      return;
    }
    this.mutate(result.project, { selectedClipId: result.clipId });
  };

  /** 移除选中转场（显式动作，布局随之还原） */
  removeSelectedTransition = (): void => {
    const selected = this.state.selectedClipId;
    if (selected === null) return;
    const project = removeTransition(this.state.project, selected);
    this.set({
      project,
      notice:
        project === this.state.project
          ? translate(getLanguage(), 'edit.store.notTransition')
          : null,
      selectedClipId: null,
    });
  };

  /** 属性面板写回（值域收口在 model.updateClipFields） */
  updateSelectedClip = (patch: ClipPatch): void => {
    const selected = this.state.selectedClipId;
    if (selected === null) return;
    const project = updateClipFields(this.state.project, selected, patch);
    if (project === this.state.project) return; // 无变化（非法值 / 未命中）不制造新引用
    this.set({ project });
  };

  private mutateTransitionAware(project: EditProject, transitionsBefore: number): void {
    this.set({ project, notice: transitionNotice(transitionsBefore, project) });
  }
}

function countTransitions(project: EditProject): number {
  return (
    project.tracks
      .find((track) => track.kind === 'transition')
      ?.clips.filter((clip) => clip.kind === 'transition').length ?? 0
  );
}

/** 转场数量变少 = 这次编辑顺带移除了受影响转场 → 必须给用户一句实话（不静默） */
function transitionNotice(before: number, project: EditProject): string | null {
  const after = countTransitions(project);
  return after < before
    ? translate(getLanguage(), 'edit.store.transitionRemoved')
    : null;
}

export function useEditStore<T>(store: EditStore, selector: (state: EditUiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
