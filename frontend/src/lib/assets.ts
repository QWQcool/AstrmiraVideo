import type { GenerationAssets, GenerationMode, UploadedAsset } from '@astrmira/shared';

/**
 * 参考资产的前端状态。
 *
 * 为什么不是直接用 `UploadedAsset`：**参数复用**时只有一个 `assetId`
 * （快照里就存了这一项，服务端不长期保留资产元数据）。
 * 这时如果硬造 `kind / mime / size` 就是**伪造数据**，所以把"元数据可缺"写进类型，
 * 让界面老实显示"预览不可用，需重新上传"。
 */
export interface AssetState {
  assetId: string;
  /** 本次上传返回的元数据；参数复用时为 `null` */
  meta: UploadedAsset | null;
  /** 本地预览（仅本会话上传的图有）；复用时为 `null` */
  previewUrl: string | null;
}

/**
 * 参考资产三槽（V8.3 批次 3-⑤）——与 CONTRACT §1 `assets` 的三个字段一一对应。
 *
 * 为什么用"槽"而不是"一个 asset"：请求契约里本来就是三个独立字段
 * （`firstFrameImage` / `lastFrameImage` / `referenceVideo`），
 * 而此前前端只有一个 `asset` 入口，于是**上传的视频会被当成首帧发出去**
 * （上游按 `first_frame` 处理一段 mp4），并且 FL2V 根本无从表达。
 */
export type AssetSlotKey = 'firstFrame' | 'lastFrame' | 'referenceVideo';

export type AssetSlots = Record<AssetSlotKey, AssetState | null>;

export function emptyAssetSlots(): AssetSlots {
  return { firstFrame: null, lastFrame: null, referenceVideo: null };
}

/**
 * 上传某个槽后应处的模式（V8.3 批次 3-⑤）。
 *
 * **为什么强绑定**：素材放错槽是真实会发生的 —— 此前只有一个资产入口，
 * 上传一段 mp4 会被当成 `first_frame` 发出去。把"往哪个槽放"与"用哪个模式"绑在一起，
 * 比指望用户看完四个模式说明再自己点按钮可靠。
 * `firstFrame` 是唯一例外：已经在首尾帧模式里补首帧时，不该被打回图生视频。
 */
export function modeAfterSlotUpload(current: GenerationMode, slot: AssetSlotKey): GenerationMode {
  if (slot === 'firstFrame') return current === 'fl2v' ? 'fl2v' : 'i2v';
  return slot === 'lastFrame' ? 'fl2v' : 'v2v';
}

/**
 * 清空某个槽后应回落的模式。
 *
 * 不回落就会留下"首尾帧模式却没有尾帧"这类悬空状态：用户看到一排空槽 + 灰着的提交按钮，
 * 却不知道是模式没退回去（而不是上传坏了）。
 */
export function modeAfterSlotClear(current: GenerationMode, slot: AssetSlotKey): GenerationMode {
  if (current === 't2v' || current === 'i2v') {
    return slot === 'firstFrame' ? 't2v' : current;
  }
  if (current === 'fl2v') {
    return slot === 'firstFrame' ? 't2v' : 'i2v';
  }
  // v2v：清掉参考视频就无事可做，退回文生视频
  return slot === 'referenceVideo' ? 't2v' : current;
}

/**
 * 按模式组装请求里的 `assets`：**只发该模式用得到的槽**。
 *
 * 为什么不能"所有非空槽都发"：先传首帧、再切回文生视频是很常见的试探动作，
 * 若首帧仍随请求发出，上游会**真的**拿它当起点 —— 用户以为在做文生视频，
 * 出来的是图生视频的结果（云端还按图收费）。
 *
 * @returns 该模式所需素材缺失时返回 `undefined`（提交按钮此时也是禁用的）
 */
export function assetsForMode(
  mode: GenerationMode,
  slots: AssetSlots,
): GenerationAssets | undefined {
  if (mode === 'i2v') {
    const id = readyAssetId(slots.firstFrame);
    return id === undefined ? undefined : { firstFrameImage: id };
  }
  if (mode === 'fl2v') {
    const first = readyAssetId(slots.firstFrame);
    const last = readyAssetId(slots.lastFrame);
    if (first === undefined || last === undefined) return undefined;
    return { firstFrameImage: first, lastFrameImage: last };
  }
  if (mode === 'v2v') {
    const id = readyAssetId(slots.referenceVideo);
    return id === undefined ? undefined : { referenceVideo: id };
  }
  return undefined;
}

/**
 * 槽里是否有**可提交**的资产。
 *
 * `assetId === ''` 是**上传中**的乐观预览态（先本地预览、拿到服务端 id 再补进状态），
 * 此时把空串发出去等于"带了素材但素材不存在"。提交按钮已按上传态禁用，
 * 这里再判一次，是为了让这条规则**不依赖 UI 的禁用逻辑**（纯函数自身安全）。
 */
function readyAssetId(state: AssetState | null): string | undefined {
  if (state === null || state.assetId === '') return undefined;
  return state.assetId;
}

/** 缺素材时的说明（非 null = 提交会被挡住）；必须说清**缺哪一格**，只置灰等于让用户猜 */
export function missingAssetHint(mode: GenerationMode, slots: AssetSlots): string | null {
  if (mode === 'i2v' && readyAssetId(slots.firstFrame) === undefined) {
    return '「图生视频」需要参考首帧：请在上方上传首帧';
  }
  if (mode === 'fl2v') {
    if (readyAssetId(slots.firstFrame) === undefined) {
      return '「首尾帧」需要参考首帧与参考尾帧：当前缺首帧';
    }
    if (readyAssetId(slots.lastFrame) === undefined) {
      return '「首尾帧」需要参考首帧与参考尾帧：当前缺尾帧';
    }
  }
  if (mode === 'v2v' && readyAssetId(slots.referenceVideo) === undefined) {
    return '「视频参考」需要参考视频：请在上方上传';
  }
  return null;
}
