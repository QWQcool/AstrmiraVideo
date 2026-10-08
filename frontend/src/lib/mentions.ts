import type { GenerationMode, VideoGenerateRequest } from '@astrmira/shared';

/**
 * `@` 提及素材 → 生成请求 的纯函数层（V2.7 / 台账 B41 · one-for-all 创作入口）。
 *
 * ## 为什么是 chip 提交制，而不是解析文本里的 `@xxx`
 * 裸文本解析有两个绕不开的歧义：素材名被截断（"@雨夜街" 到底是哪条成片）、重名（两条成片
 * 名字前缀一样）。所以输入框里的 `@` 只是**唤起弹层的按键**，真正的引用是 chips 行里的结构化
 * 数据（`MentionRef`）—— 真相只有一个来源。
 *
 * ## 与三槽路径的关系（纪律：两套入口，一套语义）
 * 三槽工作台的规则是"**素材决定模式**"（`lib/assets.ts`：`modeAfterSlotUpload` / `assetsForMode`）。
 * 本文件是同一纪律在 @ 场景下的投影，逐条对齐：
 * - 上传中的素材（`ref === ''`）**视为缺失** —— "空串发上去等于'带了但不存在'"（同 `readyAssetId`）；
 * - 只发该模式用得到的引用（`used`），多余素材**不静默**：由 `ignoredMentionHint` 说出被忽略了什么。
 */

/** 一条被 @ 引用的素材（chip 的数据形态） */
export interface MentionRef {
  /** 界面用稳定 id（React key / 上传完成后按它定位占位 chip）；不参与请求 */
  id: string;
  /**
   * 提交时进入 `assets` 字段的值：上传资产的 assetId，或 `task:<taskId>`（V2.6 引用，含剪辑产物）。
   * **空串 = 上传中的乐观占位**（与三槽的 `AssetState.assetId === ''` 同一约定）。
   */
  ref: string;
  kind: 'image' | 'video';
  /** 界面展示用（缩略图 / 视频封面）；快照带回或未就绪时可为 null */
  previewUrl?: string | null;
  /** 展示标签（prompt 截断 / 文件名），仅界面用，不参与请求 */
  label?: string;
}

export interface MentionSelection {
  mode: GenerationMode;
  /** 该模式下真正会被发出去的引用（顺序即语义：先=首帧、后=尾帧） */
  used: MentionRef[];
  /** 被忽略的引用（非空时界面必须说明原因 —— 不静默） */
  ignored: MentionRef[];
}

/**
 * 素材 → (模式, 采用, 忽略)。规则按优先级：
 * 1. 有视频（含 `task:` 成片引用）→ `v2v`，用**第一个视频**，其余全部忽略；
 * 2. 否则看图片：≥2 张 → `fl2v`（前两张 = 首帧/尾帧）；1 张 → `i2v`（首帧）；
 * 3. 什么都没有 → `t2v`。
 *
 * 模式判定**包含上传中的 chip**（用户选了就该按它算模式），"能不能提交"由
 * `assetsForRefs` 返回 undefined + 界面的上传中禁用态收口。
 */
export function selectMentions(refs: MentionRef[]): MentionSelection {
  const videos = refs.filter((item) => item.kind === 'video');
  if (videos.length > 0) {
    const [first, ...restVideos] = videos;
    const images = refs.filter((item) => item.kind === 'image');
    return { mode: 'v2v', used: [first!], ignored: [...restVideos, ...images] };
  }

  const images = refs.filter((item) => item.kind === 'image');
  if (images.length >= 2) {
    return { mode: 'fl2v', used: images.slice(0, 2), ignored: images.slice(2) };
  }
  if (images.length === 1) {
    return { mode: 'i2v', used: images, ignored: [] };
  }
  return { mode: 't2v', used: [], ignored: [] };
}

/** 选定模式（`selectMentions().mode` 的直读别名；界面按它显示"将按 X 模式生成"摘要行） */
export function modeForRefs(refs: MentionRef[]): GenerationMode {
  return selectMentions(refs).mode;
}

/**
 * 组装请求里的 `assets`：只发 `used`，且**任一 used 引用未就绪（上传中）就返回 undefined**。
 *
 * 为什么 undefined 而不是"先发别的"：半份素材发上去 = 上游真的按不完整输入计费/出片
 * （三槽时代已吃过这个教训：残留首帧会让云端按图收费）。
 * 返回 undefined 时界面要做两件事：禁用提交 + 说清是"上传中"而不是"缺素材"。
 */
export function assetsForRefs(refs: MentionRef[]): VideoGenerateRequest['assets'] | undefined {
  const { mode, used } = selectMentions(refs);
  if (used.length === 0) return undefined;
  if (used.some((item) => item.ref === '')) return undefined;

  switch (mode) {
    case 'i2v':
      return { firstFrameImage: used[0]!.ref };
    case 'fl2v':
      return { firstFrameImage: used[0]!.ref, lastFrameImage: used[1]!.ref };
    case 'v2v':
      return { referenceVideo: used[0]!.ref };
    default:
      return undefined;
  }
}

/** 是否存在上传中的 chip（界面把它接进提交禁用态，与三槽的 `uploadingSlot !== null` 同语义） */
export function hasPendingRef(refs: MentionRef[]): boolean {
  return refs.some((item) => item.ref === '');
}

/**
 * 被忽略素材的说明文案（非空 = 界面**必须**显示；空 = 没有可说的、不要硬凑）。
 * 文案说清"被忽略的是什么、为什么"，不出现"出错了"这类无指向措辞。
 */
export function ignoredMentionHint(selection: MentionSelection): string | null {
  const count = selection.ignored.length;
  if (count === 0) return null;

  if (selection.mode === 'v2v') {
    return `视频参考只使用第一个视频，已忽略另外 ${count} 个素材（要换参考请先删除对应 chip）。`;
  }
  return `首尾帧只使用前两张图片，已忽略另外 ${count} 张（要换请先删除对应 chip）。`;
}
