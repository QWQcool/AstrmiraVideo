import {
  STORYBOARD_SESSION_MAX_SHOTS,
  createCanvasNode,
  type CanvasDoc,
  type CanvasDocEdge,
  type CanvasDocNode,
  type CanvasReference,
  type CreationRunInput,
  type CreationRunInputStep,
  type CreationRunMode,
  type StoryboardExpansion,
  type StoryboardReference,
} from '@astrmira/shared';

/**
 * S8-A2b：把分镜展开结果（`StoryboardExpansion`）批量落成画布草稿节点。
 *
 * 三条口径（与 CONTRACT §28-6/§21-11 同源）：
 * 1. **只落草稿**：不提交任何生成（`/api/generate` 计数必须为 0）；
 * 2. 首帧图草稿 → 视频草稿之间连 **`dependency` 计划边**（D73；虚线，上游出片后由会话执行消费）；
 * 3. 参考图只在**没有首帧图节点**的镜头上自动接线（第一张 = 首帧、第二张 = 尾帧）；
 *    接不上的**进报告**，不静默丢。
 *
 * 全纯函数：视图只负责调用与提示。
 */

/** 图片列 → 视频列的水平步进（图片节点宽 320 + 间距） */
const COLUMN_STRIDE = 400;
/** 行步进（图片节点高 320 + 间距） */
const ROW_STRIDE = 400;

export interface StoryboardLandingReport {
  shotCount: number;
  imageNodeCount: number;
  videoNodeCount: number;
  /** 展开引用了但无法自动接线的参考（如实报告，不静默丢） */
  unattachedReferences: Array<{ assetId: string; reason: 'first-frame-taken' | 'too-many' }>;
  /** 各镜 warnings 汇总（带镜号前缀） */
  warnings: string[];
}

export interface StoryboardLanding {
  nodes: CanvasDocNode[];
  edges: CanvasDocEdge[];
  report: StoryboardLandingReport;
}

/** 收集当前画布可作为分镜参考的素材：上传/资产库来源的图片节点产物（≤20，最多给清单的量） */
export function collectLandingReferences(doc: CanvasDoc): StoryboardReference[] {
  const references: StoryboardReference[] = [];
  for (const node of doc.nodes) {
    if (node.type !== 'image') continue;
    if (node.data.source !== 'uploaded' && node.data.source !== 'from_asset') continue;
    const output = node.data.batches.find((batch) => batch.status === 'succeeded')?.outputs[0];
    if (output === undefined || output.kind !== 'image') continue;
    references.push({
      assetId: output.assetId,
      kind: 'image',
      ...(node.data.title === undefined ? {} : { label: node.data.title }),
    });
    if (references.length >= 20) break;
  }
  return references;
}

/** 落地区块的起点：现有内容下方一块（空画布 → 原点附近） */
export function storyboardLandingOrigin(doc: CanvasDoc): { x: number; y: number } {
  let maxY = -ROW_STRIDE;
  for (const node of doc.nodes) {
    maxY = Math.max(maxY, node.layout.y + node.layout.height);
  }
  return { x: 0, y: maxY + ROW_STRIDE };
}

/**
 * 构建落地节点与计划边。镜头数必须在 1..STORYBOARD_SESSION_MAX_SHOTS 之间
 * （schema 与服务端都拦过；纯函数再拦一次，防御调用方绕过）。
 */
export function buildStoryboardLanding(
  expansion: StoryboardExpansion,
  origin: { x: number; y: number },
  now: number = Date.now(),
): StoryboardLanding {
  const count = expansion.shots.length;
  if (count === 0 || count > STORYBOARD_SESSION_MAX_SHOTS) {
    throw new Error(
      `分镜镜头数 ${count} 超出会话上限 ${STORYBOARD_SESSION_MAX_SHOTS}（D75）`,
    );
  }

  const nodes: CanvasDocNode[] = [];
  const edges: CanvasDocEdge[] = [];
  const report: StoryboardLandingReport = {
    shotCount: count,
    imageNodeCount: 0,
    videoNodeCount: 0,
    unattachedReferences: [],
    warnings: [],
  };

  expansion.shots.forEach((shot) => {
    const rowY = origin.y + (shot.index - 1) * ROW_STRIDE;
    let imageNodeId: string | null = null;

    if (shot.imagePrompt !== undefined) {
      imageNodeId = `node-story-img-${now}-${shot.index}`;
      const image = createCanvasNode({
        id: imageNodeId,
        type: 'image',
        x: origin.x,
        y: rowY,
        title: `${shot.title} · 首帧`,
        source: 'model_generated',
        createdFrom: 'agent',
        now,
      });
      image.data.draft = {
        kind: 'image',
        prompt: shot.imagePrompt,
        settings: { aspectRatio: shot.aspectRatio },
        references: [],
        updatedAt: now,
      };
      nodes.push(image);
      report.imageNodeCount += 1;
    }

    const videoNodeId = `node-story-vid-${now}-${shot.index}`;
    const video = createCanvasNode({
      id: videoNodeId,
      type: 'video',
      x: origin.x + COLUMN_STRIDE,
      y: rowY,
      title: shot.title,
      source: 'model_generated',
      createdFrom: 'agent',
      now,
    });

    const references: CanvasReference[] = [];
    shot.referenceAssetIds.forEach((assetId, position) => {
      // 首帧图节点占了首帧位（运行时由计划边供给）；用户参考图不再自动接线
      if (imageNodeId !== null) {
        report.unattachedReferences.push({ assetId, reason: 'first-frame-taken' });
        return;
      }
      if (position === 0) {
        references.push({ assetId, role: 'first-frame', order: 0 });
      } else if (position === 1) {
        references.push({ assetId, role: 'last-frame', order: 0 });
      } else {
        report.unattachedReferences.push({ assetId, reason: 'too-many' });
      }
    });

    video.data.draft = {
      kind: 'video',
      prompt: shot.videoPrompt,
      settings: { aspectRatio: shot.aspectRatio, durationSec: shot.durationSec },
      references,
      updatedAt: now,
    };
    nodes.push(video);
    report.videoNodeCount += 1;

    if (imageNodeId !== null) {
      edges.push({
        id: `edge-story-${now}-${shot.index}`,
        from: imageNodeId,
        to: videoNodeId,
        kind: 'dependency',
      });
    }

    for (const warning of shot.warnings) {
      report.warnings.push(`镜头 ${shot.index}：${warning}`);
    }
  });

  return { nodes, edges, report };
}

/** 把构建结果追加进文档（不覆盖已有节点；与 appendAgentCanvasPlan 同一形态）。 */
export function appendStoryboardLanding(
  doc: CanvasDoc,
  landing: StoryboardLanding,
  now: number = Date.now(),
): CanvasDoc {
  return {
    ...doc,
    nodes: [...doc.nodes, ...landing.nodes],
    edges: [...doc.edges, ...landing.edges],
    updatedAt: now,
  };
}

/**
 * S8-D：分镜展开 → 创作会话输入（纯转换）。
 * 镜头带 imagePrompt → 拆两步（图片首帧 + 依赖它的视频）；无 → 单视频步。
 * 幂等性靠步骤 id 的确定性（img-<index> / shot-<index>），同一份展开重复提交得到同一张图。
 */
export function buildCreationRunInput(
  expansion: StoryboardExpansion,
  options: {
    title: string;
    mode: CreationRunMode;
    provider: string;
    projectId?: string;
    /** S9：分镜表镜头序的 transition 原文（index → 文案）；落到对应视频步骤上供自动拼接映射 */
    transitions?: ReadonlyMap<number, string | undefined>;
  },
): CreationRunInput {
  const steps: CreationRunInputStep[] = [];
  // S9-A1：首镜图步是"定妆镜"，后续图步都依赖它（跨镜一致性：以第一张定妆图为准继续出图）。
  // 刻意不做链式（img-3 依赖 img-2）——每多一跳参考就多一层漂移，定妆语义要的是"都像第一张"。
  let anchorImageId: string | null = null;
  for (const shot of expansion.shots) {
    const transition = options.transitions?.get(shot.index);
    if (shot.imagePrompt !== undefined) {
      const imageId = `img-${shot.index}`;
      steps.push({
        id: imageId,
        kind: 'image',
        prompt: shot.imagePrompt,
        aspectRatio: shot.aspectRatio,
        resolutionTier: shot.resolutionTier,
        referenceAssetIds: [],
        dependsOn: anchorImageId === null ? [] : [anchorImageId],
      });
      if (anchorImageId === null) anchorImageId = imageId;
      steps.push({
        id: `shot-${shot.index}`,
        kind: 'video',
        prompt: shot.videoPrompt,
        aspectRatio: shot.aspectRatio,
        resolutionTier: shot.resolutionTier,
        ...(shot.durationSec === undefined ? {} : { durationSec: shot.durationSec }),
        ...(transition === undefined || transition === '' ? {} : { transition }),
        referenceAssetIds: shot.referenceAssetIds,
        dependsOn: [imageId],
      });
    } else {
      steps.push({
        id: `shot-${shot.index}`,
        kind: 'video',
        prompt: shot.videoPrompt,
        aspectRatio: shot.aspectRatio,
        resolutionTier: shot.resolutionTier,
        ...(shot.durationSec === undefined ? {} : { durationSec: shot.durationSec }),
        ...(transition === undefined || transition === '' ? {} : { transition }),
        referenceAssetIds: shot.referenceAssetIds,
        dependsOn: [],
      });
    }
  }
  return {
    title: options.title,
    mode: options.mode,
    provider: options.provider,
    ...(options.projectId === undefined || options.projectId === ''
      ? {}
      : { projectId: options.projectId }),
    steps,
  };
}
