/**
 * 视频轨模型档位（V2.1，PLAN §5「V8.3 批次 6 / 线上故障修复」）。
 *
 * ## 为什么要有这张表
 * 2026-09-23 线上故障的最终形态是：**界面上手打模型名打错了**（用户凭记忆填了
 * `doubao-seedance-2-0-mini-260615`，而服务端 `.env` 的占位符把它覆盖成
 * `doubao-seedance-video`）→ 上游 404。手打一个随时变动的模型 id 本身就是设计缺陷，
 * 所以这里做两件事：① 预置**已实测可用**的档位供下拉选择；② 保留"自定义"出口，
 * 让用户能填控制台里自己账号的接入点（`ep-…`）。
 *
 * ## 数据来源与时效
 * - `id` 逐条与方舟 `GET /api/v3/models`（135 项）比对过，并用"空 content 探测"
 *   验证过**是否已开通**（400=可用 / 404=未开通）；
 * - `note` 里的价格来自官方活动页与公开报道，**未经我方计费实测**，一律标【待验证】；
 * - 模型 id 带日期后缀，方舟会持续上新的版本 —— 所以下拉只是"常用档"，
 *   真正的可用清单以用户控制台 / `测试连接` 的返回为准。
 */

export interface VideoModelPreset {
  /** 上游模型 id（可直接作为 `options.model` 发送） */
  id: string;
  label: string;
  /** 成本/画质定位，仅供界面分组与提示 */
  tier: 'economy' | 'standard' | 'quality';
  /** 是否经我方实测"该账号可用"【已验证】；未实测的档位不进这张表 */
  verified: boolean;
  note: string;
}

export const VIDEO_MODEL_PRESETS: readonly VideoModelPreset[] = [
  {
    id: 'doubao-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 mini（省钱档，默认）',
    tier: 'economy',
    verified: true,
    note: '支持 480p / 720p；官方活动页口径 720p 约 0.2~0.5 元/秒【待验证：未见我方计费账单】',
  },
  {
    id: 'doubao-seedance-1-0-pro-fast-251015',
    label: 'Seedance 1.0 pro fast（省钱档）',
    tier: 'economy',
    verified: true,
    note: '1.0 代的"价格触底"档；第三方价目显示为 Seedance 全系最低单价【待验证】',
  },
  {
    id: 'doubao-seedance-1-0-pro-250528',
    label: 'Seedance 1.0 pro（标准档）',
    tier: 'standard',
    verified: true,
    note: '支持首尾帧；官方口径 5s 1080p 约 3.67 元【待验证】',
  },
  {
    id: 'doubao-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 fast',
    tier: 'standard',
    verified: true,
    note: '2.0 代加速档【待验证：能力矩阵以方舟文档为准】',
  },
  {
    id: 'doubao-seedance-2-0-260128',
    label: 'Seedance 2.0（画质档）',
    tier: 'quality',
    verified: true,
    note: '2.0 标准版，单价高于 mini 约一倍【待验证】',
  },
  {
    id: 'doubao-seedance-2-5-260628',
    label: 'Seedance 2.5（画质档）',
    tier: 'quality',
    verified: true,
    note: '官方页面口径支持 30 秒超长叙事与全模态参考【待验证】',
  },
] as const;

/** 自定义档：用户填控制台里的接入点 id（`ep-…`）或别的模型 id */
export const VIDEO_CUSTOM_MODEL_ID = 'custom';

/**
 * 默认档：**最省钱的已实测档**（用户 2026-09-23 明确要求"尽量用最省钱的模型"）。
 * ⚠️ 可用性是**按账号**的（方舟需要先开通模型服务）：换成默认档后若报 404 未开通，
 * 抽屉里的「测试连接」会直接给出结论，不必花一次生成的钱去试。
 */
export const VIDEO_DEFAULT_MODEL = 'doubao-seedance-2-0-mini-260615';

export function findVideoModelPreset(id: string | undefined): VideoModelPreset | undefined {
  if (id === undefined) return undefined;
  return VIDEO_MODEL_PRESETS.find((preset) => preset.id === id);
}

/** 当前 model 字符串对应下拉里的哪一项（不在表里 → 自定义） */
export function videoModelSelection(model: string): string {
  return findVideoModelPreset(model.trim())?.id ?? VIDEO_CUSTOM_MODEL_ID;
}
