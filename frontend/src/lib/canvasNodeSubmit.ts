import {
  estimateCostFromRequest,
  scanCanvasMentions,
  type AspectRatio,
  type CanvasDocNode,
  type CanvasReference,
  type CanvasReferenceRole,
  type CostRecord,
  type GenerationAssets,
  type GenerationMode,
  type ProviderStatus,
  type VideoGenerateRequest,
} from '@astrmira/shared';
import { canvasNodeVisibleOutput } from './canvasDocOps';
import {
  DEFAULT_COMFY_ENGINE_ID,
  comfyUiEngineOptions,
  httpServiceEngineOptions,
  isComfyUiEngine,
  isHttpServiceEngine,
} from './engineOptions';
import { getLanguage, translate, type MessageKey } from './i18n';
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_RESOLUTION_TIER,
  resolveImageSize,
  resolveTargetSize,
  tierForSize,
  type ResolutionTier,
} from './format';

/**
 * 画布节点的「提交前判定」（Step 11-S3 片 B3；CONTRACT §21-10）。
 *
 * 为什么单独成文件：这些判定是**纯函数**（节点 + 能力位 → 模式/引擎/问题码），
 * 组件只负责把问题码翻成一句可执行的中文。判断散在 JSX 里就只能靠肉眼点。
 *
 * 三条纪律：
 * 1. **不静默丢素材**：当前服务端没有通道的参考（多图参考 / 音频参考）一律**阻止提交**并给理由；
 * 2. **默认引擎 = 当前可用且最便宜**：没配 Key 的云端不该成为默认（提交必失败）；
 * 3. 这里只做**界面侧前置校验**：服务端仍按 §1 校验，不因为这里放行就保证成功。
 */

export type CanvasSubmitIssue =
  | 'empty-prompt'
  | 'text-node'
  | 'active-task'
  | 'reference-unsupported'
  | 'image-needs-local'
  | 'image-unavailable'
  | 'mode-unsupported'
  | 'cloud-key-missing'
  | 'provider-unavailable'
  /** B 路线：提示词里的 `{{image:N}}` 越界（引用了不存在的素材） */
  | 'mention-out-of-range'
  /** V2.80：参考张数超过**这台实例**的实测上限（连线时已拦，这里兜旧文档） */
  | 'references-over-limit';

export interface CanvasSubmitContext {
  providerStatus: ProviderStatus | null;
  /** 用户在凭据抽屉里填了视频轨 Key（有值 = 云端可用，不依赖服务端兜底） */
  hasCloudKey: boolean;
}

/** 问题码 → 字典键（组件与提交守卫共用同一份，避免两处文案漂移） */
const ISSUE_KEYS: Record<CanvasSubmitIssue, MessageKey> = {
  'empty-prompt': 'canvas.studio.issue.emptyPrompt',
  'text-node': 'canvas.studio.textNodeHint',
  'active-task': 'canvas.studio.issue.activeTask',
  'reference-unsupported': 'canvas.studio.issue.references',
  'image-needs-local': 'canvas.studio.issue.imageLocal',
  'image-unavailable': 'canvas.studio.issue.imageUnavailable',
  'mode-unsupported': 'canvas.studio.issue.modeUnsupported',
  'cloud-key-missing': 'canvas.studio.issue.cloudKey',
  'provider-unavailable': 'canvas.studio.issue.provider',
  'mention-out-of-range': 'canvas.studio.issue.mentionOutOfRange',
  'references-over-limit': 'canvas.studio.issue.referencesOverLimit',
};

/** 按当前语言翻成一句可执行的中文/英文（与 `engineOptions` 同一手法：非 React 上下文取文案） */
export function canvasSubmitIssueText(issue: CanvasSubmitIssue): string {
  return translate(getLanguage(), ISSUE_KEYS[issue]);
}

export interface CanvasDraftMode {
  mode: GenerationMode;
  assets?: GenerationAssets;
  /** 当前服务端没有通道、或同一用途给了多份而**不会被发送**的参考（非空就不许提交） */
  unsupportedRoles: CanvasReferenceRole[];
}

function firstByRole(
  references: CanvasDocNode['data']['draft']['references'],
  role: CanvasReferenceRole,
): CanvasDocNode['data']['draft']['references'][number] | undefined {
  return [...references].sort((a, b) => a.order - b.order).find((item) => item.role === role);
}

/**
 * 节点草稿 → 生成模式与参考字段。
 *
 * 模式映射（契约写死，不猜）：
 * - image → `t2i`（S9-A3：带单张 reference-image 时把该图作首帧参考发出去——ReferenceLatent 派生编辑）
 * - video：参考视频 → `v2v`；首 + 尾帧 → `fl2v`；只有首帧 → `i2v`；否则 → `t2v`
 */
export function canvasDraftMode(node: CanvasDocNode): CanvasDraftMode {
  const references = node.data.draft.references;
  const unsupportedRoles: CanvasReferenceRole[] = [];

  // B 路线（V2.76）：图片节点的「全能参考」= N 张 reference-image 按 order 进槽位。
  // `order` 在这里**重新编号成 0..n-1**：schema 要求不重复，画布上删过中间那张后会出现空洞。
  if (
    node.type === 'image' &&
    node.data.draft.settings.referenceMode === 'omni-reference'
  ) {
    const slots = [...references]
      .filter((item) => item.role === 'reference-image')
      .sort((left, right) => left.order - right.order);
    unsupportedRoles.push(
      ...references.filter((item) => item.role !== 'reference-image').map((item) => item.role),
    );
    return {
      mode: 't2i',
      ...(slots.length === 0
        ? {}
        : {
            assets: {
              references: slots.map((item, index) => ({
                assetId: item.assetId,
                role: 'reference-image' as const,
                order: index,
                // V2.86：溯源标签原样带上（服务端只存不用；缺省时整键省略）
                ...(item.subjectId === undefined ? {} : { subjectId: item.subjectId }),
              })),
            },
          }),
      unsupportedRoles: dedupe(unsupportedRoles),
    };
  }

  if (node.type === 'image') {
    // S9-A3：图片节点支持**单张** reference-image（派生编辑——以它图为底参考出图，
    // provider 走 ReferenceLatent 变体模板）；其余角色仍无通道，不能假装用了。
    const editSources = references.filter((item) => item.role === 'reference-image');
    if (editSources.length > 1) unsupportedRoles.push(...editSources.slice(1).map((item) => item.role));
    unsupportedRoles.push(
      ...references
        .filter((item) => item.role !== 'reference-image')
        .map((item) => item.role),
    );
    const source = [...editSources].sort((a, b) => a.order - b.order)[0];
    return {
      mode: 't2i',
      ...(source === undefined ? {} : { assets: { firstFrameImage: source.assetId } }),
      unsupportedRoles: dedupe(unsupportedRoles),
    };
  }

  if (node.type === 'text') {
    // 文本节点不提交生成；这里返回 t2v 只是为了让类型闭环（调用方先看 text-node 问题码）
    return { mode: 't2v', unsupportedRoles: [] };
  }

  const videos = references.filter((item) => item.role === 'reference-video');
  const firsts = references.filter((item) => item.role === 'first-frame');
  const lasts = references.filter((item) => item.role === 'last-frame');

  // 同一用途给了多份 → 只有排序第一的那份会被发送，其余如实报出来
  if (videos.length > 1) unsupportedRoles.push(...videos.slice(1).map((item) => item.role));
  if (firsts.length > 1) unsupportedRoles.push(...firsts.slice(1).map((item) => item.role));
  if (lasts.length > 1) unsupportedRoles.push(...lasts.slice(1).map((item) => item.role));

  // 这些用途当前没有通道（§1 的 assets 只有首帧/尾帧/参考视频）
  unsupportedRoles.push(
    ...references
      .filter((item) => item.role === 'reference-image' || item.role === 'reference-audio')
      .map((item) => item.role),
  );

  const video = firstByRole(references, 'reference-video');
  const first = firstByRole(references, 'first-frame');
  const last = firstByRole(references, 'last-frame');

  if (video !== undefined) {
    // v2v 只吃参考视频；首/尾帧这时不会被发送
    if (first !== undefined) unsupportedRoles.push('first-frame');
    if (last !== undefined) unsupportedRoles.push('last-frame');
    return {
      mode: 'v2v',
      assets: { referenceVideo: video.assetId },
      unsupportedRoles: dedupe(unsupportedRoles),
    };
  }

  if (first !== undefined && last !== undefined) {
    return {
      mode: 'fl2v',
      assets: { firstFrameImage: first.assetId, lastFrameImage: last.assetId },
      unsupportedRoles: dedupe(unsupportedRoles),
    };
  }

  if (first !== undefined) {
    return {
      mode: 'i2v',
      assets: { firstFrameImage: first.assetId },
      unsupportedRoles: dedupe(unsupportedRoles),
    };
  }

  if (last !== undefined) {
    // 只有尾帧没有首帧：首尾帧模式不成立，尾帧也不会被发送
    unsupportedRoles.push('last-frame');
    return { mode: 't2v', unsupportedRoles: dedupe(unsupportedRoles) };
  }

  return { mode: 't2v', unsupportedRoles: dedupe(unsupportedRoles) };
}

function dedupe(roles: CanvasReferenceRole[]): CanvasReferenceRole[] {
  return [...new Set(roles)];
}

/**
 * V2.87（D-2）：视频节点上的"多图参考"没有通道。
 *
 * ## 为什么是提示而不是能力
 * 本地视频轨（Wan TI2V）只有 **1 张条件图**的入口；即梦那套"多图全能参考"是模型侧能力，
 * 我们没有对应模板。所以这里**不假装能跑**：返回"这个节点有几张图、用不了"，
 * 界面据此给一条**可执行的替代路径**，提交时仍按 `reference-unsupported` 明确拒绝。
 *
 * 判据（三条都算"多图"）：
 * - 图片参考总数 > 2（首帧 + 尾帧已是最多的合法组合）；
 * - 出现 `reference-image`（视频节点上它没有通道，即使只有 1 张）。
 *
 * 返回 `null` = 没有这个问题（0~2 张且都是首/尾帧 —— 正常可提交）。
 */
export function videoMultiImageAdvice(node: CanvasDocNode): { images: number } | null {
  if (node.type !== 'video') return null;
  const references = node.data.draft.references;
  const images = references.filter(
    (item) =>
      item.role === 'first-frame' || item.role === 'last-frame' || item.role === 'reference-image',
  ).length;
  const hasOmniStyle = references.some((item) => item.role === 'reference-image');
  if (images <= 2 && !hasOmniStyle) return null;
  if (images === 0) return null;
  return { images };
}

/**
 * S5-B1b：画布首尾帧交换。
 *
 * 只交换 `first-frame` 与 `last-frame` 的 role/order；参考视频和其它引用原位不动。
 * 请求组装按 role 取产物（`firstByRole`），所以交换 role 就是交换真正发给上游的首尾帧。
 */
export function swapFirstLastReferences(
  references: readonly CanvasReference[],
): CanvasReference[] {
  const first = references.find((item) => item.role === 'first-frame');
  const last = references.find((item) => item.role === 'last-frame');
  if (first === undefined || last === undefined) return [...references];
  return references.map((item) => {
    if (item === first) return { ...last, role: 'first-frame' as const, order: first.order };
    if (item === last) return { ...first, role: 'last-frame' as const, order: last.order };
    return item;
  });
}

/** 节点默认引擎：存过就用存的；否则按"当前可用且最便宜"推断 */
export function canvasDefaultProvider(node: CanvasDocNode, context: CanvasSubmitContext): string {
  const stored = node.data.draft.settings.provider;
  if (stored !== undefined && stored !== '') return stored;

  // V2.51：按**当前草稿实际要用的模式**筛，不是“任一视频模式”；缺省 modes = 未自检，不据此禁用
  const wantedMode = canvasDraftMode(node).mode;
  const local = comfyUiEngineOptions(context.providerStatus).find(
    (item) =>
      item.configured &&
      (item.modes === undefined || item.modes.includes(wantedMode)),
  );
  const http = httpServiceEngineOptions(context.providerStatus).find(
    (item) => item.configured && item.modes?.includes(wantedMode) === true,
  );

  if (node.type === 'image') {
    return local?.id ?? http?.id ?? DEFAULT_COMFY_ENGINE_ID;
  }

  const cloudReady =
    context.hasCloudKey || context.providerStatus?.cloud.available === true;
  if (cloudReady) return 'cloud-volcano-seedance';
  return local?.id ?? http?.id ?? 'cloud-volcano-seedance';
}

export function canvasAspectRatio(node: CanvasDocNode): AspectRatio {
  return node.data.draft.settings.aspectRatio ?? (node.type === 'image' ? '1:1' : '16:9');
}

export function canvasResolutionTier(node: CanvasDocNode): ResolutionTier {
  const resolution = node.data.draft.settings.resolution;
  if (resolution === undefined) return DEFAULT_RESOLUTION_TIER;
  return tierForSize(resolution.width, resolution.height);
}

export function canvasResolution(node: CanvasDocNode): { width: number; height: number } {
  // V2.50：t2i 用图片尺寸档（1024 系），不沿用视频 480p；后端 t2i 分支同样是这组基准。
  if (node.type === 'image') return resolveImageSize(canvasAspectRatio(node));
  return (
    node.data.draft.settings.resolution ??
    resolveTargetSize(canvasAspectRatio(node), canvasResolutionTier(node))
  );
}

export function canvasDurationSec(node: CanvasDocNode): number {
  return node.data.draft.settings.durationSec ?? DEFAULT_DURATION_SEC;
}

/**
 * 提交前的第一个问题码（`null` = 界面看起来可以提交）。
 *
 * 判定顺序：空提示词 → 节点类型 → 在跑任务 → 参考通道 → 引擎/凭据。
 * 先报"你没写提示词"比先报"引擎没配"更有用。
 */
export function canvasSubmitIssue(
  node: CanvasDocNode,
  provider: string,
  context: CanvasSubmitContext,
): CanvasSubmitIssue | null {
  if (node.type === 'text') return 'text-node';
  if (node.data.draft.prompt.trim() === '') return 'empty-prompt';

  const active = node.data.batches.some(
    (batch) =>
      batch.status === 'running' ||
      (batch.status === 'queued' &&
        (batch.taskId !== undefined || batch.request !== undefined)),
  );
  if (active) return 'active-task';

  const draft = canvasDraftMode(node);
  if (draft.unsupportedRoles.length > 0) return 'reference-unsupported';

  /**
   * V2.80：连满 12 张但实例只跑得动 4 张时，**在点生成之前**就说清楚。
   * 连线那一刻已经按能力拦过；这里兜住"旧文档 / 换了引擎 / env 被调小"这三种情况。
   */
  const capacity = comfyUiEngineOptions(context.providerStatus).find(
    (option) => option.id === provider,
  )?.maxReferences;
  if (
    node.data.draft.settings.referenceMode === 'omni-reference' &&
    capacity !== undefined &&
    draft.assets?.references !== undefined &&
    draft.assets.references.length > Math.min(12, capacity)
  ) {
    return 'references-over-limit';
  }

  // B 路线：`{{image:N}}` 越界时提交前就拦住（不静默改用户的提示词）
  if (draft.assets?.references !== undefined) {
    const scan = scanCanvasMentions(node.data.draft.prompt, draft.assets.references.length);
    if (scan.problems.length > 0) return 'mention-out-of-range';
  }
  const wantedMode = draft.mode;

  if (node.type === 'image') {
    if (isComfyUiEngine(provider)) {
      if (context.providerStatus?.comfyui.available !== true) return 'image-unavailable';
      const option = comfyUiEngineOptions(context.providerStatus).find(
        (item) => item.id === provider,
      );
      if (option === undefined || !option.configured) return 'image-unavailable';
      if (option.modes !== undefined && !option.modes.includes(wantedMode)) {
        return 'mode-unsupported';
      }
      return null;
    }
    if (isHttpServiceEngine(provider)) {
      const option = httpServiceEngineOptions(context.providerStatus).find(
        (item) => item.id === provider,
      );
      if (option === undefined || !option.configured) return 'provider-unavailable';
      if (option.modes?.includes(wantedMode) !== true) return 'provider-unavailable';
      return null;
    }
    return 'image-needs-local';
  }

  if (provider === 'cloud-volcano-seedance') {
    if (!context.hasCloudKey && context.providerStatus?.cloud.available !== true) {
      return 'cloud-key-missing';
    }
    return null;
  }

  if (isComfyUiEngine(provider)) {
    const option = comfyUiEngineOptions(context.providerStatus).find((item) => item.id === provider);
    if (option === undefined || !option.configured) return 'provider-unavailable';
    if (option.modes !== undefined && !option.modes.includes(wantedMode)) {
      return 'mode-unsupported';
    }
    return null;
  }

  if (isHttpServiceEngine(provider)) {
    const option = httpServiceEngineOptions(context.providerStatus).find(
      (item) => item.id === provider,
    );
    if (option === undefined || !option.configured) return 'provider-unavailable';
    if (option.modes?.includes(wantedMode) !== true) return 'mode-unsupported';
    return null;
  }

  return 'provider-unavailable';
}

/**
 * 发上游前剥掉 `{{image:N}}`（V2.76 / B 路线）。
 *
 * 这个语法是**我们的槽位标注**：画布靠它说清"第几张素材"，但**目前没有任何 provider 消费它**
 * ——ComfyUI 的 ReferenceLatent 是全局条件，没有"文中提及"这种机制（即梦的 `{{image:N}}`
 * 是他们服务端的私有协议）。把大括号原样喂给模型只会变成噪声，所以发送前清掉；
 * 草稿里**保留原文**，用户仍能看到、编辑、并靠它对齐 `#0/#1` 的槽位号。
 */
export function stripCanvasMentions(prompt: string): string {
  return prompt
    .replace(/\{\{image:\d{1,3}\}\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** 组装 `POST /api/generate` 的请求体（画布来源；`origin` / `canvasProjectId` 见 V2.43） */
export function buildCanvasGenerateRequest(input: {
  node: CanvasDocNode;
  provider: string;
  /** 资产项目（§12）——与画布项目不是一回事 */
  projectId: string;
  canvasProjectId: string;
  /** BYOK 的端点与模型名（未识别键由服务端忽略，与工作台同一口径） */
  baseUrl?: string;
  model?: string;
}): VideoGenerateRequest {
  const { node } = input;
  const draftMode = canvasDraftMode(node);
  const video = node.type === 'video';

  return {
    prompt: stripCanvasMentions(node.data.draft.prompt),
    mode: draftMode.mode,
    ...(draftMode.assets === undefined ? {} : { assets: draftMode.assets }),
    aspectRatio: canvasAspectRatio(node),
    resolution: canvasResolution(node),
    provider: input.provider,
    projectId: input.projectId,
    origin: 'canvas',
    canvasProjectId: input.canvasProjectId,
    options: {
      ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
      ...(input.model === undefined ? {} : { model: input.model }),
    },
    ...(video ? { params: { durationSec: canvasDurationSec(node) } } : {}),
  };
}

/**
 * V2.77：把节点**当前可见产物**放大的请求（`mode: 'upscale'`）。
 *
 * 与"生成"的区别：
 * - 输入是**已经出来的那张图**（不是草稿里的参考），所以取 `canvasNodeVisibleOutput`；
 * - 不吃提示词（`prompt: ''` 是合法输入，服务端对 upscale 放行空提示词）；
 * - 倍率走 `options.scale`，由 provider 决定"4x 模型 + 降采样"的具体做法。
 *
 * 没有可见产物时返回 null —— 界面据此不显示按钮（不做点了没反应的按钮）。
 */
export function buildCanvasUpscaleRequest(input: {
  node: CanvasDocNode;
  provider: string;
  projectId: string;
  canvasProjectId: string;
  scale: 2 | 4;
}): VideoGenerateRequest | null {
  const visible = canvasNodeVisibleOutput(input.node);
  if (visible.state !== 'selected' && visible.state !== 'latest') return null;
  return {
    prompt: '',
    mode: 'upscale',
    assets: { firstFrameImage: visible.output.assetId },
    aspectRatio: canvasAspectRatio(input.node),
    resolution: canvasResolution(input.node),
    provider: input.provider,
    projectId: input.projectId,
    origin: 'canvas',
    canvasProjectId: input.canvasProjectId,
    options: { scale: String(input.scale) },
  };
}

/** 提交前预估（与创作页共用 `estimateCostFromRequest`；本地轨为 0，云端按公开价目） */
export function estimateCanvasNodeCost(
  node: CanvasDocNode,
  provider: string,
  model: string | undefined,
): CostRecord | null {
  return estimateCostFromRequest(
    {
      resolution: canvasResolution(node),
      ...(node.type === 'video' ? { params: { durationSec: canvasDurationSec(node) } } : {}),
      options: model === undefined || model.trim() === '' ? {} : { model },
    },
    { track: provider === 'cloud-volcano-seedance' ? 'cloud' : 'local' },
  );
}
