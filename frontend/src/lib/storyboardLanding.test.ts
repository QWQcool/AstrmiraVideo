import { describe, expect, it } from 'vitest';
import {
  STORYBOARD_SESSION_MAX_SHOTS,
  createCanvasNode,
  createEmptyCanvasDoc,
  type CanvasDoc,
  type CanvasDocNode,
  type StoryboardExpansion,
} from '@astrmira/shared';
import {
  appendStoryboardLanding,
  buildStoryboardLanding,
  collectLandingReferences,
  storyboardLandingOrigin,
} from './storyboardLanding';

function shotPlan(index: number, overrides: Record<string, unknown> = {}) {
  return {
    index,
    title: `镜头 ${index}`,
    videoPrompt: `镜头 ${index} 视频提示词`,
    aspectRatio: '16:9' as const,
    resolutionTier: '720p' as const,
    durationSec: 5,
    referenceAssetIds: [],
    warnings: [],
    ...overrides,
  };
}

function expansion(shots: Array<Record<string, unknown>>): StoryboardExpansion {
  return { version: 1, shots: shots.map((s, i) => shotPlan(i + 1, s)) };
}

function makeDoc(...nodes: CanvasDocNode[]): CanvasDoc {
  const doc = createEmptyCanvasDoc('p1', '画布', 1);
  doc.nodes = nodes;
  return doc;
}

/** 上传图片节点：带一个 succeeded 批次产物（模拟「本地上传」的落地形态） */
function uploadedImageNode(id: string, assetId = `asset-${id}`): CanvasDocNode {
  const node = createCanvasNode({ id, type: 'image', x: 0, y: 0, title: `素材${id}`, now: 1 });
  node.data.source = 'uploaded';
  node.data.batches = [
    {
      id: `${id}-b1`,
      taskId: `${id}-t1`,
      createdAt: 1,
      status: 'succeeded',
      outputs: [{ assetId, kind: 'image', url: `/media/assets/${assetId}` }],
    },
  ];
  return node;
}

describe('分镜落地（S8-A2b）', () => {
  it('带首帧图的镜头：图片草稿 + 视频草稿 + dependency 计划边，不写 references', () => {
    const landing = buildStoryboardLanding(
      expansion([{ imagePrompt: '雨夜街头定妆图', referenceAssetIds: ['asset-x'] }]),
      { x: 0, y: 0 },
      1000,
    );
    expect(landing.nodes).toHaveLength(2);
    const [image, video] = landing.nodes;
    expect(image?.type).toBe('image');
    expect(image?.data.draft.prompt).toBe('雨夜街头定妆图');
    expect(image?.data.draft.settings.aspectRatio).toBe('16:9');
    expect(image?.meta?.createdFrom).toBe('agent');
    expect(video?.type).toBe('video');
    expect(video?.data.draft.settings.durationSec).toBe(5);
    expect(video?.data.draft.references).toEqual([]); // 首帧位给了计划边，用户参考不自动接线
    expect(landing.edges).toEqual([
      { id: 'edge-story-1000-1', from: image?.id, to: video?.id, kind: 'dependency' },
    ]);
    expect(landing.report).toMatchObject({
      shotCount: 1,
      imageNodeCount: 1,
      videoNodeCount: 1,
      unattachedReferences: [{ assetId: 'asset-x', reason: 'first-frame-taken' }],
    });
  });

  it('无首帧图的镜头：参考图前两张自动接首帧/尾帧，第三张如实报告不静默丢', () => {
    const landing = buildStoryboardLanding(
      expansion([
        { referenceAssetIds: ['asset-a', 'asset-b', 'asset-c'] },
      ]),
      { x: 0, y: 0 },
      1000,
    );
    expect(landing.nodes).toHaveLength(1); // 只有视频节点
    const video = landing.nodes[0]!;
    expect(video.data.draft.references).toEqual([
      { assetId: 'asset-a', role: 'first-frame', order: 0 },
      { assetId: 'asset-b', role: 'last-frame', order: 0 },
    ]);
    expect(landing.report.unattachedReferences).toEqual([
      { assetId: 'asset-c', reason: 'too-many' },
    ]);
    expect(landing.edges).toEqual([]);
  });

  it('多镜头网格布局：按 index 分行，视频列在图片列右侧；warnings 汇总带镜号', () => {
    const landing = buildStoryboardLanding(
      expansion([
        { imagePrompt: '首帧 1' },
        {},
        { warnings: ['角色一致性未确认'] },
      ]),
      { x: 100, y: 200 },
      1000,
    );
    expect(landing.nodes).toHaveLength(4); // 1 图片（仅镜头 1 有 imagePrompt）+ 3 视频
    const video3 = landing.nodes.find((node) => node.data.draft.prompt === '镜头 3 视频提示词');
    expect(video3?.layout.y).toBe(200 + 2 * 400);
    expect(video3?.layout.x).toBe(100 + 400);
    expect(landing.report.warnings).toEqual(['镜头 3：角色一致性未确认']);
    expect(landing.report.imageNodeCount).toBe(1);
    expect(landing.report.videoNodeCount).toBe(3);
  });

  it('镜头数越界（0 或 >16）直接抛错（D75 防御）', () => {
    expect(() => buildStoryboardLanding({ version: 1, shots: [] }, { x: 0, y: 0 })).toThrow();
    const tooMany = Array.from({ length: STORYBOARD_SESSION_MAX_SHOTS + 1 }, (_u, i) =>
      shotPlan(i + 1),
    );
    expect(() =>
      buildStoryboardLanding({ version: 1, shots: tooMany }, { x: 0, y: 0 }),
    ).toThrow('16');
  });

  it('appendStoryboardLanding 追加不覆盖；origin 在现有内容下方', () => {
    const doc = makeDoc(uploadedImageNode('u1'));
    doc.nodes[0]!.layout = { ...doc.nodes[0]!.layout, y: 1000 };
    const origin = storyboardLandingOrigin(doc);
    expect(origin.y).toBeGreaterThan(1320);

    const landing = buildStoryboardLanding(expansion([{}]), origin, 1000);
    const next = appendStoryboardLanding(doc, landing, 2000);
    expect(next.nodes).toHaveLength(2); // 原上传节点 + 1 视频草稿
    expect(next.edges).toHaveLength(0);
    expect(next.updatedAt).toBe(2000);
    expect(doc.nodes).toHaveLength(1); // 原文档不被改动（纯函数）
  });
});

describe('collectLandingReferences · 参考候选只认上传/资产库图片', () => {
  it('uploaded/from_asset 图片产物入选；模型生成节点、视频节点、无产物节点排除', () => {
    const generated = createCanvasNode({ id: 'g', type: 'image', x: 0, y: 0, now: 1 });
    generated.data.source = 'model_generated';
    generated.data.batches = [
      {
        id: 'g-b1',
        taskId: 'g-t1',
        createdAt: 1,
        status: 'succeeded',
        outputs: [{ assetId: 'task:g-t1', kind: 'image', url: '/media/g' }],
      },
    ];
    const video = createCanvasNode({ id: 'v', type: 'video', x: 0, y: 0, now: 1 });
    video.data.source = 'uploaded';
    video.data.batches = [
      {
        id: 'v-b1',
        taskId: 'v-t1',
        createdAt: 1,
        status: 'succeeded',
        outputs: [{ assetId: 'asset-v', kind: 'video', url: '/media/v' }],
      },
    ];
    const fromAsset = uploadedImageNode('fa');
    fromAsset.data.source = 'from_asset';

    const refs = collectLandingReferences(makeDoc(uploadedImageNode('u1'), generated, video, fromAsset));
    expect(refs.map((ref) => ref.assetId)).toEqual(['asset-u1', 'asset-fa']);
    expect(refs[0]).toMatchObject({ kind: 'image', label: '素材u1' });
  });
});
