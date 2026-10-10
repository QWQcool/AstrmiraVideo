import { z } from 'zod';
import { VIDEO_MODEL_PRESETS } from './videoModels.js';
import type { VideoGenerateRequest } from './request.js';

/**
 * 成本台账的**计价口径**（V2.12 / 台账 B48，契约 §12）。
 *
 * ## 这是估算，不是账单
 * 本文件产出的每一个数字都是**预估**：单价来自公开价目与官方口径（第三方价格页 / 活动页），
 * **从未与我方方舟账单核对过**（PLAN §8 已如实标注【待验证】）。所有对外呈现都必须带
 * `COST_DISCLAIMER`——"以方舟账单为准"不是免责套话，而是这个功能的**正确性边界**。
 *
 * ## 计算口径（沿用 PLAN §8 已实测的公式）
 * ```
 * token = (输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024
 * 费用(元) = token ÷ 1e6 × 单价($/M token) × 汇率(USD→CNY)
 * ```
 * §8 的实测样本（5s / 1280×720 / 24fps ≈ 108,000 token ≈ $0.35）就是这条公式的验收基线。
 * **帧率取 24**：它是上游计费式的口径（不是我们的工程帧率 30），两者不是一回事。
 *
 * ## 为什么单价表在 shared 而不是 env
 * ① 前端要在**提交前**给出预估（用户点"生成"之前就该看到要花多少钱），所以两侧必须同一张表；
 * ② 单价是"产品知识"，不是部署参数；部署方要改汇率（`COST_USD_TO_CNY`）比改单价常见得多。
 */

/** 上游计费公式里的帧率口径（PLAN §8 的实测式；**不是**工程帧率） */
export const COST_BILLING_FPS = 24;

/** USD → CNY 的默认汇率（可由 `COST_USD_TO_CNY` 覆盖；**同样【待验证】**） */
export const COST_DEFAULT_USD_TO_CNY = 7.1;

/**
 * 对外呈现必须携带的口径说明。**不要**在界面里自己写别的版本 ——
 * 一处措辞 = 一处维护，且"以账单为准"这句话不允许被改弱。
 */
export const COST_DISCLAIMER =
  '预估金额（按公开价目 × 上游计费公式折算），未与我方账单核对；实际扣费以火山方舟控制台账单为准。';

/** 表内无此模型时的兜底单价（自定义 `ep-…` 接入点走这条） */
export const COST_UNKNOWN_MODEL_USD_PER_MILLION = 6.5;

export interface VideoModelPrice {
  modelId: string;
  /** 美元 / 百万 token */
  usdPerMillionTokens: number;
  /** 这个数字**从哪来**（审计要能倒推；不许写"大概"） */
  basis: string;
}

/**
 * 单价表（USD / 1M token）。
 *
 * ⚠️ 除 mini 档（§8 的实测口径）外，其余各行都是**由定性描述折算**出来的：
 * 每条 `basis` 写清了折算过程，方便日后拿到真实账单时逐行替换。
 */
export const VIDEO_MODEL_PRICES: readonly VideoModelPrice[] = [
  {
    modelId: 'doubao-seedance-2-0-mini-260615',
    usdPerMillionTokens: 3.24,
    basis: 'PLAN §8 成本表：mini 档第三方价目 $3.24/M（已按上游计费式验算过 token 量）',
  },
  {
    modelId: 'doubao-seedance-1-0-pro-fast-251015',
    usdPerMillionTokens: 1.7,
    basis: '官方口径"5s 1080p ≈ 3.67 元"折算 ≈ ¥14.9/M；本档为"全系最低单价"→ 再下调 ≈ $1.7/M【待验证】',
  },
  {
    modelId: 'doubao-seedance-1-0-pro-250528',
    usdPerMillionTokens: 2.1,
    basis: '官方口径"5s 1080p ≈ 3.67 元"按上游计费式折算 ≈ ¥14.9/M ≈ $2.1/M【待验证】',
  },
  {
    modelId: 'doubao-seedance-2-0-fast-260128',
    usdPerMillionTokens: 5.0,
    basis: '加速档：取 mini(3.24) 与 2.0 标准(6.5) 之间【待验证】',
  },
  {
    modelId: 'doubao-seedance-2-0-260128',
    usdPerMillionTokens: 6.5,
    basis: '官方口径"2.0 标准单价高于 mini 约一倍"→ 3.24 × 2【待验证】',
  },
  {
    modelId: 'doubao-seedance-2-5-260628',
    usdPerMillionTokens: 8.5,
    basis: '画质档：按高于 2.0 标准约 30% 取【待验证】',
  },
] as const;

/** 档位表里的一行（id → 单价）；表里的 id 必须与 `VIDEO_MODEL_PRESETS` 对齐 */
export function findVideoModelPrice(modelId: string | undefined): VideoModelPrice | null {
  if (modelId === undefined) return null;
  const trimmed = modelId.trim();
  return VIDEO_MODEL_PRICES.find((price) => price.modelId === trimmed) ?? null;
}

/**
 * 单价表与档位表**必须一一对应**（少一行就会有一个档位永远按兜底价估算，且没人会发现）。
 * 这条断言放在模块加载期：它是"两张表别飘"的唯一守卫。
 */
const PRESET_IDS = new Set(VIDEO_MODEL_PRESETS.map((preset) => preset.id));
for (const price of VIDEO_MODEL_PRICES) {
  if (!PRESET_IDS.has(price.modelId)) {
    throw new Error(`单价格式表与档位表不一致：${price.modelId} 不在 VIDEO_MODEL_PRESETS 里`);
  }
}

/** 计费输入（调用方从请求快照 / 任务记录里取，取不到的项**不猜**） */
export interface CostInput {
  /** 上游模型 id（缺省 = 部署默认档） */
  model?: string;
  /** 出片分辨率（= 请求的 `resolution`，V8.3 起它就是最终目标尺寸） */
  width?: number;
  height?: number;
  /** 输出时长（秒）：请求的 `params.durationSec`（缺省 5） */
  outputSeconds?: number;
  /**
   * 输入时长（秒）：目前**只有参考视频（V2V）才有时长**，而它没有落库 ——
   * 所以调用方传 0，并在 `notes` 里如实说明"估算偏低"。上游 usage 接线后由真实值填。
   */
  inputSeconds?: number;
  /** 轨道：本地轨无 API 费用（电费/折旧不在本口径内） */
  track?: 'cloud' | 'local';
  /** 汇率覆盖（部署参数） */
  usdToCny?: number;
}

/**
 * 成本记录（CONTRACT §4 `TaskProgress.cost`）。
 *
 * 除了金额，**把算式与依据一起存下来**：B 端要能回答"这个数字怎么来的"，
 * 而"存了金额没存依据"是审计上最常见的缺口。
 */
export const CostRecordSchema = z.object({
  /** 预估金额（元）；本地轨为 0 */
  yuan: z.number().nonnegative(),
  /** 预估金额（美元，折算前） */
  usd: z.number().nonnegative(),
  /** 计费 token 量（上游计费式的输出） */
  tokens: z.number().int().nonnegative(),
  /** 计价来源：预估（公开价目）/ 本地轨免费 / 上游真实值（**尚未接线**，保留位） */
  source: z.enum(['estimate', 'local-free', 'upstream']),
  /** 用于计价的模型 id（自定义档原样保留） */
  modelId: z.string(),
  /** 该模型是否命中单价表（false = 按兜底价估算，界面要显著标注） */
  fromPriceTable: z.boolean(),
  usdPerMillionTokens: z.number().nonnegative(),
  usdToCny: z.number().positive(),
  /** 计费用的时长口径（秒） */
  outputSeconds: z.number().nonnegative(),
  inputSeconds: z.number().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  /** 人类可读算式（排错与审计用；不参与任何计算） */
  formula: z.string(),
  /** 如实标注：本次估算漏了什么（如"参考视频输入时长未入库，估算偏低"） */
  notes: z.array(z.string()),
});

export type CostRecord = z.infer<typeof CostRecordSchema>;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * 估算一次生成的成本。**取不到必要条件就返回 null**（不编数字）：
 * 分辨率或时长缺失 → null；`track === 'local'` → 0 元（`local-free`，这一步不需要单价）。
 */
export function estimateVideoCost(input: CostInput): CostRecord | null {
  const width = input.width;
  const height = input.height;
  const outputSeconds = input.outputSeconds ?? 5;
  const fps = COST_BILLING_FPS;
  const notes: string[] = [];

  const inputSeconds = input.inputSeconds ?? 0;
  const modelId = (input.model ?? '').trim();

  // 本地轨：无 API 费用。**显式记 0**（不是"没有成本字段"）——
  // "这条花了 0 元"和"这条我们不知道花了多少"是两件事，B 端必须分得清。
  //
  // ⚠️ 这一支必须在**分辨率检查之前**（UI 冒烟实测抓到的）：本地轨的金额与分辨率无关，
  // 而请求可以不带 `resolution`（云端 provider 此时不传 `--resolution`，由上游用自己的默认值）。
  // 若先要求分辨率，本地轨任务会落进"未结算"—— 那既不准也误导（它明明就是 0 元）。
  if (input.track === 'local') {
    return {
      yuan: 0,
      usd: 0,
      tokens: 0,
      source: 'local-free',
      modelId: modelId === '' ? 'local' : modelId,
      fromPriceTable: false,
      usdPerMillionTokens: 0,
      usdToCny: input.usdToCny ?? COST_DEFAULT_USD_TO_CNY,
      outputSeconds,
      inputSeconds,
      // 本地轨与分辨率无关；缺分辨率时给 1×1 占位（schema 要求正整数，而这个值**不参与任何计算**）
      width: width ?? 1,
      height: height ?? 1,
      fps,
      formula: '本地 / 浏览器内产生：无 API 费用（电费与设备折旧不在本口径内）',
      notes,
    };
  }

  // 云端轨缺分辨率 → **不估算**：上游此时用的是它自己的默认档，我们不知道账单按哪个口径算。
  // 编一个 720p 会得到一个看起来很确定的错数字，比"未结算"更危险。
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return null;
  if (!(outputSeconds > 0)) return null;

  const price = findVideoModelPrice(input.model);
  const usdPerMillionTokens = price?.usdPerMillionTokens ?? COST_UNKNOWN_MODEL_USD_PER_MILLION;
  const usdToCny = input.usdToCny ?? COST_DEFAULT_USD_TO_CNY;

  if (price === null) {
    notes.push(
      modelId === ''
        ? `未指定模型 → 按 2.0 标准口径 $${COST_UNKNOWN_MODEL_USD_PER_MILLION}/M 估算`
        : `「${modelId}」不在单价表内（自定义接入点）→ 按 2.0 标准口径 $${COST_UNKNOWN_MODEL_USD_PER_MILLION}/M 估算`,
    );
  }
  if (inputSeconds === 0) {
    notes.push('未计入参考视频输入时长（该时长尚未入库）→ 实际费用可能高于此估算');
  }

  const tokens = Math.round(((inputSeconds + outputSeconds) * width * height * fps) / 1024);
  const usd = (tokens / 1_000_000) * usdPerMillionTokens;
  const yuan = usd * usdToCny;

  return {
    // 金额保留 4 位小数（¥0.0001 = 0.01 分）：再多也只是浮点噪声
    yuan: round(yuan, 4),
    usd: round(usd, 4),
    tokens,
    source: 'estimate',
    modelId: modelId === '' ? 'default' : modelId,
    fromPriceTable: price !== null,
    usdPerMillionTokens,
    usdToCny,
    outputSeconds,
    inputSeconds,
    width,
    height,
    fps,
    formula: `(${inputSeconds} + ${outputSeconds})s × ${width}×${height} × ${fps}fps ÷ 1024 = ${tokens} token；`
      + `${tokens} ÷ 1e6 × $${usdPerMillionTokens}/M × ${usdToCny} ≈ ¥${round(yuan, 4)}`,
    notes,
  };
}

/**
 * 从**请求快照**估算（提交前预估与任务结算共用这一条路径 —— 两处口径必须同源）。
 * `track` 由调用方给（请求体本身不带轨道）。
 */
export function estimateCostFromRequest(
  request: Pick<VideoGenerateRequest, 'resolution' | 'params' | 'options'>,
  options: { track?: 'cloud' | 'local'; usdToCny?: number; inputSeconds?: number } = {},
): CostRecord | null {
  // 两道窄化都是**对着契约做的**：`resolution` 在类型上是可选（历史请求与"不传分辨率"的客户端都可能没有），
  // `options.model` 是"未识别键"的开放记录（可能是任何 JSON 值）。
  //
  // ⚠️ **缺分辨率不能在这里提前 return null**（UI 冒烟实测抓到的）：那会让下面 `estimateVideoCost`
  // 里"本地轨恒 0 元"的分支永远走不到（本地轨金额与分辨率无关）。该不该估算是 `estimateVideoCost`
  // 的职责，这里只负责"把快照翻译成入参、不硬取字段崩掉"。
  const resolution = request.resolution;
  const model = typeof request.options?.['model'] === 'string' ? request.options['model'] : undefined;

  return estimateVideoCost({
    ...(model === undefined ? {} : { model }),
    ...(resolution === undefined ? {} : { width: resolution.width, height: resolution.height }),
    ...(request.params?.durationSec === undefined
      ? {}
      : { outputSeconds: request.params.durationSec }),
    inputSeconds: options.inputSeconds ?? 0,
    ...(options.track === undefined ? {} : { track: options.track }),
    ...(options.usdToCny === undefined ? {} : { usdToCny: options.usdToCny }),
  });
}

/** 金额显示：小数额保留更多位（¥0.0035 直接round成 ¥0 会让人以为免费） */
export function formatYuan(yuan: number): string {
  if (yuan === 0) return '¥0';
  if (yuan < 0.01) return `¥${yuan.toFixed(4)}`;
  if (yuan < 1) return `¥${yuan.toFixed(3)}`;
  if (yuan < 100) return `¥${yuan.toFixed(2)}`;
  return `¥${Math.round(yuan).toLocaleString('zh-CN')}`;
}

// ── 汇总（CONTRACT §5 `GET /api/costs/summary`）─────────────────────────────

/**
 * 一个汇总桶（按项目 / 按天 / 按模型共用同一形状）。
 *
 * `unsettledCount` 与 `yuan` **并列出现**是刻意的：一个桶里"花了多少钱"必须和
 * "还有多少条没算出来"一起看 —— 只给金额会让人以为这就是全部。
 */
export const CostBucketSchema = z.object({
  /** 分组键：projectId / `YYYY-MM-DD` / modelId */
  key: z.string(),
  /** 展示名：项目名 / 日期 / 模型档位标签 */
  label: z.string(),
  yuan: z.number().nonnegative(),
  taskCount: z.number().int().nonnegative(),
  /** 该桶内**成功但没有成本记录**的任务数（V2.12 之前的老任务） */
  unsettledCount: z.number().int().nonnegative(),
});

/** 部署级月度预算（`MONTHLY_BUDGET_YUAN`；未配置时为 null —— 不编默认预算） */
export const CostBudgetSchema = z.object({
  monthlyYuan: z.number().positive(),
  monthToDateYuan: z.number().nonnegative(),
  ratio: z.number().nonnegative(),
  over: z.boolean(),
});

export const CostSummaryResponseSchema = z.object({
  /** 统计区间（epoch ms；null = 不限） */
  range: z.object({ from: z.number().int().nullable(), to: z.number().int().nullable() }),
  /** 统计范围：某个项目 / `null` = 跨项目汇总（成本视图的"全部项目"档） */
  projectId: z.string().nullable(),
  totalYuan: z.number().nonnegative(),
  /** 区间内的成功任务总数（含未结算的） */
  taskCount: z.number().int().nonnegative(),
  /** 其中**有成本记录**的条数（totalYuan 就是它们之和） */
  pricedTaskCount: z.number().int().nonnegative(),
  /** 成功但无成本记录（老任务）；界面必须显示，否则金额会被误读成"全部" */
  unsettledCount: z.number().int().nonnegative(),
  /**
   * 已提交但我方无法确认结果的任务数（`UNCERTAIN_RESULT`）——
   * **可能已产生费用**，B 端预算视图必须把它单独提出来（这是最容易被漏掉的成本）。
   */
  uncertainCount: z.number().int().nonnegative(),
  byProject: z.array(CostBucketSchema),
  byDay: z.array(CostBucketSchema),
  byModel: z.array(CostBucketSchema),
  /**
   * true = 区间内任务数超过服务端的扫描上界，**金额是部分之和**。
   * 有这一位才允许界面显示数字；否则"截断后的和"会被读成全量。
   */
  truncated: z.boolean(),
  budget: CostBudgetSchema.nullable(),
  /** 口径说明（固定为 `COST_DISCLAIMER`；服务端下发，界面不要自己写一版） */
  disclaimer: z.string(),
});

export type CostBucket = z.infer<typeof CostBucketSchema>;
export type CostBudget = z.infer<typeof CostBudgetSchema>;
export type CostSummaryResponse = z.infer<typeof CostSummaryResponseSchema>;
