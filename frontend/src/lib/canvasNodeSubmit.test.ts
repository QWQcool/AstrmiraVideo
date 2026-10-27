import { describe, expect, it } from 'vitest';
import {
  createCanvasNode,
  createEmptyCanvasDoc,
  type CanvasDocNode,
  type CanvasReference,
  type ProviderStatus,
} from '@astrmira/shared';
import {
  buildCanvasGenerateRequest,
  canvasAspectRatio,
  canvasDefaultProvider,
  canvasDraftMode,
  canvasDurationSec,
  canvasResolution,
  canvasResolutionTier,
  canvasSubmitIssue,
  estimateCanvasNodeCost,
  stripCanvasMentions,
  swapFirstLastReferences,
} from './canvasNodeSubmit';

const CLOUD = { cloud: false, comfy: true } as const;

function status(input: { cloud: boolean; comfy: boolean }): ProviderStatus {
  return {
    cloud: {
      available: input.cloud,
      provider: 'volcano-seedance',
      acceptsClientKey: true,
    },
    local: { available: false, provider: 'minimax-h3' },
    comfyui: {
      available: input.comfy,
      provider: 'comfyui',
      servers: [
        { id: 'host-comfyui', label: '默认引擎', available: input.comfy },
      ],
    },
    httpServices: { available: false, provider: 'http-service', servers: [] },
    llm: { available: false, provider: 'openai-compatible', acceptsClientKey: true },
    defaultProvider: 'cloud-volcano-seedance',
  };
}

function node(type: 'text' | 'image' | 'video', references: CanvasReference[] = []): CanvasDocNode {
  const created = createCanvasNode({ id: 'n1', type, x: 0, y: 0, now: 1 });
  created.data.draft.references = references;
  return created;
}

const ref = (assetId: string, role: CanvasReference['role'], order = 0): CanvasReference => ({
  assetId,
  role,
  order,
});

describe('参考用途 → 生成模式（B3）', () => {
  it('没有参考 → t2v；一张首帧 → i2v；首 + 尾 → fl2v；参考视频 → v2v', () => {
    expect(canvasDraftMode(node('video')).mode).toBe('t2v');
    expect(canvasDraftMode(node('video', [ref('a1', 'first-frame')]))).toMatchObject({
      mode: 'i2v',
      assets: { firstFrameImage: 'a1' },
    });
    expect(
      canvasDraftMode(node('video', [ref('a1', 'first-frame'), ref('a2', 'last-frame')])),
    ).toMatchObject({ mode: 'fl2v', assets: { firstFrameImage: 'a1', lastFrameImage: 'a2' } });
    expect(canvasDraftMode(node('video', [ref('task:t1', 'reference-video')]))).toMatchObject({
      mode: 'v2v',
      assets: { referenceVideo: 'task:t1' },
    });
  });

  it('图片节点固定 t2i；给了参考就如实报"不会被发送"（不静默丢素材）', () => {
    expect(canvasDraftMode(node('image'))).toEqual({ mode: 't2i', unsupportedRoles: [] });
    expect(canvasDraftMode(node('image', [ref('a1', 'first-frame')]))).toMatchObject({
      mode: 't2i',
      unsupportedRoles: ['first-frame'],
    });
  });

  it('没有通道的用途一定报出来：多图参考 / 音频参考 / 只有尾帧 / v2v 还带首帧', () => {
    expect(canvasDraftMode(node('video', [ref('a1', 'reference-image')])).unsupportedRoles).toEqual([
      'reference-image',
    ]);
    expect(canvasDraftMode(node('video', [ref('a1', 'reference-audio')])).unsupportedRoles).toEqual([
      'reference-audio',
    ]);
    expect(canvasDraftMode(node('video', [ref('a1', 'last-frame')]))).toMatchObject({
      mode: 't2v',
      unsupportedRoles: ['last-frame'],
    });
    expect(
      canvasDraftMode(node('video', [ref('v1', 'reference-video'), ref('a1', 'first-frame')])),
    ).toMatchObject({ mode: 'v2v', unsupportedRoles: ['first-frame'] });
  });

  it('同一用途多份：只有排序第一份被发送，其余报出来', () => {
    const modes = canvasDraftMode(
      node('video', [ref('a1', 'first-frame', 0), ref('a2', 'first-frame', 1)]),
    );
    expect(modes.assets).toEqual({ firstFrameImage: 'a1' });
    expect(modes.unsupportedRoles).toEqual(['first-frame']);
  });
});

describe('默认引擎：当前可用且最便宜（B3）', () => {
  it('视频：云端有 Key/兜底 → 云端；否则退到已配置的本地 ComfyUI', () => {
    const video = node('video');
    expect(
      canvasDefaultProvider(video, { providerStatus: status({ cloud: false, comfy: true }), hasCloudKey: true }),
    ).toBe('cloud-volcano-seedance');
    expect(
      canvasDefaultProvider(video, { providerStatus: status({ cloud: false, comfy: true }), hasCloudKey: false }),
    ).toBe('host-comfyui');
    expect(
      canvasDefaultProvider(video, { providerStatus: status({ cloud: true, comfy: false }), hasCloudKey: false }),
    ).toBe('cloud-volcano-seedance');
  });

  it('图片：只能用本地 ComfyUI；共存的选择不被覆盖', () => {
    expect(
      canvasDefaultProvider(node('image'), { providerStatus: status(CLOUD), hasCloudKey: true }),
    ).toBe('host-comfyui');
    const stored = node('image');
    stored.data.draft.settings.provider = 'host-comfyui:studio';
    expect(
      canvasDefaultProvider(stored, { providerStatus: status(CLOUD), hasCloudKey: true }),
    ).toBe('host-comfyui:studio');
  });
});

describe('提交前判定：先报最有用的问题（B3）', () => {
  const ready = { providerStatus: status({ cloud: true, comfy: true }), hasCloudKey: true };

  it('空提示词 / 文本节点 / 在跑任务', () => {
    expect(canvasSubmitIssue(node('video'), 'cloud-volcano-seedance', ready)).toBe('empty-prompt');
    const text = node('text');
    text.data.draft.prompt = '写点什么';
    expect(canvasSubmitIssue(text, 'cloud-volcano-seedance', ready)).toBe('text-node');

    const busy = node('video');
    busy.data.draft.prompt = '镜头';
    busy.data.batches = [
      { id: 'b1', taskId: 't1', createdAt: 1, status: 'running', outputs: [] },
    ];
    expect(canvasSubmitIssue(busy, 'cloud-volcano-seedance', ready)).toBe('active-task');
  });

  it('参考没有通道 → 阻止提交（不静默丢素材）', () => {
    const bad = node('video', [ref('a1', 'reference-image')]);
    bad.data.draft.prompt = '镜头';
    expect(canvasSubmitIssue(bad, 'cloud-volcano-seedance', ready)).toBe('reference-unsupported');
  });

  it('图片节点选了云端 → 拒绝并说明只能走本地；本地未配置 → 不可用', () => {
    const image = node('image');
    image.data.draft.prompt = '一只猫';
    expect(canvasSubmitIssue(image, 'cloud-volcano-seedance', ready)).toBe('image-needs-local');
    expect(
      canvasSubmitIssue(image, 'host-comfyui', {
        providerStatus: status({ cloud: true, comfy: false }),
        hasCloudKey: true,
      }),
    ).toBe('image-unavailable');
    expect(canvasSubmitIssue(image, 'host-comfyui', ready)).toBeNull();
  });

  it('V2.51：自检声明不支持当前模式 → mode-unsupported（未自检不据此禁用）', () => {
    const image = node('image');
    image.data.draft.prompt = '一只猫';
    const video = node('video');
    video.data.draft.prompt = '镜头';

    const imageOnly = status({ cloud: true, comfy: true });
    imageOnly.comfyui.servers[0]!.modes = ['t2i'];
    expect(canvasSubmitIssue(image, 'host-comfyui', { providerStatus: imageOnly, hasCloudKey: true })).toBeNull();
    expect(canvasSubmitIssue(video, 'host-comfyui', { providerStatus: imageOnly, hasCloudKey: true })).toBe(
      'mode-unsupported',
    );

    const videoOnly = status({ cloud: true, comfy: true });
    videoOnly.comfyui.servers[0]!.modes = ['t2v'];
    expect(canvasSubmitIssue(image, 'host-comfyui', { providerStatus: videoOnly, hasCloudKey: true })).toBe(
      'mode-unsupported',
    );
  });

  it('云端没有 Key 也不能提交；本地实例不可用同样拦下', () => {
    const video = node('video');
    video.data.draft.prompt = '镜头';
    expect(
      canvasSubmitIssue(video, 'cloud-volcano-seedance', {
        providerStatus: status({ cloud: false, comfy: true }),
        hasCloudKey: false,
      }),
    ).toBe('cloud-key-missing');
    expect(
      canvasSubmitIssue(video, 'host-comfyui', {
        providerStatus: status({ cloud: true, comfy: false }),
        hasCloudKey: true,
      }),
    ).toBe('provider-unavailable');
    expect(canvasSubmitIssue(video, 'fixture-local', ready)).toBe('provider-unavailable');
  });
});

describe('请求组装与估算（B3）', () => {
  it('带 origin=canvas + canvasProjectId；资产项目与画布项目分开', () => {
    const video = node('video', [ref('a1', 'first-frame')]);
    video.data.draft.prompt = '  雨夜街头  ';
    video.data.draft.settings = { durationSec: 8, aspectRatio: '9:16' };
    const request = buildCanvasGenerateRequest({
      node: video,
      provider: 'host-comfyui',
      projectId: 'assets-project',
      canvasProjectId: 'canvas-project',
      baseUrl: 'https://example.test',
      model: 'm1',
    });
    expect(request).toMatchObject({
      prompt: '雨夜街头',
      mode: 'i2v',
      assets: { firstFrameImage: 'a1' },
      provider: 'host-comfyui',
      projectId: 'assets-project',
      origin: 'canvas',
      canvasProjectId: 'canvas-project',
      aspectRatio: '9:16',
      params: { durationSec: 8 },
    });
    expect(request.resolution).toEqual({ width: 480, height: 832 });
  });

  it('图片请求不带 params.durationSec（t2i 没有时长）', () => {
    const image = node('image');
    image.data.draft.prompt = '一只猫';
    const request = buildCanvasGenerateRequest({
      node: image,
      provider: 'host-comfyui',
      projectId: 'p',
      canvasProjectId: 'c',
    });
    expect(request.mode).toBe('t2i');
    expect(request.params).toBeUndefined();
    expect(request.aspectRatio).toBe('1:1');
    // V2.50：图片用 1024 系，不沿用视频 480p
    expect(request.resolution).toEqual({ width: 1024, height: 1024 });
  });

  it('画幅 / 清晰度 / 时长的默认与回读', () => {
    const video = node('video');
    expect(canvasAspectRatio(video)).toBe('16:9');
    expect(canvasResolutionTier(video)).toBe('480p');
    expect(canvasResolution(video)).toEqual({ width: 832, height: 480 });
    expect(canvasDurationSec(video)).toBe(5);

    video.data.draft.settings = {
      aspectRatio: '16:9',
      resolution: { width: 1280, height: 704 },
      durationSec: 10,
    };
    expect(canvasResolutionTier(video)).toBe('720p');
    expect(canvasResolution(video)).toEqual({ width: 1280, height: 704 });
    expect(canvasDurationSec(video)).toBe(10);
  });

  it('本地轨估算为 0 元（不是"待核算"）；云端有报价', () => {
    const video = node('video');
    video.data.draft.prompt = 'x';
    expect(estimateCanvasNodeCost(video, 'host-comfyui', undefined)?.yuan).toBe(0);
    const cloud = estimateCanvasNodeCost(video, 'cloud-volcano-seedance', 'doubao-seedance-2-0-mini-260615');
    expect(cloud?.yuan).toBeGreaterThan(0);
  });
});

describe('S5-B1b · 节点首尾交换', () => {
  it('交换 first-frame / last-frame 的 role 与 order，其它引用不动', () => {
    const video: CanvasReference = {
      assetId: 'video-1',
      role: 'reference-video',
      order: 0,
    };
    const first: CanvasReference = { assetId: 'img-a', role: 'first-frame', order: 1 };
    const last: CanvasReference = { assetId: 'img-b', role: 'last-frame', order: 2 };
    const withVideo = swapFirstLastReferences([video, first, last]);
    expect(withVideo[0]).toEqual(video);
    expect(withVideo.slice(1)).toEqual([
      { assetId: 'img-b', role: 'first-frame', order: 1 },
      { assetId: 'img-a', role: 'last-frame', order: 2 },
    ]);
    // 请求按 role 取图：交换后首帧确实是原来的尾帧
    const swapped = swapFirstLastReferences([first, last]);
    const node = createCanvasNode({ id: 'n', type: 'video', x: 0, y: 0 });
    node.data.draft.references = swapped;
    expect(canvasDraftMode(node).assets).toEqual({
      firstFrameImage: 'img-b',
      lastFrameImage: 'img-a',
    });
  });

  it('缺任一端时原样返回（不制造半套首尾）', () => {
    const first: CanvasReference = { assetId: 'img-a', role: 'first-frame', order: 0 };
    expect(swapFirstLastReferences([first])).toEqual([first]);
  });
});

// 让"空文档"的工厂也被用到（避免只测节点、不测文档级不变式）
describe('文档不变式（B3）', () => {
  it('空文档不做任何隐式初始化', () => {
    const doc = createEmptyCanvasDoc('p', 'n', 1);
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });
});

describe('图片节点派生编辑请求（S9-A3 / V2.69）', () => {
  it('image 节点带单张 reference-image → t2i + assets.firstFrameImage；其它角色仍 unsupported', () => {
    const node = createCanvasNode({ id: 'img', type: 'image', x: 0, y: 0, now: 1 });
    node.data.draft.references = [
      { assetId: 'task:src-1', role: 'reference-image', order: 0 },
      { assetId: 'task:x', role: 'first-frame', order: 0 },
    ];
    const mode = canvasDraftMode(node);
    expect(mode.mode).toBe('t2i');
    expect(mode.assets).toEqual({ firstFrameImage: 'task:src-1' });
    expect(mode.unsupportedRoles).toEqual(['first-frame']);
  });

  it('image 节点无参考 → 纯 t2i 无 assets（原行为）', () => {
    const node = createCanvasNode({ id: 'img2', type: 'image', x: 0, y: 0, now: 1 });
    const mode = canvasDraftMode(node);
    expect(mode.mode).toBe('t2i');
    expect(mode.assets).toBeUndefined();
    expect(mode.unsupportedRoles).toEqual([]);
  });
});

describe('B 路线：全能参考的提交映射（V2.76）', () => {
  const omniImage = (references: Array<{ assetId: string; order: number }>) => {
    const node = createCanvasNode({ id: 'img', type: 'image', x: 0, y: 0, now: 1 });
    node.data.draft.settings.referenceMode = 'omni-reference';
    node.data.draft.references = references.map((item) => ({
      assetId: item.assetId,
      role: 'reference-image' as const,
      order: item.order,
    }));
    return node;
  };

  it('N 张按 order 排序并**重新编号**成 0..n-1（删过中间那张也不会留空洞）', () => {
    const node = omniImage([
      { assetId: 'task:c', order: 5 },
      { assetId: 'task:a', order: 2 },
      { assetId: 'task:b', order: 9 },
    ]);
    expect(canvasDraftMode(node).assets).toEqual({
      references: [
        { assetId: 'task:a', role: 'reference-image', order: 0 },
        { assetId: 'task:c', role: 'reference-image', order: 1 },
        { assetId: 'task:b', role: 'reference-image', order: 2 },
      ],
    });
  });

  it('全能参考里混进首帧 → 仍然按"用途没通道"拒绝（不静默丢）', () => {
    const node = omniImage([{ assetId: 'task:a', order: 0 }]);
    node.data.draft.references.push({ assetId: 'task:f', role: 'first-frame', order: 1 });
    const mode = canvasDraftMode(node);
    expect(mode.unsupportedRoles).toEqual(['first-frame']);
  });

  it('视频节点声明全能参考也没有通道（本地视频轨要多参考工作流）', () => {
    const node = createCanvasNode({ id: 'v', type: 'video', x: 0, y: 0, now: 1 });
    node.data.draft.settings.referenceMode = 'omni-reference';
    node.data.draft.references = [
      { assetId: 'task:a', role: 'reference-image', order: 0 },
      { assetId: 'task:b', role: 'reference-image', order: 1 },
    ];
    const mode = canvasDraftMode(node);
    expect(mode.unsupportedRoles).toEqual(['reference-image']);
  });

  it('提示词里 {{image:N}} 越界 → 问题码 mention-out-of-range（不静默改文案）', () => {
    const node = omniImage([{ assetId: 'task:a', order: 0 }]);
    node.data.draft.prompt = '把 {{image:0}} 放进 {{image:3}}';
    expect(
      canvasSubmitIssue(node, 'host-comfyui', {
        providerStatus: null,
        hasCloudKey: false,
      }),
    ).toBe('mention-out-of-range');
  });

  it('发上游前剥掉 `{{image:N}}`，但草稿里的原文不动', () => {
    expect(stripCanvasMentions('把 {{image:0}} 的人物放进 {{image:1}} 的场景')).toBe(
      '把 的人物放进 的场景',
    );
    expect(stripCanvasMentions('纯净提示词，没有占位符')).toBe('纯净提示词，没有占位符');
  });

  it('提及在范围内则不拦（继续走后面的引擎判定）', () => {
    const node = omniImage([{ assetId: 'task:a', order: 0 }]);
    node.data.draft.prompt = '把 {{image:0}} 放进画面';
    expect(
      canvasSubmitIssue(node, 'host-comfyui', {
        providerStatus: null,
        hasCloudKey: false,
      }),
    ).not.toBe('mention-out-of-range');
  });
});
