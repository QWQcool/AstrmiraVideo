import type { CanvasReference, CanvasReferenceMode, CanvasReferenceRole } from './canvasDoc.js';

/**
 * 画布参考的**组成规则**（CONTRACT §21-17 / 用户 2026-10-27 拍板 B 路线）。
 *
 * ## 为什么单独一个模块
 * 规则的消费方有三处，口径必须一致：
 * 1. 连线（`canvasLineage.planCanvasLineage`）—— 现在能不能再连一条；
 * 2. 提交前校验（`canvasNodeSubmit`）—— 这组参考能不能提交；
 * 3. provider（后端）—— 实际喂给模型的顺序与数量。
 * 任一处各写一遍，就会出现"画布连得上、提交被拒"或反之。
 *
 * ## 冻结的三档语义（`settings.referenceMode`）
 * | mode | 允许的 role | 数量 |
 * |---|---|---|
 * | 缺省（旧文档） | 沿用既有连线规则，本模块不判 | — |
 * | `none` | 无参考 | 0 |
 * | `first-last-frame` | `first-frame` / `last-frame` | 各 ≤1，合计 ≤2 |
 * | `omni-reference` | `reference-image` | 1..limit（`order` 定槽位） |
 *
 * `reference-video` / `reference-audio` 目前**不属于任何模式**：它们仍走既有的 v2v 通道，
 * 由连线规则单独把关；本模块只保证"声明了模式就不许混入其它 role"。
 */

/**
 * 产品结构上限（与即梦同款 12）。**不是模型真值**：
 * 真实可用上限 = `min(12, ModelCapability.maxReferences)`，后者由模板/实例声明。
 * 本地 10GB 卡目前只验到 2 张、计划验到 4 张 —— 跑不动的实例应当把能力目录的值调低，
 * 而不是让用户连满 12 张再在提交时失败。
 */
export const CANVAS_MAX_REFERENCES = 12;

/** 模式内允许的 role 集合（`undefined` = 旧文档，不判） */
const MODE_ROLES: Record<Exclude<CanvasReferenceMode, 'none'>, readonly CanvasReferenceRole[]> = {
  'first-last-frame': ['first-frame', 'last-frame'],
  'omni-reference': ['reference-image'],
};

export type CanvasReferenceProblem =
  /** role 不属于当前模式（例如 omni 模式下混进首帧） */
  | 'mode-conflict'
  /** 超过结构上限或能力上限 */
  | 'too-many'
  /** `first-last-frame` 至少要一张首帧（只有尾帧没有意义） */
  | 'missing-first-frame'
  /** 同一张素材被引用两次 */
  | 'duplicate-asset'
  /** 同一 role 的 `order` 重复（槽位冲突） */
  | 'duplicate-order';

export interface CanvasReferenceComposition {
  ok: boolean;
  /** 这组参考的有效上限（结构上限与能力上限取小） */
  limit: number;
  problem?: CanvasReferenceProblem;
}

export interface CanvasReferenceCompositionInput {
  mode: CanvasReferenceMode | undefined;
  references: readonly CanvasReference[];
  /** 能力目录里的真实上限；缺省 = 只用结构上限 */
  capacity?: number;
}

/** 有效上限：结构上限与能力上限取小；非法/缺省按结构上限算 */
export function canvasReferenceLimit(capacity?: number): number {
  if (capacity === undefined || !Number.isFinite(capacity)) return CANVAS_MAX_REFERENCES;
  if (capacity < 0) return 0;
  return Math.min(CANVAS_MAX_REFERENCES, Math.floor(capacity));
}

/**
 * 判断一组参考在当前模式下是否合法。
 *
 * 顺序：上限 → role 归属 → 数量/槽位。先报"太多了"比先报"第三张槽位重复"更有用。
 */
export function checkCanvasReferenceComposition(
  input: CanvasReferenceCompositionInput,
): CanvasReferenceComposition {
  const limit = canvasReferenceLimit(input.capacity);
  const references = input.references;
  const mode = input.mode;

  if (references.length > limit) return { ok: false, limit, problem: 'too-many' };

  // 旧文档没有模式：只守结构上限，role 组成交给既有连线规则
  if (mode === undefined) return { ok: true, limit };

  if (mode === 'none') {
    return references.length === 0
      ? { ok: true, limit }
      : { ok: false, limit, problem: 'mode-conflict' };
  }

  const allowed = MODE_ROLES[mode];
  if (references.some((reference) => !allowed.includes(reference.role))) {
    return { ok: false, limit, problem: 'mode-conflict' };
  }

  const assets = new Set<string>();
  for (const reference of references) {
    if (assets.has(reference.assetId)) return { ok: false, limit, problem: 'duplicate-asset' };
    assets.add(reference.assetId);
  }

  if (mode === 'first-last-frame') {
    const firsts = references.filter((reference) => reference.role === 'first-frame');
    const lasts = references.filter((reference) => reference.role === 'last-frame');
    if (firsts.length === 0 && lasts.length > 0) {
      return { ok: false, limit, problem: 'missing-first-frame' };
    }
    if (firsts.length > 1 || lasts.length > 1) return { ok: false, limit, problem: 'too-many' };
    return { ok: true, limit };
  }

  // omni-reference：每个素材一个槽位，order 必须互不相同
  const orders = new Set<number>();
  for (const reference of references) {
    if (orders.has(reference.order)) return { ok: false, limit, problem: 'duplicate-order' };
    orders.add(reference.order);
  }
  return { ok: true, limit };
}

/** 按 `order` 排好的参考 —— 槽位下标就是提示词 `{{image:N}}` 的 N */
export function sortCanvasReferences(references: readonly CanvasReference[]): CanvasReference[] {
  return [...references].sort((left, right) => left.order - right.order);
}

export interface CanvasMention {
  /** `{{image:N}}` 里的 N（0 起，与 `sortCanvasReferences` 的下标一致） */
  index: number;
  /** 原始占位符文本 */
  raw: string;
}

export interface CanvasMentionProblem {
  index: number;
  raw: string;
  problem: 'out-of-range';
}

export interface CanvasMentionScan {
  mentions: CanvasMention[];
  problems: CanvasMentionProblem[];
}

/**
 * 提示词里的素材提及 `{{image:N}}`（CONTRACT §21-17 / 2026-10-27 拍板"要做"）。
 *
 * 三条口径（与即梦实测对齐）：
 * 1. **0 起**编号，N 对应 `sortCanvasReferences()` 后的下标；
 * 2. **严格小写 `image`**：即梦实测里用户手打的 `{{Image 4}}` 没有被解析 —— 我们也只认小写，
 *    但**不改写**它，原样留在文本里（静默"帮你纠正"比不认更难排查）；
 * 3. 越界（N ≥ 参考数）记为问题，由提交前校验拒绝，**不就地删字**。
 *
 * 本函数只扫描不替换：真正的替换发生在 provider 组装请求时（那里才知道目标格式）。
 */
export function scanCanvasMentions(prompt: string, referenceCount: number): CanvasMentionScan {
  const pattern = /\{\{image:(\d{1,3})\}\}/g;
  const mentions: CanvasMention[] = [];
  const problems: CanvasMentionProblem[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt)) !== null) {
    const raw = match[0];
    const index = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isFinite(index)) continue;
    if (index >= referenceCount) {
      problems.push({ index, raw, problem: 'out-of-range' });
      continue;
    }
    mentions.push({ index, raw });
  }
  return { mentions, problems };
}
