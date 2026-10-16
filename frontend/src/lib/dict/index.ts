import { BYOK_EN, BYOK_ZH } from './byok';
import { CANVAS_EN, CANVAS_ZH } from './canvas';
import { COMMON_EN, COMMON_ZH } from './common';
import { CREATE_EN, CREATE_ZH } from './create';
import { ERROR_EN, ERROR_ZH } from './error';
import { LIBRARY_EN, LIBRARY_ZH } from './library';
import { SHELL_EN, SHELL_ZH } from './shell';
import { WORKBENCH_EN, WORKBENCH_ZH } from './workbench';

/**
 * 字典组装处（**唯一**）。
 *
 * ## 三条口径
 * 1. **中文是基准语言**：`MessageKey` 由中文那一份推导（`keyof typeof ZH`）——
 *    写 `t('shell.nav.creat')` 这种手误**编译期就报错**（不是运行时回落成键名才被发现）。
 *    强类型字典的代价：新增文案必须先写中文那一份（这也正是本仓的默认语言顺序）；
 * 2. **英文必须与中文同键集**：`Record<MessageKey, string>` 是**编译期**保证 ——
 *    缺一条、多一条都会红（比"跑单测才发现"更早）；
 * 3. **零 import**：本文件与各域字典文件**不 import 任何运行时代码**（包括 `i18n.ts`）——
 *    `i18n.ts` 单向依赖这里，这样既不会有循环依赖，字典也能被任何地方安全引用。
 *
 * ## 分批迁移的状态（改这里就等于改了进度）
 * 已迁：`common`（跨视图共享：模式名 / 状态名 / 素材种类 / 算力归属 / 费用口径）、
 * `shell`（侧栏 / 顶栏 / 区域名 / 项目切换 / 凭据提示）、`create`（创作入口）、
 * `workbench`（工作台**整屏**：左栏 / 中栏 / 右栏 / 容器 / 核对卡 / 画廊卡 / 素材槽）、
 * `byok`（凭据抽屉）、`error`（**整条兜底线**：`ErrorBoundary` 的按钮 +
 * `lib/errorReport.ts` 拼的崩溃面板与运行期通知正文 + `lib/runtimeErrorNotice.ts` 的壳）、
 * `canvas`（画布 —— **整屏**：节点卡 / 编排检查器 / 词表 / 画布纯函数 / 视图壳）、
 * `library`（视频库：页头 / 工具条 / 筛选排序取值 / 交付包面板 / 卡片 / 详情抽屉）。
 * 未迁：成本台账 / 配方库 / 操作日志 / 剪辑台 / 总览，以及一批零散库
 * （`lib/lineage.ts` / `costView.ts` / `workerClient.ts` / `deliverablePackage.ts` /
 * `engineOptions.ts` / `api.ts` 等 —— 精确剩余见迁移期盘点脚本）。
 *
 * ## 已定的一个口径（语言迁移第八批）：`console.*` 不是界面文案，保持中文
 * 用户 2026-10-16 授权按此执行。理由：`console.*` 是写给**开 DevTools 的人**看的，
 * 翻成界面语言会让**报障时的检索与比对变难** —— 用户贴过来的控制台片段会随他切换语言
 * 变成两种语言。所以视觉自检的"已迁文件零硬编码中文"给了一条例外：
 * **只豁免行首 `console.` 的行**（判据写成通用的，不是给某个文件开后门；
 * 别放宽成"这一行含 console 就行"，那会给"把文案塞进带 console 的调用里"开口子）。
 *
 * **切换入口在全部迁移完成前不上线**（半中半英比只有中文更糟）。
 *
 * ⚠️ **`common` 域的意义**：模式名与状态名在多个视图里出现，各写一份中文必然漂移
 * （"这边叫图生视频、那边叫图片生视频"）。未迁的那几个视图现在还有自己的那一份
 * （如 `canvas/labels.ts`），会在**各自的批次**里改成引用这里。
 */

/**
 * **迁移是否完成**（= 语言切换入口与新语言的上线开关）。
 *
 * ## 为什么必须有它（这是本轮发现的一个真问题，不是"预留")
 * `detectLanguage` 的顺序里有"浏览器偏好"这一环 —— 一个**英文浏览器**、且从没选过语言的访客，
 * 会被直接判成 `en`。而视图文案还没迁完，他会看到"**外壳英文 + 正文中文**"：
 * 那比"只有中文"更糟（我上一片写下的口径），而且**不是他能控制的**（他没点过任何东西）。
 * 所以：未完成时**忽略浏览器偏好**，一律中文 —— 用户显式选过的语言仍然尊重（那是他自己的选择）。
 *
 * 迁移完成 = 各域全部迁完 → 把下面这行改成 `true`，同时挂上切换入口。
 */
export const I18N_MIGRATION_COMPLETE = false;

/** 中文（基准）。各域字典在这里展开 */
export const ZH = {
  ...COMMON_ZH,
  ...SHELL_ZH,
  ...CREATE_ZH,
  ...WORKBENCH_ZH,
  ...BYOK_ZH,
  ...ERROR_ZH,
  ...CANVAS_ZH,
  ...LIBRARY_ZH,
};

/** 字典的键集合（全站文案键的唯一权威） */
export type MessageKey = keyof typeof ZH;

/**
 * 英文。
 *
 * ⚠️ 这里**故意**用 `Record<MessageKey, string>` 标注（而不是 `as const` 或裸对象）：
 * 那是"英文与中文同键集"的机器保证 —— 漏译一条编译就红。
 */
export const EN: Record<MessageKey, string> = {
  ...COMMON_EN,
  ...SHELL_EN,
  ...CREATE_EN,
  ...WORKBENCH_EN,
  ...BYOK_EN,
  ...ERROR_EN,
  ...CANVAS_EN,
  ...LIBRARY_EN,
};

export const DICTIONARIES = { zh: ZH, en: EN };
