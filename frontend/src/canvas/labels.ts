import type { GenerationMode } from '@astrmira/shared';
import { getLanguage, translate, type MessageKey } from '../lib/i18n';

/**
 * 画布层的显示文案（V2.26 / 台账 A5 片 A 收拢）。
 *
 * 为什么单独一个文件：编排模式的节点卡片与事实图节点卡片都要写"这是什么模式/引擎" ——
 * 两份文案各写一遍就会漂移（漂移的表现是同一个模式在两处叫不同名字，用户以为是两个东西）。
 *
 * ## 语言迁移第十批：模式名**不再自己写一份**，改为引用 `common.mode.*`
 * 这四句与创作入口 / 工作台 / 视频库是**同一件事的同一个名字**（`common` 域就是为它们建的）——
 * 画布自己再抄一份，正是 `dict/common.ts` 文件头警告的那种漂移
 * （"这边叫『图生视频』、那边叫『图片生视频』"）。文案一字未改，只是**改为同一处定义**。
 *
 * ## 同一批**删掉**了 `CANVAS_PROVIDER_LABELS`（如实登记，这不是顺手清理）
 * 那张 provider 显示名表**零引用**（`git grep` 全仓只剩它自己的声明），
 * 真正在用的是 `lib/engineOptions.ts` 的 `providerLabel`（左栏自检结果 / 画布节点 / 日志都走它，
 * 它 V2.36 就是照着"统一用它"建的）。更要紧的是两张表的文案**已经漂移**：
 * `stock-local` 在死表里是「素材库（开发期）」、在活路径里是「素材库（未实现）」；
 * `fixture-local` 是「夹具（开发期）」vs「开发期夹具」。
 *
 * 迁移**不改文案**，所以这两张表**不能合并**（合并必然改动其中一处）——
 * 但把**死的那张**留着，等于把一处已经漂移的错误文案永远供在仓库里，
 * 而且它还会逼着字典去收录没人会看到的字符串。所以：**删掉死的，活路径原样不动**。
 * 漂移本身作为"文案问题"另开条目（见 PLAN §5 第九批的登记），不在迁移里顺手改。
 */

const CANVAS_MODE_LABEL_KEYS: Record<GenerationMode, MessageKey> = {
  t2v: 'common.mode.t2v',
  i2v: 'common.mode.i2v',
  fl2v: 'common.mode.fl2v',
  v2v: 'common.mode.v2v',
  t2i: 'common.mode.t2i',
  upscale: 'common.mode.upscale',
  inpaint: 'common.mode.inpaint',
  outpaint: 'common.mode.outpaint',
  // V2.103：音频三模式（画布/技能/创作页共用同一张文案键表）
  tts: 'common.mode.tts',
  bgm: 'common.mode.bgm',
  sfx: 'common.mode.sfx',
};

/**
 * 模式名的显示值（画布的节点卡与检查器共用）。
 *
 * 与 `lib/format.ts` 的 `statusLabel` 同一手法（**"非 React 上下文取文案"**）：
 * 这不是 hook，按**当前语言**取；而调用它的组件都订阅了语言（用了 `useTranslate()`），
 * 所以语言一变它们重渲染、这里的结果跟着变。
 */
export function canvasModeLabel(mode: GenerationMode): string {
  return translate(getLanguage(), CANVAS_MODE_LABEL_KEYS[mode]);
}
