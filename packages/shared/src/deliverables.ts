import { z } from 'zod';

/**
 * 交付物工程化（V2.13 / 台账 B49，契约 §14）。
 *
 * ## 这个模块解决的是什么
 * B 端客户要"能交出去的东西"：一批成片 + **统一的命名** + **对齐的平台规格** + **一份可复现的清单**。
 * 当前只有"单条下载"，命名是用户自己在另存为对话框里敲的 —— 交付十个文件就有十种命名法。
 *
 * ## 三条口径（都是"不假装"）
 * 1. **不转码**：规格预设在这里是**命名与校验**（成片是对竖屏还是横屏、时长是否超平台上限），
 *    不是"帮你把 16:9 压成 9:16"。真要转码是渲染/转码链路的事（登记在 §9-B49 余项）。
 * 2. **每条预设都带 `basis`**（口径从哪来）—— 与成本单价表同一条纪律：**未经实测的数字不许当结论**。
 *    因此这里的画幅/时长一律写成**平台公开的推荐值**，而不是"实测过抖音的编码参数"。
 * 3. **清单如实标注缺什么**（`notes`）：未随包的条目、预估成本的口径、缺封面等等。
 *
 * 消费方：前端「交付包」面板（`frontend/src/lib/deliverables.ts` 之上的 UI）与冒烟断言。
 */

/** 预设的画幅（与生成端的画幅同一套字符串） */
export const PRESET_ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const;
export type PresetAspectRatio = (typeof PRESET_ASPECT_RATIOS)[number];

export interface PlatformPreset {
  presetId: string;
  /** 平台名（出现在文件名里，故保持短而稳） */
  label: string;
  aspectRatio: PresetAspectRatio;
  /** 建议分辨率（平台公开的推荐值） */
  width: number;
  height: number;
  /** 平台时长上限（秒）—— 超出只提示，不阻断（客户有权自己决定） */
  maxDurationSec: number;
  /** 人话说明（交付时勾哪个档位看这句） */
  note: string;
  /** 口径来源（**必填**：未经实测的数字必须说清是从哪来的） */
  basis: string;
}

export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  {
    presetId: 'douyin-vertical',
    label: '抖音竖屏',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    maxDurationSec: 60,
    note: '信息流竖屏；首帧就是封面，标题建议后置',
    basis: '抖音官方创作规范公开推荐值（1080×1920 / 竖屏）；**未做我方实测**',
  },
  {
    presetId: 'shipinhao-vertical',
    label: '视频号竖屏',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    maxDurationSec: 60,
    note: '与抖音同画幅，便于一条成片双投',
    basis: '微信视频号公开推荐值（竖屏 1080×1920）；**未做我方实测**',
  },
  {
    presetId: 'xiaohongshu-vertical',
    label: '小红书竖屏',
    aspectRatio: '9:16',
    width: 1080,
    height: 1440,
    maxDurationSec: 60,
    note: '3:4 更贴小红书的图文混排观感；纯视频用 9:16 也行',
    basis: '小红书公开推荐比例（3:4 图文 / 9:16 视频）；这里取 3:4 的 1080×1440；**未做我方实测**',
  },
  {
    presetId: 'taobao-main-1x1',
    label: '淘宝主图视频',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    maxDurationSec: 60,
    note: '主图位是方形；商品居中、边缘留安全区',
    basis: '淘宝主图视频公开要求（1:1 / 时长上限 60s 量级）；**未做我方实测**',
  },
  {
    presetId: 'wide-1080p',
    label: '通用横屏 1080p',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    maxDurationSec: 300,
    note: '官网 / 展厅 / 内部放映用，不受平台时长限制',
    basis: '通用 1080p 口径（非某平台约束）',
  },
] as const;

export const DEFAULT_PLATFORM_PRESET_ID = 'douyin-vertical';

export function findPlatformPreset(presetId: string): PlatformPreset | null {
  return PLATFORM_PRESETS.find((preset) => preset.presetId === presetId) ?? null;
}

/**
 * 文件名片段的归一化（交付包里要能**直接落进客户的 Windows 与 macOS**）：
 * 去掉路径分隔符与 Windows 非法字符、控制字符、首尾点与空格；空白折叠为 `-`；超长截断。
 * 返回空串表示"这段没内容"（调用方负责用兜底值，例如任务 id 前 8 位）。
 */
export function sanitizeFileSegment(text: string, maxLength = 24): string {
  const cleaned = text
    // **一段连续的非字母/非数字字符统统折成单个 `-`**：这比维护一张"非法字符表"更稳 ——
    // Windows 的非法字符、空格、控制字符、路径分隔符、各种中英文标点（`·`、`，`、`：`…）
    // 全在这一条里，而且不会出现"`双十一 · 主推片` → `双十一-·-主推片`"这种把一个标点
    // 留成分段的别扭结果。`\p{L}` 保留各国字母（含中日韩），`\p{N}` 保留数字。
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return cleaned;
}

export interface DeliverableNameInput {
  preset: PlatformPreset;
  /** 项目名（交付包的"客户/项目"标识） */
  projectName: string;
  /** 该条的语义名（一般用提示词前几个字；空则回落 taskId） */
  semantic: string;
  taskId: string;
  /** 序号（**1 起**） */
  index: number;
  /** 总数（决定序号补零位宽，让文件名按字符串排序也正确） */
  total: number;
  /** 扩展名（不含点），如 `mp4` / `json` */
  ext: string;
  date?: Date;
}

/**
 * 命名模板：`项目-YYYYMMDD-序号-档位-语义.mp4`。
 *
 * 为什么把日期放进去：交付最常见的返工理由是"哪一版是最新的"，而文件系统只保证
 * "修改时间"这一列 —— 客户会把文件拷来拷去、用微信传，时间戳早就不代表版本了。
 * 序号宽度按总数自适应（9 条 → `1`；12 条 → `01`），这样文件管理器按名字排序就是交付顺序。
 */
export function buildDeliverableFileName(input: DeliverableNameInput): string {
  const date = input.date ?? new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  const width = String(Math.max(1, input.total)).length;
  const seq = String(input.index).padStart(width, '0');
  const semantic = sanitizeFileSegment(input.semantic, 20) || input.taskId.slice(0, 8);

  const segments = [
    sanitizeFileSegment(input.projectName, 20) || 'project',
    stamp,
    seq,
    sanitizeFileSegment(input.preset.label, 16) || input.preset.presetId,
    semantic,
  ];
  return `${segments.join('-')}.${input.ext}`;
}

/** 交付包的文件名（同理：项目 + 日期 + 档位） */
export function buildDeliverablePackageName(input: {
  projectName: string;
  preset: PlatformPreset;
  count: number;
  date?: Date;
}): string {
  const date = input.date ?? new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  return [
    sanitizeFileSegment(input.projectName, 20) || 'project',
    stamp,
    sanitizeFileSegment(input.preset.label, 16) || input.preset.presetId,
    `${input.count}条`,
  ].join('-') + '.zip';
}

export interface PresetCheckInput {
  aspectRatio?: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

/**
 * 成片 vs 预设的对齐检查 —— **只提示，不阻断，更不转码**。
 * 返回的每条都是"人话 + 可执行动作"，而不是"不符合规格"这种无指向措辞。
 */
export function presetWarnings(item: PresetCheckInput, preset: PlatformPreset): string[] {
  const warnings: string[] = [];
  if (item.aspectRatio !== undefined && item.aspectRatio !== preset.aspectRatio) {
    warnings.push(
      `画幅是 ${item.aspectRatio}，${preset.label} 推荐 ${preset.aspectRatio} —— 平台可能自动裁边（本工具不转码）`,
    );
  }
  if (item.durationSec !== undefined && item.durationSec > preset.maxDurationSec) {
    warnings.push(
      `时长 ${item.durationSec}s 超过 ${preset.label} 的 ${preset.maxDurationSec}s 上限 —— 平台会截断或拒收`,
    );
  }
  if (
    item.width !== undefined &&
    item.height !== undefined &&
    (item.width < preset.width || item.height < preset.height)
  ) {
    warnings.push(
      `分辨率 ${item.width}×${item.height} 低于预设 ${preset.width}×${preset.height} —— 平台会再次压缩`,
    );
  }
  return warnings;
}

// ── 归档清单（可复现交付包的"说明书"）────────────────────────────────────────

export const DeliverableManifestSchema = z.object({
  manifestVersion: z.literal(1),
  generatedAt: z.number().int(),
  project: z.object({ projectId: z.string(), name: z.string() }),
  preset: z.object({
    presetId: z.string(),
    label: z.string(),
    aspectRatio: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    maxDurationSec: z.number(),
  }),
  items: z.array(
    z.object({
      taskId: z.string(),
      fileName: z.string(),
      prompt: z.string(),
      mode: z.string(),
      aspectRatio: z.string(),
      durationSec: z.number(),
      createdAt: z.number().nullable(),
      /** 视频是否真的进了包（理论上都为 true；条目里带它，才能解释"清单比包大"的情况） */
      packaged: z.boolean(),
      /** 工程 JSON 是否随包（剪辑产物才有） */
      projectIncluded: z.boolean(),
      /**
       * 这条成片是否**按平台规格重新渲染过**（V2.14 / 片 B）。
       * `false` = 原文件直接进包（已对齐，或用户没勾转码）—— 客户系统据此知道"哪几条是重编码产物"。
       */
      transcoded: z.boolean(),
      /** 引用的素材（`requestSnapshot.assets` 的原样快照 —— 可复现的关键） */
      assets: z.array(z.string()),
      extractedAssetCount: z.number().int(),
      costYuan: z.number().nullable(),
      warnings: z.array(z.string()),
    }),
  ),
  notes: z.array(z.string()),
});

export type DeliverableManifest = z.infer<typeof DeliverableManifestSchema>;

export interface DeliverableManifestItemInput {
  taskId: string;
  fileName: string;
  prompt: string;
  mode: string;
  aspectRatio: string;
  durationSec: number;
  createdAt?: number;
  packaged: boolean;
  projectIncluded: boolean;
  transcoded?: boolean;
  assets?: string[];
  extractedAssetCount?: number;
  costYuan?: number;
  warnings?: string[];
}

export function buildDeliverableManifest(input: {
  project: { projectId: string; name: string };
  preset: PlatformPreset;
  items: DeliverableManifestItemInput[];
  generatedAt?: number;
}): DeliverableManifest {
  const packaged = input.items.filter((item) => item.packaged).length;
  const notes = [
    '金额为**预估**（公开价目 × 上游计费公式），未与我方账单核对；实际扣费以火山方舟控制台账单为准。',
    // 措辞刻意不写"已/未转码"：转码与否**逐条不同**（`transcoded` 字段才是权威），
    // 一句总的"没转码"会在勾了转码时变成假话
    '成片是否按平台规格重新渲染过，见每条 `transcoded`；画幅与时长是否合平台要求见每条 `warnings`。',
  ];
  if (packaged < input.items.length) {
    notes.push(`清单里 ${input.items.length} 条，其中 ${packaged} 条的视频已随包（其余为清单内引用）。`);
  }
  const transcoded = input.items.filter((item) => item.transcoded === true).length;
  if (transcoded > 0) {
    notes.push(
      `${transcoded} 条成片按平台规格重新渲染过：画幅按 cover 裁切（不拉伸）、帧率归一到工程帧率、**时长未改动**。`,
    );
  }

  return {
    manifestVersion: 1,
    generatedAt: input.generatedAt ?? Date.now(),
    project: input.project,
    preset: {
      presetId: input.preset.presetId,
      label: input.preset.label,
      aspectRatio: input.preset.aspectRatio,
      width: input.preset.width,
      height: input.preset.height,
      maxDurationSec: input.preset.maxDurationSec,
    },
    items: input.items.map((item) => ({
      taskId: item.taskId,
      fileName: item.fileName,
      prompt: item.prompt,
      mode: item.mode,
      aspectRatio: item.aspectRatio,
      durationSec: item.durationSec,
      createdAt: item.createdAt ?? null,
      packaged: item.packaged,
      projectIncluded: item.projectIncluded,
      transcoded: item.transcoded ?? false,
      assets: item.assets ?? [],
      extractedAssetCount: item.extractedAssetCount ?? 0,
      costYuan: item.costYuan ?? null,
      warnings: item.warnings ?? [],
    })),
    notes,
  };
}
