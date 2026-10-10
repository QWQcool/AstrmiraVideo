import { describe, expect, it } from 'vitest';
import type { AssetListEntry, TaskProgress } from '@astrmira/shared';
import type { MentionRef } from './mentions';
import {
  assetsForRefs,
  filterAssetCandidates,
  filterTaskCandidates,
  hasPendingRef,
  ignoredMentionHint,
  MENTION_LIST_LIMIT,
  modeForRefs,
  selectMentions,
} from './mentions';

/**
 * `@` 提及纯函数的单测矩阵（V2.7 / B41）。
 *
 * 两个纪律锚点（与三槽路径 `lib/assets.ts` 的既有边界逐例对齐）：
 * - **上传中视为缺失**：`ref === ''` 不能进请求（"空串 = 带了但不存在"）；
 * - **模式由素材决定且"多退少补"必须说出来**：被忽略的素材走 `ignoredMentionHint`，不静默。
 */

let seq = 0;
const image = (ref: string, label?: string): MentionRef => ({
  id: `chip-${(seq += 1)}`,
  ref,
  kind: 'image',
  ...(label === undefined ? {} : { label }),
});
const video = (ref: string): MentionRef => ({ id: `chip-${(seq += 1)}`, ref, kind: 'video' });

describe('selectMentions · 模式判定（素材决定模式）', () => {
  it('空 → t2v，无采用无忽略', () => {
    const selection = selectMentions([]);
    expect(selection).toEqual({ mode: 't2v', used: [], ignored: [] });
    expect(modeForRefs([])).toBe('t2v');
    expect(assetsForRefs([])).toBeUndefined();
  });

  it('1 张图 → i2v（首帧）', () => {
    const selection = selectMentions([image('a-1')]);
    expect(selection.mode).toBe('i2v');
    expect(selection.used).toHaveLength(1);
    expect(selection.ignored).toHaveLength(0);
  });

  it('2 张图 → fl2v，顺序即语义（先=首帧、后=尾帧）', () => {
    const first = image('a-first');
    const last = image('a-last');
    const selection = selectMentions([first, last]);
    expect(selection.mode).toBe('fl2v');
    expect(selection.used).toEqual([first, last]);
  });

  it('3 张图 → fl2v 只用前两张，第 3 张进 ignored（界面必须说明）', () => {
    const selection = selectMentions([image('a-1'), image('a-2'), image('a-3')]);
    expect(selection.mode).toBe('fl2v');
    expect(selection.used.map((item) => item.ref)).toEqual(['a-1', 'a-2']);
    expect(selection.ignored.map((item) => item.ref)).toEqual(['a-3']);
    expect(ignoredMentionHint(selection)).toContain('前两张');
  });

  it('1 个视频 → v2v；`task:` 成片引用原样透传（B37 引用形态）', () => {
    const selection = selectMentions([video('task:abc-123')]);
    expect(selection.mode).toBe('v2v');
    expect(selection.used[0]!.ref).toBe('task:abc-123');
  });

  it('视频优先于图片：视频 + 2 张图 → v2v，两名图片全进 ignored', () => {
    const selection = selectMentions([image('a-1'), video('task:v'), image('a-2')]);
    expect(selection.mode).toBe('v2v');
    expect(selection.used.map((item) => item.ref)).toEqual(['task:v']);
    expect(selection.ignored.map((item) => item.ref)).toEqual(['a-1', 'a-2']);
    expect(ignoredMentionHint(selection)).toContain('第一个视频');
  });

  it('2 个视频 → v2v 只用第一个，第二个进 ignored', () => {
    const selection = selectMentions([video('task:v1'), video('task:v2')]);
    expect(selection.used.map((item) => item.ref)).toEqual(['task:v1']);
    expect(selection.ignored.map((item) => item.ref)).toEqual(['task:v2']);
  });

  it('模式判定包含上传中的 chip（用户选了就按它算模式 —— 能不能提交另说）', () => {
    // 单张"上传中"的图仍算 i2v：模式不该在上传完成的瞬间从 t2v 跳成 i2v（界面会闪）
    expect(modeForRefs([image('')])).toBe('i2v');
    expect(ignoredMentionHint(selectMentions([image('')]))).toBeNull();
  });
});

describe('assetsForRefs · 只发该模式用得到的引用（对齐三槽 assetsForMode）', () => {
  it('i2v → 只发 firstFrameImage', () => {
    expect(assetsForRefs([image('a-1')])).toEqual({ firstFrameImage: 'a-1' });
  });

  it('fl2v → firstFrameImage + lastFrameImage（顺序来自 chips 顺序）', () => {
    expect(assetsForRefs([image('a-first'), image('a-last')])).toEqual({
      firstFrameImage: 'a-first',
      lastFrameImage: 'a-last',
    });
  });

  it('v2v → 只发 referenceVideo（资产 id 或 task: 引用都是同一个字段）', () => {
    expect(assetsForRefs([video('a-video')])).toEqual({ referenceVideo: 'a-video' });
    expect(assetsForRefs([video('task:abc')])).toEqual({ referenceVideo: 'task:abc' });
  });

  it('上传中（ref 为空串）→ undefined —— "空串发上去等于带了但不存在"（同 readyAssetId 纪律）', () => {
    expect(assetsForRefs([image('')])).toBeUndefined();
    expect(assetsForRefs([image('a-ready'), image('')])).toBeUndefined();
    expect(assetsForRefs([video('')])).toBeUndefined();
    expect(hasPendingRef([image('')])).toBe(true);
    expect(hasPendingRef([image('a-ready')])).toBe(false);
  });

  it('t2v → undefined（零素材不回 assets 字段）', () => {
    expect(assetsForRefs([])).toBeUndefined();
  });
});

describe('ignoredMentionHint · "多退少补"必须说出来', () => {
  it('没有忽略时返回 null（不要硬凑提示）', () => {
    expect(ignoredMentionHint(selectMentions([image('a-1')]))).toBeNull();
    expect(ignoredMentionHint(selectMentions([]))).toBeNull();
  });

  it('两条文案分别指向视频/图片场景，且给出可执行动作（删 chip）', () => {
    const v2v = ignoredMentionHint(selectMentions([video('task:v'), image('a-1')]))!;
    expect(v2v).toContain('视频参考');
    expect(v2v).toContain('删除');

    const fl2v = ignoredMentionHint(
      selectMentions([image('a-1'), image('a-2'), image('a-3')]),
    )!;
    expect(fl2v).toContain('首尾帧');
    expect(fl2v).toContain('删除');
  });
});

describe('弹层候选过滤（V2.9 / 台账 B43）', () => {
  const asset = (assetId: string, name?: string): AssetListEntry => ({
    assetId,
    kind: 'image',
    mime: 'image/png',
    size: 1,
    // V2.11（B47）：资产永远有项目归属（缺省 = 默认项目）
    projectId: 'default',
    url: `/media/assets/${assetId}.png`,
    createdAt: 1,
    ...(name === undefined ? {} : { name }),
  });

  const task = (taskId: string, prompt: string): TaskProgress => ({
    taskId,
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: { prompt, mode: 't2v', aspectRatio: '16:9', provider: 'fixture-local' },
    createdAt: 1,
  });

  it('空关键词 → 只给前 limit 条（候选不是全量列表）', () => {
    const many = Array.from({ length: 12 }, (_, index) => asset(`id-${index}`));
    expect(filterAssetCandidates(many, '')).toHaveLength(MENTION_LIST_LIMIT);
    expect(filterAssetCandidates(many, '', 3)).toHaveLength(3);
    expect(filterTaskCandidates([task('t-1', 'p')], '  ')).toHaveLength(1);
  });

  it('按原始文件名匹配（大小写不敏感）——人认名字，不认编号', () => {
    const pool = [
      asset('11111111-1111-4111-8111-111111111111', '海边的日落.png'),
      asset('22222222-2222-4222-8222-222222222222', 'BEACH-wide.png'),
      asset('33333333-3333-4333-8333-333333333333'),
    ];

    expect(filterAssetCandidates(pool, '海边')[0]?.name).toBe('海边的日落.png');
    expect(filterAssetCandidates(pool, 'beach')[0]?.name).toBe('BEACH-wide.png');
    // 搜不到就是空数组（不做模糊兜底 —— 静默给错素材比空更糟）
    expect(filterAssetCandidates(pool, '不存在的名字')).toEqual([]);
  });

  it('V2.9 之前的老资产（没有 name）仍可按 assetId 搜到', () => {
    const legacy = asset('33333333-3333-4333-8333-333333333333');
    expect(filterAssetCandidates([legacy], '33333333')).toHaveLength(1);
  });

  it('成片候选：按提示词或 taskId 匹配', () => {
    const pool = [task('aaaa-bbbb', '雨夜街头'), task('cccc-dddd', '海边')];
    expect(filterTaskCandidates(pool, '雨夜')).toHaveLength(1);
    expect(filterTaskCandidates(pool, 'cccc')[0]?.taskId).toBe('cccc-dddd');
  });
});
