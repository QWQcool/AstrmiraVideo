import { useSyncExternalStore } from 'react';
import {
  addVideoClip,
  moveClip,
  previewDurationFrames,
  removeClip,
  trimClip,
  type ClipGeometry,
  type EditClipSource,
  type EditProject,
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

  // ── 工程编辑（约束全部收口在 model 纯函数里，这里只做派发与附带状态清理） ──

  addClip = (source: EditClipSource, atFrame?: number): string => {
    const { project, clipId } = addVideoClip(this.state.project, source, atFrame);
    this.set({ project, selectedClipId: clipId });
    return clipId;
  };

  moveClip = (clipId: string, toFrame: number): void => {
    this.set({ project: moveClip(this.state.project, clipId, toFrame) });
  };

  /** `base` = 拖拽起点处的 clip 几何（避免增量钳制累积误差，见 model.trimClip） */
  trimClip = (clipId: string, side: 'left' | 'right', deltaFrames: number, base?: ClipGeometry): void => {
    this.set({ project: trimClip(this.state.project, clipId, side, deltaFrames, base) });
  };

  removeClip = (clipId: string): void => {
    const project = removeClip(this.state.project, clipId);
    this.set({
      project,
      selectedClipId: this.state.selectedClipId === clipId ? null : this.state.selectedClipId,
      playheadFrame: Math.min(this.state.playheadFrame, previewDurationFrames(project)),
    });
  };
}

export function useEditStore<T>(store: EditStore, selector: (state: EditUiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
