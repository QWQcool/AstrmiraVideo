import {
  checkCapability,
  type CanvasNodeSettings,
  type CanvasReference,
  type CapabilityIssue,
  type ModelCapability,
} from '@astrmira/shared';

/**
 * 创作输入区的草稿模型（Step 11-S2 / 设计基准 §7.2）。
 *
 * ## 它解决什么
 * 实测产品的输入区是**同一个框、按创作类型变脸**：
 * - `Agent`：只有「自动 / 技能」，没有模型与画质参数；
 * - `图片` / `视频`：出现 模型 · 参考模式 · 比例 · 清晰度 · 数量 · 时长 · 费用。
 *
 * 所以草稿必须能**跨类型保留**（切到图片再切回视频，提示词和素材都还在），
 * 同时**只显示当前类型支持的控件**。这里把这两条做成纯函数，界面只管渲染。
 *
 * ## 三条口径
 * 1. **切换不清空**：`switchCreationKind` 只改 `kind`，不动 `prompt` / `references`；
 *    被隐藏的参数也不删（切回来还在），但提交时**只带当前类型用得到的字段**。
 * 2. **不能提交时给码不给话**：返回 `empty-prompt` 或能力目录的问题码，
 *    中文理由由界面映射（共享包与 lib 都不持有界面文案）。
 * 3. **草稿可丢弃**：解析失败/未知类型一律回落到默认草稿，不让用户卡在打不开的输入区。
 */

export type CreationKind = 'agent' | 'image' | 'video';

/** 参数行上的控件（顺序即渲染顺序） */
export type CreationControl =
  | 'model'
  | 'referenceMode'
  | 'aspectRatio'
  | 'resolution'
  | 'duration'
  | 'count';

export interface CreationDraft {
  kind: CreationKind;
  prompt: string;
  references: CanvasReference[];
  settings: CanvasNodeSettings;
  updatedAt: number;
}

/** 每种类型显示哪些控件（Agent 态刻意一项都没有） */
export const CREATION_KIND_CONTROLS: Record<CreationKind, readonly CreationControl[]> = {
  agent: [],
  image: ['model', 'aspectRatio', 'resolution', 'count'],
  video: ['model', 'referenceMode', 'aspectRatio', 'resolution', 'duration', 'count'],
};

/** 节点类型 ↔ 创作类型（Agent 不产出节点类型，提交时由用户选定图片或视频） */
export const CREATION_KIND_TO_NODE: Record<Exclude<CreationKind, 'agent'>, 'image' | 'video'> = {
  image: 'image',
  video: 'video',
};

export const CREATION_DRAFT_STORAGE_KEY = 'astrmira.creationDraft';
/** S5-B3e：复用参数/覆盖草稿前保留一份可返回快照（只保存一份，后一次覆盖前一次） */
export const CREATION_DRAFT_BACKUP_KEY = 'astrmira.creationDraft.backup';

export function createCreationDraft(
  kind: CreationKind = 'agent',
  now: number = Date.now(),
): CreationDraft {
  return { kind, prompt: '', references: [], settings: {}, updatedAt: now };
}

/**
 * 切换创作类型。
 *
 * **只改 `kind`**：提示词、素材、以及被隐藏的参数都原样保留 —— 用户切错一次不该丢东西。
 * `updatedAt` 一起更新，便于"恢复草稿"判断新旧。
 */
export function switchCreationKind(
  draft: CreationDraft,
  kind: CreationKind,
  now: number = Date.now(),
): CreationDraft {
  if (draft.kind === kind) return draft;
  return { ...draft, kind, updatedAt: now };
}

/** 当前类型要用到的参数（提交时只带这些，避免"切回视频结果带了图片的分辨率"） */
export function settingsForKind(
  draft: CreationDraft,
  kind: CreationKind = draft.kind,
): CanvasNodeSettings {
  const controls = CREATION_KIND_CONTROLS[kind];
  if (controls.length === 0) return {};
  const next: CanvasNodeSettings = {};
  // 模式不是"控件"，由类型决定：图片固定 t2i，视频沿用草稿（缺省 t2v）
  if (kind === 'image') next.mode = 't2i';
  if (kind === 'video') next.mode = draft.settings.mode ?? 't2v';
  if (controls.includes('model')) next.modelId = draft.settings.modelId;
  if (controls.includes('referenceMode')) next.referenceMode = draft.settings.referenceMode;
  if (controls.includes('aspectRatio')) next.aspectRatio = draft.settings.aspectRatio;
  if (controls.includes('resolution')) next.resolution = draft.settings.resolution;
  if (controls.includes('duration')) next.durationSec = draft.settings.durationSec;
  if (controls.includes('count')) next.count = draft.settings.count;
  // 清掉 undefined，避免"字段存在但值为空"传到请求里
  for (const key of Object.keys(next) as Array<keyof CanvasNodeSettings>) {
    if (next[key] === undefined) delete next[key];
  }
  return next;
}

export type CreationIssue = 'empty-prompt' | CapabilityIssue;

/**
 * 当前草稿能不能提交。
 *
 * - `agent` 不判能力（它先出方案，不直接提交生成）；
 * - 其它类型把参数压缩成一次能力检查，返回**第一个**问题码。
 */
export function creationIssue(
  draft: CreationDraft,
  capability: ModelCapability | null,
): CreationIssue | null {
  if (draft.prompt.trim().length === 0) return 'empty-prompt';
  if (draft.kind === 'agent') return null;
  if (!capability) return 'model-unavailable';
  return checkCapability(capability, {
    mode: draft.kind === 'image' ? 't2i' : draft.settings.mode,
    referenceMode: draft.settings.referenceMode,
    references: draft.references,
    aspectRatio: draft.settings.aspectRatio,
    resolution: draft.settings.resolution,
    durationSec: draft.settings.durationSec,
    count: draft.settings.count,
  });
}

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function isCreationKind(value: unknown): value is CreationKind {
  return value === 'agent' || value === 'image' || value === 'video';
}

/**
 * 读草稿：**任何异常都回落默认值**。
 *
 * 草稿是"上次没写完的东西"，不是权威数据 —— 为它弹错误框、或让输入区打不开，
 * 代价远大于丢掉一次草稿。
 */
export function readCreationDraft(
  storage: DraftStorage,
  now: number = Date.now(),
): CreationDraft {
  try {
    const raw = storage.getItem(CREATION_DRAFT_STORAGE_KEY);
    if (!raw) return createCreationDraft('agent', now);
    const parsed = JSON.parse(raw) as Partial<CreationDraft> | null;
    if (!parsed || typeof parsed !== 'object' || !isCreationKind(parsed.kind)) {
      return createCreationDraft('agent', now);
    }
    return {
      kind: parsed.kind,
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      references: Array.isArray(parsed.references) ? parsed.references : [],
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
    };
  } catch {
    return createCreationDraft('agent', now);
  }
}

export function writeCreationDraft(storage: DraftStorage, draft: CreationDraft): void {
  try {
    storage.setItem(CREATION_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // 隐私模式 / 配额满：草稿写不进去不是致命错误，输入区照常可用
  }
}

export function clearCreationDraft(storage: DraftStorage): void {
  try {
    if (storage.removeItem) storage.removeItem(CREATION_DRAFT_STORAGE_KEY);
    else storage.setItem(CREATION_DRAFT_STORAGE_KEY, '');
  } catch {
    // 同上
  }
}

export function writeCreationDraftBackup(storage: DraftStorage, draft: CreationDraft): void {
  try {
    storage.setItem(CREATION_DRAFT_BACKUP_KEY, JSON.stringify(draft));
  } catch {
    // 配额满/隐私模式：备份失败不阻塞主流程
  }
}

export function readCreationDraftBackup(
  storage: DraftStorage,
  now: number = Date.now(),
): CreationDraft | null {
  try {
    const raw = storage.getItem(CREATION_DRAFT_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CreationDraft> | null;
    if (!parsed || typeof parsed !== 'object' || !isCreationKind(parsed.kind)) return null;
    return {
      kind: parsed.kind,
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      references: Array.isArray(parsed.references) ? parsed.references : [],
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
    };
  } catch {
    return null;
  }
}

export function clearCreationDraftBackup(storage: DraftStorage): void {
  try {
    if (storage.removeItem) storage.removeItem(CREATION_DRAFT_BACKUP_KEY);
    else storage.setItem(CREATION_DRAFT_BACKUP_KEY, '');
  } catch {
    // 同上
  }
}
