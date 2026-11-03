import { z } from 'zod';

/**
 * 画布构图 → MOSS 布局提示词（V2.113 / 台账 B103-10 第一步）。
 *
 * ## 这是什么
 * MOSS 的图片模型认一种**结构化提示词**：整图一句描述 + 若干"框 + 这个框里是什么"。
 * 我们已经有画布——节点有位置、有提示词草稿——所以这张图可以由画布**算**出来，
 * 而不是让人手写 JSON。
 *
 * ## 格式不是猜的
 * 2026-10-30 在真机（4080 32GB + ComfyUI 0.43 的 `MOSSImageLayoutPrompt`）上验证过：
 * 发**以画布中心为原点的像素**、`bbox_format: "yxyx"`、`bbox_coord_space: "abs_centralized"`，
 * 两框样例被如实遵守（左框均值偏红、右框偏蓝，两次跑都一样）。
 *
 * ⚠️ 注意：这份 JSON 是**提示词文本**，不是新的协议字段 —— 它最终作为 `prompt` 提交，
 * 所以**不改契约的请求体**。也正因如此，服务端无法校验它，校验全部落在这一层。
 *
 * ## 为什么坐标系要"中心像素"而不是 0–1000
 * 0–1000 更"通用"，但我们**只验证过中心像素这一种**；未验证的格式一旦被模型误解，
 * 症状是"框全跑到边角"，而用户看不出是格式错了还是模型不行。宁可要一个已验证的、
 * 依赖出图尺寸的换算 —— 尺寸本来就在同一条请求里，不构成额外知识。
 */

/** 一个待布局的元素：画布里的矩形 + 这个框里应该是什么 */
export interface CanvasLayoutFrame {
  /** 稳定 id（画布节点 id）——只用于排错，不进提示词 */
  id: string;
  /** 画布坐标（左上角 + 宽高，单位与画布一致即可） */
  layout: { x: number; y: number; width: number; height: number };
  /** 这个框里应该出现什么（一句话；空字符串视为无效） */
  caption: string;
}

export interface CanvasLayoutInput {
  /** 整图一句描述（MOSS 的 `summary.caption`） */
  summary: string;
  frames: readonly CanvasLayoutFrame[];
  /** 目标出图尺寸（像素）—— 中心像素坐标依赖它 */
  size: { width: number; height: number };
  /** 四周留白（占宽/高的比例，默认 0.04）：贴边的框容易被模型当成"背景" */
  padding?: number;
}

/** MOSS 认的布局 JSON（原样发出去的那份） */
export const MossLayoutSchema = z.object({
  summary: z.object({ caption: z.string().min(1) }),
  items: z
    .array(
      z.object({
        label: z.enum(['object', 'character', 'text']),
        caption: z.string().min(1),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      }),
    )
    .min(1),
  bbox_coord_space: z.literal('abs_centralized'),
  bbox_format: z.literal('yxyx'),
});
export type MossLayout = z.infer<typeof MossLayoutSchema>;

export type CanvasLayoutResult =
  | { ok: true; layout: MossLayout; promptText: string }
  | { ok: false; reason: string };

const DEFAULT_PADDING = 0.04;
/** 框的最小边长（中心像素）：比这更小的框模型基本无视，不如直接报错 */
const MIN_BOX_PX = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 把画布矩形换算成 MOSS 的中心像素坐标并组装提示词。
 *
 * 几何约定（与真机验证过的那份一致）：
 * - 先把参与的框取**外接矩形**，四周按 `padding` 外扩 → 这块区域对应整张图；
 * - 每个框的边线性映射到出图像素，再**减去半宽/半高**变成中心坐标；
 * - `bbox` 顺序是 `[y0, x0, y1, x1]`（yxyx），且 y0<y1、x0<x1。
 */
export function buildMossLayout(input: CanvasLayoutInput): CanvasLayoutResult {
  const summary = input.summary.trim();
  if (summary === '') return { ok: false, reason: '缺少整图描述（summary）' };

  const frames = input.frames.filter((frame) => frame.caption.trim() !== '');
  if (frames.length === 0) return { ok: false, reason: '没有可用的框：每个框都需要一句描述' };
  if (frames.length === 1) {
    // 单个框铺满整张图，等于没约束 —— 与其生成一条误导性的提示词，不如直接说不适用
    return { ok: false, reason: '至少需要两个框：只有一个框时布局等于"整张图"' };
  }

  const { width, height } = input.size;
  if (!(width > 0) || !(height > 0)) return { ok: false, reason: '出图尺寸不合法' };

  const padding = input.padding ?? DEFAULT_PADDING;
  const left = Math.min(...frames.map((frame) => frame.layout.x));
  const top = Math.min(...frames.map((frame) => frame.layout.y));
  const right = Math.max(...frames.map((frame) => frame.layout.x + frame.layout.width));
  const bottom = Math.max(...frames.map((frame) => frame.layout.y + frame.layout.height));
  const rawWidth = right - left;
  const rawHeight = bottom - top;
  if (!(rawWidth > 0) || !(rawHeight > 0)) return { ok: false, reason: '框的包围盒为空' };

  // 外扩 padding（比例按各自轴算，保持宽高比不变形）
  const padX = rawWidth * padding;
  const padY = rawHeight * padding;
  const regionLeft = left - padX;
  const regionTop = top - padY;
  const regionWidth = rawWidth + padX * 2;
  const regionHeight = rawHeight + padY * 2;

  const toPixelY = (value: number): number =>
    clamp(((value - regionTop) / regionHeight) * height, 0, height) - height / 2;
  const toPixelX = (value: number): number =>
    clamp(((value - regionLeft) / regionWidth) * width, 0, width) - width / 2;

  const items: MossLayout['items'] = [];
  for (const frame of frames) {
    const y0 = toPixelY(frame.layout.y);
    const y1 = toPixelY(frame.layout.y + frame.layout.height);
    const x0 = toPixelX(frame.layout.x);
    const x1 = toPixelX(frame.layout.x + frame.layout.width);
    if (y1 - y0 < MIN_BOX_PX || x1 - x0 < MIN_BOX_PX) {
      return { ok: false, reason: `框「${frame.caption.trim().slice(0, 12)}」在出图里太小（< ${MIN_BOX_PX}px）` };
    }
    items.push({
      label: 'object',
      caption: frame.caption.trim(),
      bbox: [Math.round(y0), Math.round(x0), Math.round(y1), Math.round(x1)],
    });
  }

  const layout: MossLayout = {
    summary: { caption: summary },
    items,
    bbox_coord_space: 'abs_centralized',
    bbox_format: 'yxyx',
  };

  // 发出去的就是这段文本（紧凑单行：模型读的是内容，不需要缩进浪费 token）
  return { ok: true, layout, promptText: JSON.stringify(layout) };
}
