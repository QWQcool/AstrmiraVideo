import { describe, expect, it } from 'vitest';
import type { AssetListEntry, TaskProgress } from '@astrmira/shared';
import {
  filterReferenceSources,
  referenceSourceLabelKey,
  referenceSourcesFromAssets,
  referenceSourcesFromTasks,
} from './referenceSources';

function asset(overrides: Partial<AssetListEntry> & { assetId: string }): AssetListEntry {
  return {
    kind: 'image',
    mime: 'image/png',
    size: 1,
    url: `/media/assets/${overrides.assetId}.png`,
    createdAt: 1,
    projectId: 'p',
    ...overrides,
  };
}

function task(overrides: Partial<TaskProgress> & { taskId: string }): TaskProgress {
  return {
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: { prompt: '默认提示词', mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' },
    createdAt: 1,
    ...overrides,
  };
}

describe('S5-Ab 引用来源适配', () => {
  it('上传资产标为 upload，保留名称/预览/ref', () => {
    const items = referenceSourcesFromAssets([asset({ assetId: 'a1', name: '灯.png' })]);
    expect(items[0]).toMatchObject({
      ref: 'a1',
      source: 'upload',
      kind: 'image',
      label: '灯.png',
      previewUrl: '/media/assets/a1.png',
    });
  });

  it('任务产物按来源标记 home/canvas；失败或没有画面产物不进入列表', () => {
    const items = referenceSourcesFromTasks(
      [
        task({ taskId: 't1', outputImageUrl: '/media/t1.png' }),
        task({ taskId: 't2', outputVideoUrl: '/media/t2.mp4', thumbnailUrl: '/media/t2.jpg' }),
        task({ taskId: 't3', outputVideoUrl: '/media/t3.mp4' }),
        task({ taskId: 'bad', status: 'failed' }),
      ],
      'canvas',
    );
    expect(items.map((item) => item.ref)).toEqual(['task:t1', 'task:t2', 'task:t3']);
    expect(items.every((item) => item.source === 'canvas')).toBe(true);
    expect(items[1]?.previewUrl).toBe('/media/t2.jpg');
    // 没有封面时不能把 mp4 塞进 <img>：preview 缺省，真实 url 仍保留给画布加节点
    expect(items[2]?.previewUrl).toBeUndefined();
    expect(items[2]?.url).toBe('/media/t3.mp4');
  });

  it('视频/音频上传的真实 url 与 <img> 预览分开', () => {
    const items = referenceSourcesFromAssets([
      asset({ assetId: 'v1', kind: 'video', url: '/media/assets/v1.mp4' }),
      asset({ assetId: 'a1', kind: 'audio', url: '/media/assets/a1.mp3' }),
    ]);
    expect(items[0]?.previewUrl).toBeUndefined();
    expect(items[0]?.url).toBe('/media/assets/v1.mp4');
    expect(items[1]?.previewUrl).toBeUndefined();
    expect(items[1]?.url).toBe('/media/assets/a1.mp3');
  });

  it('搜索覆盖名称/提示词/assetId，并按 kind 过滤', () => {
    const items = [
      ...referenceSourcesFromAssets([
        asset({ assetId: 'a1', name: '海边.png' }),
        asset({ assetId: 'a2', kind: 'video', name: '海边.mp4' }),
      ]),
      ...referenceSourcesFromTasks(
        [task({ taskId: 't1', requestSnapshot: { prompt: '雨夜街头', mode: 't2v', aspectRatio: '16:9', provider: 'x' }, outputImageUrl: '/media/t1.png' })],
        'canvas',
      ),
    ];
    expect(filterReferenceSources(items, '海边').map((item) => item.ref)).toEqual(['a1', 'a2']);
    expect(filterReferenceSources(items, '雨夜').map((item) => item.ref)).toEqual(['task:t1']);
    expect(filterReferenceSources(items, 'a2').map((item) => item.ref)).toEqual(['a2']);
    expect(filterReferenceSources(items, '', ['video']).map((item) => item.ref)).toEqual(['a2']);
  });

  it('来源文案键稳定（上传/首页/画布不混淆）', () => {
    expect(referenceSourceLabelKey('upload')).toBe('create.source.upload');
    expect(referenceSourceLabelKey('home')).toBe('create.source.home');
    expect(referenceSourceLabelKey('canvas')).toBe('create.source.canvas');
  });
});
