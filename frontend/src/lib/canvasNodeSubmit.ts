import {
  estimateCostFromRequest,
  type AspectRatio,
  type CanvasDocNode,
  type CanvasReferenceRole,
  type CostRecord,
  type GenerationAssets,
  type GenerationMode,
  type ProviderStatus,
  type VideoGenerateRequest,
} from '@astrmira/shared';
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
  | 'provider-unavailable';

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
 * - image → `t2i`（本地模板出图，不带任何参考）
 * - video：参考视频 → `v2v`；首 + 尾帧 → `fl2v`；只有首帧 → `i2v`；否则 → `t2v`
 */
export function canvasDraftMode(node: CanvasDocNode): CanvasDraftMode {
  const references = node.data.draft.references;
  const unsupportedRoles: CanvasReferenceRole[] = [];

  if (node.type === 'image') {
    // 当前图像通道只有 t2i：任何参考都不会被发送，不能假装用了
    if (references.length > 0) unsupportedRoles.push(...references.map((item) => item.role));
    return { mode: 't2i', unsupportedRoles: dedupe(unsupportedRoles) };
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
    prompt: node.data.draft.prompt.trim(),
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
