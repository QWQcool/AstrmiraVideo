/**
 * 剪辑台多轨模型 —— **已按 P4 契约迁移提升到 `packages/shared/src/editProject.ts`**
 * （CONTRACT §11-2；前后端共用同一份 schema：服务端用它校验 `POST /api/edits/renders` 上传的工程 JSON）。
 *
 * 这里保留一个转发出口，是为了不动 P1~P3 建立的几十处 `from './model'` 引用；
 * 新代码可以直接从 `@astrmira/shared` 导入。
 */
import type {
  CaptionPosition,
  CaptionPreset,
  EditOperation,
  EditOriginLike,
  EditTrackKind,
  EditTransitionKind,
} from '@astrmira/shared';
import { getLanguage, translate, type MessageKey } from '../lib/i18n';

export * from '@astrmira/shared';

/**
 * ## 显示名的**键表**（语言迁移第十六批 · 跨包决策的落点）
 *
 * 这些映射原先在共享包里是**中文常量表**（`EDIT_OPERATION_LABELS` / `TRACK_KIND_LABELS` /
 * `CAPTION_*_LABELS` / `EDIT_TRANSITION_LABELS`）。搬过来的判据见 `dict/edit.ts` 文件头：
 * **只有前端在用**（后端只存 id），而中文常量表没法双语。
 *
 * 为什么是"键表"而不是"取文案的函数"：组件用 `t(KEYS[id])` 取，
 * **语言一变就重渲染**（`translate(getLanguage(), …)` 那种现取函数只适用于非 React 上下文）。
 *
 * ⚠️ 每个表的类型都是 `Record<具体联合类型, MessageKey>` —— 这是**编译期穷尽性**：
 * 共享包将来新增一个轨道 / 转场 / 操作类型，这里漏加键会**直接编译不过**
 * （而不是悄悄显示一个 id 或空白）。这正是"把表搬回前端"比"两份中文对拍"更强的地方。
 */
export const EDIT_OPERATION_KEYS: Record<EditOperation['type'], MessageKey> = {
  trim: 'edit.op.trim',
  concat: 'edit.op.concat',
  xfade: 'edit.op.xfade',
  volume: 'edit.op.volume',
  speed: 'edit.op.speed',
  extractFrame: 'edit.op.extractFrame',
};

export const TRACK_KIND_KEYS: Record<EditTrackKind, MessageKey> = {
  video: 'edit.track.video',
  caption: 'edit.track.caption',
  transition: 'edit.track.transition',
  audio: 'edit.track.audio',
};

export const CAPTION_PRESET_KEYS: Record<CaptionPreset, MessageKey> = {
  plain: 'edit.captionPreset.plain',
  fade: 'edit.captionPreset.fade',
  wordSlide: 'edit.captionPreset.wordSlide',
  typewriter: 'edit.captionPreset.typewriter',
};

export const CAPTION_POSITION_KEYS: Record<CaptionPosition, MessageKey> = {
  bottom: 'edit.captionPosition.bottom',
  center: 'edit.captionPosition.center',
  top: 'edit.captionPosition.top',
};

export const EDIT_TRANSITION_KEYS: Record<EditTransitionKind, MessageKey> = {
  fade: 'edit.transition.fade',
  wipeleft: 'edit.transition.wipeleft',
  slideright: 'edit.transition.slideright',
};

/**
 * 剪辑来源的**一句话摘要**（原 `@astrmira/shared` 的 `describeEditOrigin`）。
 *
 * 为什么搬回前端：它不是"领域词汇"而是**格式化**（中文 `3 轨 · 12 个片段` /
 * 英文 `3 tracks · 12 clips`）—— 那是排版事实，属界面层。共享包只留数据形状
 * （`EditOriginLike`），那才是真正的领域契约。
 *
 * 与 `lib/format.ts` 的 `statusLabel` 同一手法（非 React 上下文取文案，
 * 调用它的两个视图都订阅了语言）。
 */
export function describeEditOrigin(origin: EditOriginLike): string {
  const lang = getLanguage();
  if (origin.project !== undefined) {
    const clips = origin.project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
    return translate(lang, 'edit.origin.projectSummary', {
      tracks: origin.project.tracks.length,
      clips,
    });
  }
  if (origin.script !== undefined) {
    return translate(lang, 'edit.origin.scriptSummary', { count: origin.script.operations.length });
  }
  return translate(lang, 'edit.origin.fallback');
}
