import {
  CAPTION_POSITION_LABELS,
  CAPTION_PRESET_LABELS,
  EDIT_TRANSITION_LABELS,
  MAX_TRANSITION_FRAMES,
  MIN_TRANSITION_FRAMES,
  type ClipPatch,
  type EditClip,
  type EditTransitionKind,
  type CaptionPosition,
  type CaptionPreset,
} from './model';

/**
 * 属性面板的 **schema 驱动**描述表（B34 · P3）。
 *
 * 面板组件不写死任何字段（`InspectorPanel` 只认描述符），
 * 新增可调参数 = 在这里加一行 + 在 `model.updateClipFields` 的对应分支里收口值域。
 * 值的合法性**只在 model 侧收口**（这里是 UI 的提示范围，不是信任边界）。
 */

export type FieldType = 'number' | 'text' | 'textarea' | 'select';

export interface FieldDescriptor {
  /** 面板字段 id；也是 `applyProperty` 的 key */
  key: string;
  label: string;
  type: FieldType;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** 面板上的补充说明（例如值域为什么这么窄） */
  hint?: string;
}

export const CLIP_FIELD_SCHEMA: Record<EditClip['kind'], FieldDescriptor[]> = {
  video: [
    { key: 'label', label: '标签', type: 'text', hint: '留空则显示来源任务号' },
    {
      key: 'speed',
      label: '变速',
      type: 'number',
      min: 0.25,
      max: 4,
      step: 0.05,
      unit: '×',
      hint: '上限受源片余量约束（裁掉一些才能加速）',
    },
    { key: 'volume', label: '音量', type: 'number', min: 0, max: 2, step: 0.05, unit: '×', hint: '0 = 静音' },
  ],
  caption: [
    { key: 'text', label: '字幕文本', type: 'textarea' },
    {
      key: 'position',
      label: '位置',
      type: 'select',
      options: (Object.keys(CAPTION_POSITION_LABELS) as CaptionPosition[]).map((value) => ({
        value,
        label: CAPTION_POSITION_LABELS[value],
      })),
    },
    {
      key: 'preset',
      label: '动效',
      type: 'select',
      options: (Object.keys(CAPTION_PRESET_LABELS) as CaptionPreset[]).map((value) => ({
        value,
        label: CAPTION_PRESET_LABELS[value],
      })),
      hint: '逐词入场 / 打字机的动效技法借鉴 video-shotcraft（Apache-2.0）',
    },
  ],
  audio: [
    { key: 'volume', label: '音量', type: 'number', min: 0, max: 2, step: 0.05, unit: '×' },
    {
      key: 'fadeInFrames',
      label: '淡入',
      type: 'number',
      min: 0,
      step: 1,
      unit: '帧',
      hint: 'BGM 起手不突兀；0 = 不淡。上限由片段时长收口（model 钳制）',
    },
    {
      key: 'fadeOutFrames',
      label: '淡出',
      type: 'number',
      min: 0,
      step: 1,
      unit: '帧',
      hint: '广告片收尾必需；与淡入重叠时取较小值（不会叠加放大）',
    },
  ],
  transition: [
    {
      key: 'transition',
      label: '类型',
      type: 'select',
      options: (Object.keys(EDIT_TRANSITION_LABELS) as EditTransitionKind[]).map((value) => ({
        value,
        label: EDIT_TRANSITION_LABELS[value],
      })),
    },
    {
      key: 'durationFrames',
      label: '时长',
      type: 'number',
      min: MIN_TRANSITION_FRAMES,
      max: MAX_TRANSITION_FRAMES,
      step: 1,
      unit: '帧',
      hint: '改时长会同步调整后继片段的左移量（重叠区 = 转场窗口）',
    },
  ],
};

/** 面板显示值（缺失字段回落为空串 / 当前值） */
export function readProperty(clip: EditClip, key: string): string | number {
  switch (clip.kind) {
    case 'video':
      if (key === 'label') return clip.label ?? '';
      if (key === 'speed') return clip.speed;
      if (key === 'volume') return clip.volume;
      break;
    case 'caption':
      if (key === 'text') return clip.text;
      if (key === 'position') return clip.position;
      if (key === 'preset') return clip.preset;
      break;
    case 'audio':
      if (key === 'volume') return clip.volume;
      // V2.10（B57）：未设置过淡入淡出 → 显示 0（缺省即"不淡"，不是"未知"）
      if (key === 'fadeInFrames') return clip.fadeInFrames ?? 0;
      if (key === 'fadeOutFrames') return clip.fadeOutFrames ?? 0;
      break;
    case 'transition':
      if (key === 'transition') return clip.transition;
      if (key === 'durationFrames') return clip.durationFrames;
      break;
  }
  return '';
}

/**
 * 面板数值输入的解析：**空串/纯空白要拒绝** —— 注意 `Number('') === 0` 是个真坑，
 * 不挡的话"清空输入框"会被读成"把音量设为 0"。NaN（如 'abc'）同样拒绝。
 */
function readNumber(raw: string | number): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * 把面板采集到的原始输入翻译成模型补丁；未知字段 / 种类不匹配返回 null。
 * 数值转换失败返回 null（由面板保持原值），值域**不在这里钳制** —— 那在 model 里。
 */
export function applyProperty(
  clip: EditClip,
  key: string,
  raw: string | number,
): ClipPatch | null {
  switch (clip.kind) {
    case 'video': {
      if (key === 'label') return { kind: 'video', label: String(raw) };
      const number = readNumber(raw);
      if (number === null) return null;
      if (key === 'speed') return { kind: 'video', speed: number };
      if (key === 'volume') return { kind: 'video', volume: number };
      return null;
    }
    case 'caption': {
      if (key === 'text') return { kind: 'caption', text: String(raw) };
      if (key === 'position') return { kind: 'caption', position: raw as CaptionPosition };
      if (key === 'preset') return { kind: 'caption', preset: raw as CaptionPreset };
      return null;
    }
    case 'audio': {
      const number = readNumber(raw);
      if (number === null) return null;
      if (key === 'volume') return { kind: 'audio', volume: number };
      // V2.10（B57）：淡入淡出（值域钳制在 model.updateClipFields）
      if (key === 'fadeInFrames') return { kind: 'audio', fadeInFrames: number };
      if (key === 'fadeOutFrames') return { kind: 'audio', fadeOutFrames: number };
      return null;
    }
    case 'transition': {
      if (key === 'transition') return { kind: 'transition', transition: raw as EditTransitionKind };
      const number = readNumber(raw);
      if (key === 'durationFrames' && number !== null) {
        return { kind: 'transition', durationFrames: number };
      }
      return null;
    }
  }
}
