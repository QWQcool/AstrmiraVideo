import type { UploadedAsset } from '@astrmira/shared';

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
