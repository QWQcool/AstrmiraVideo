import { z } from 'zod';
import { ProviderTypeSchema } from './request.js';

/**
 * 契约投影来源：docs/CONTRACT.md §2 算力状态检测契约 `ProviderStatus`（V1.8）
 *
 * V1.8 语义（PLAN §6-D22 / D27）：本端点是**配置事实陈述**，不是硬件探针——
 * 只报告「env 是否提供兜底 Key」与「本地引擎是否被部署者显式配置并启用」；
 * 不扫描硬件、不返回任何未经显式配置的硬件信息、**不替访问者判断设备能力**。
 * 推荐档位（Tier 0~3）见 GUIDE §一，不参与任何自动锁定或置灰。
 */

export const HardwareTierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const CloudProviderStatusSchema = z.object({
  // 服务端视角：仅表示 env 兜底 Key 是否存在。
  // 前端合成实际能力：cloudEffective = available || (acceptsClientKey && hasLocalKey())
  available: z.boolean(),
  provider: z.literal('volcano-seedance'),
  // 仅标记服务端来源；available=true 时必填。
  // 客户端持有的 Key 不在本端点表达（状态端点无凭据上下文，见 CONTRACT §5「凭据传递约定」）
  keySource: z.literal('env').optional(),
  // 服务端是否接受客户端携带的 Key（恒 true；托管场景可置 false 禁用 BYOK）
  acceptsClientKey: z.boolean(),
  // 描述**本服务自身**情形（如「服务端未配置兜底 Key」）；不描述访问者设备
  reason: z.string().optional(),
});

export const LocalProviderStatusSchema = z.object({
  available: z.boolean(),
  provider: z.literal('minimax-h3'),
  // 部署者显式配置并自检通过的引擎档位；未配置时缺省（V1.8：不再是硬件扫描结论）
  tier: HardwareTierSchema.optional(),
  // V1.8（D27）：删除 gpuName / vramFreeGB —— 面向访客的端点不得携带硬件型号与显存数字
  // reason 两类口径：
  //  - 「本服务未配置本地引擎」（未配 env）
  //  - 「本服务未向访客开放本地轨」（EXPOSE_HOST_LOCAL_TRACK=0，默认）
  reason: z.string().optional(),
});

/**
 * 文本轨能力位（V2.0，PLAN §6-D24）。
 *
 * 与 `cloud` 同一套口径（这是 V1.6/§2 用一次真实缺陷换来的教训）：
 * `available` 只说**服务端视角**（env 兜底 Key 是否存在），
 * 前端合成实际能力 = `acceptsClientKey && hasLocalLlmKey()`。
 *
 * **纯 BYOK 下 `available` 恒为 `false`**：服务端刻意不设文本侧兜底 Key，
 * 所以"服务端有没有配"这个问题的答案永远是"没有" —— 若前端据此把 ✨ 置灰，
 * 就正好复刻了 V1.6 那个"用户填了 Key 也用不了"的漏洞。
 */
export const LlmProviderStatusSchema = z.object({
  available: z.boolean(),
  provider: z.literal('openai-compatible'),
  /** 服务端是否接受客户端携带的文本 Key（恒 true；托管场景可置 false） */
  acceptsClientKey: z.boolean(),
  reason: z.string().optional(),
});

/**
 * 本地 ComfyUI 能力位（**V2.31 新增**；台账 A1 片 C；CONTRACT §19；形态 = D53）。
 *
 * 与 `local`（自装 MiniMax H3）**同一套门控语义**：`available` 说的是
 * "本服务是否配了这个后端 + 是否向访客开放本地轨"，**不是**对访问者设备的判断
 * （V1.8 / D22 的文案纪律同样适用）。
 *
 * ⚠️ **为什么不在这里报"能跑哪些模式"**：那需要**真的探测**用户那台 ComfyUI
 * （`GET /object_info`，见 §19-2），而这个端点是"**配置事实陈述**" ——
 * 把远端探测塞进来，会让一个每次刷界面都可能被调用的接口，变成
 * "慢几秒、且在 ComfyUI 没启动时超时"的东西。
 * 模式能力改由**提交时**判定并如实报错（缺 `VAEDecodeTiled` / 模型不含 `ti2v` 等）。
 */
export const ComfyUiProviderStatusSchema = z.object({
  available: z.boolean(),
  provider: z.literal('comfyui'),
  reason: z.string().optional(),
});

export const ProviderStatusSchema = z.object({
  cloud: CloudProviderStatusSchema,
  local: LocalProviderStatusSchema,
  /** V2.31（A1 片 C）：用户自备的 ComfyUI（地址合规 + 本地轨已开放才算可用） */
  comfyui: ComfyUiProviderStatusSchema,
  llm: LlmProviderStatusSchema,
  // 初始建议值（V1.8：不再由 Tier 判定推导）
  defaultProvider: ProviderTypeSchema,
});

export type HardwareTier = z.infer<typeof HardwareTierSchema>;
export type CloudProviderStatus = z.infer<typeof CloudProviderStatusSchema>;
export type LocalProviderStatus = z.infer<typeof LocalProviderStatusSchema>;
export type LlmProviderStatus = z.infer<typeof LlmProviderStatusSchema>;
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
