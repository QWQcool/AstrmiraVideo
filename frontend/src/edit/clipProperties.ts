import {
  CAPTION_POSITION_KEYS,
  CAPTION_PRESET_KEYS,
  EDIT_TRANSITION_KEYS,
  MAX_TRANSITION_FRAMES,
  MIN_TRANSITION_FRAMES,
  type ClipPatch,
  type EditClip,
  type EditTransitionKind,
  type CaptionPosition,
  type CaptionPreset,
} from './model';
import { getLanguage, translate, type MessageKey } from '../lib/i18n';

/**
 * 属性面板的 **schema 驱动**描述表（B34 · P3）。
 *
 * 面板组件不写死任何字段（`InspectorPanel` 只认描述符），
 * 新增可调参数 = 在这里加一行 + 在 `model.updateClipFields` 的对应分支里收口值域。
 * 值的合法性**只在 model 侧收口**（这里是 UI 的提示范围，不是信任边界）。
 */

export type FieldType = 'number' | 'text' | 'textarea' | 'select';

/**
 * 字段描述符。
 *
 * ## 语言迁移第十七批：`label` / `hint` / `options[].label` 从**字符串**改成**字典键**
 * 原因不是审美，是**模块加载时机**：这张表是模块级常量，如果值里写着文案，
 * `translate(getLanguage(), …)` 会在**模块被 import 的那一刻**求值一次 —— 语言就此冻死
 * （这正是 `dict/index.ts` 文件头警告的那类漂移，只不过发生在语言维度上）。
 * 改成键之后，面板在**渲染那一刻**取（`fieldLabel()` / `fieldHint()` / `fieldOptions()`），
 * 切语言立刻生效。
 *
 * ⚠️ 顺带说明为什么"单位"也要进字典：`帧` 是中文，英文要写 `frames`；
 * 而 `×` 是**语言无关**的符号，所以它仍是普通字符串（不为了对称而把符号塞进字典）。
 */
export interface FieldDescriptor {
  /** 面板字段 id；也是 `applyProperty` 的 key */
  key: string;
  labelKey: MessageKey;
  type: FieldType;
  min?: number;
  max?: number;
  step?: number;
  /** 语言无关的符号单位（如 `×`） */
  unit?: string;
  /** 需要翻译的单位（如 `帧`）—— 与 `unit` 二选一 */
  unitKey?: MessageKey;
  options?: { value: string; labelKey: MessageKey }[];
  /** 面板上的补充说明（例如值域为什么这么窄） */
  hintKey?: MessageKey;
}

export const CLIP_FIELD_SCHEMA: Record<EditClip['kind'], FieldDescriptor[]> = {
  video: [
    {
      key: 'label',
      labelKey: 'edit.field.label',
      type: 'text',
      hintKey: 'edit.field.label.hint',
    },
    {
      key: 'speed',
      labelKey: 'edit.field.speed',
      type: 'number',
      min: 0.25,
      max: 4,
      step: 0.05,
      unit: '×',
      hintKey: 'edit.field.speed.hint',
    },
    {
      key: 'volume',
      labelKey: 'edit.field.volume',
      type: 'number',
      min: 0,
      max: 2,
      step: 0.05,
      unit: '×',
      hintKey: 'edit.field.volume.hint',
    },
  ],
  caption: [
    { key: 'text', labelKey: 'edit.field.text', type: 'textarea' },
    {
      key: 'position',
      labelKey: 'edit.field.position',
      type: 'select',
      options: (Object.keys(CAPTION_POSITION_KEYS) as CaptionPosition[]).map((value) => ({
        value,
        labelKey: CAPTION_POSITION_KEYS[value],
      })),
    },
    {
      key: 'preset',
      labelKey: 'edit.field.preset',
      type: 'select',
      options: (Object.keys(CAPTION_PRESET_KEYS) as CaptionPreset[]).map((value) => ({
        value,
        labelKey: CAPTION_PRESET_KEYS[value],
      })),
      hintKey: 'edit.field.preset.hint',
    },
  ],
  audio: [
    {
      key: 'volume',
      labelKey: 'edit.field.volume',
      type: 'number',
      min: 0,
      max: 2,
      step: 0.05,
      unit: '×',
    },
    {
      key: 'fadeInFrames',
      labelKey: 'edit.field.fadeIn',
      type: 'number',
      min: 0,
      step: 1,
      unitKey: 'edit.field.unit.frames',
      hintKey: 'edit.field.fadeIn.hint',
    },
    {
      key: 'fadeOutFrames',
      labelKey: 'edit.field.fadeOut',
      type: 'number',
      min: 0,
      step: 1,
      unitKey: 'edit.field.unit.frames',
      hintKey: 'edit.field.fadeOut.hint',
    },
  ],
  transition: [
    {
      key: 'transition',
      labelKey: 'edit.field.transition',
      type: 'select',
      options: (Object.keys(EDIT_TRANSITION_KEYS) as EditTransitionKind[]).map((value) => ({
        value,
        labelKey: EDIT_TRANSITION_KEYS[value],
      })),
    },
    {
      key: 'durationFrames',
      labelKey: 'edit.field.duration',
      type: 'number',
      min: MIN_TRANSITION_FRAMES,
      max: MAX_TRANSITION_FRAMES,
      step: 1,
      unitKey: 'edit.field.unit.frames',
      hintKey: 'edit.field.duration.hint',
    },
  ],
};

/**
 * 面板取值的三件套（渲染那一刻取，跟着界面语言走）。
 *
 * 为什么放在这一层而不是面板里：面板只认描述符（那正是这张表存在的意义），
 * 让面板自己拼键名会把"字段表"与"面板"重新耦合起来。
 */
export function fieldLabel(field: FieldDescriptor): string {
  return translate(getLanguage(), field.labelKey);
}

export function fieldHint(field: FieldDescriptor): string | null {
  return field.hintKey === undefined ? null : translate(getLanguage(), field.hintKey);
}

export function fieldUnit(field: FieldDescriptor): string {
  if (field.unitKey !== undefined) return translate(getLanguage(), field.unitKey);
  return field.unit ?? '';
}

export function fieldOptions(field: FieldDescriptor): { value: string; label: string }[] {
  return (field.options ?? []).map((option) => ({
    value: option.value,
    label: translate(getLanguage(), option.labelKey),
  }));
}

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
