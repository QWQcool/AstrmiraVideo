import { describe, expect, it } from 'vitest';
import {
  createCanvasNode,
  type CanvasDocNode,
  type CanvasReference,
  type Subject,
} from '@astrmira/shared';
import {
  attachSubjectToReferences,
  subjectIdsInReferences,
  subjectName,
} from './subjects';
import { buildCanvasGenerateRequest } from './canvasNodeSubmit';

/**
 * 主体库的前端一层（CONTRACT §21-18 / V2.86）。
 *
 * 钉的是"加进节点"的三条边界：没有素材不加、重复只补标签、槽位满了如实拒绝；
 * 以及提交映射真的把 `subjectId` 带进请求体（服务端 zod 会剥未知键，漏了就是静默丢）。
 */

function subject(assetIds: string[], id = 's1', name = '斯坦茜'): Subject {
  return { id, name, assetIds, createdAt: 1 };
}

/** V2.99：带定妆图（锚点）的主体 */
function anchored(assetIds: string[], anchorAssetId: string): Subject {
  return {
    id: 's1',
    name: '斯坦茜',
    assetIds,
    anchorAssetId,
    anchorSource: 'generated',
    anchorTaskId: 't-anchor',
    anchorUpdatedAt: 2,
    createdAt: 1,
  };
}

function node(type: 'image' | 'video', mode?: 'omni-reference'): CanvasDocNode {
  const created = createCanvasNode({ id: 'n1', type, x: 0, y: 0, now: 1 });
  if (mode !== undefined) created.data.draft.settings.referenceMode = mode;
  return created;
}

const ref = (
  assetId: string,
  role: CanvasReference['role'],
  order = 0,
  subjectId?: string,
): CanvasReference => ({
  assetId,
  role,
  order,
  ...(subjectId === undefined ? {} : { subjectId }),
});

describe('主体 → 节点参考', () => {
  it('图片节点（全能参考）：新增一条 reference-image 并带 subjectId', () => {
    const result = attachSubjectToReferences(
      [],
      subject(['a1', 'a2']),
      'image',
      'omni-reference',
    );
    expect(result.added).toBe(true);
    expect(result.references).toEqual([
      { assetId: 'a1', role: 'reference-image', order: 0, subjectId: 's1' },
    ]);
  });

  it('视频节点：按既有槽位规则落成首帧，并带 subjectId', () => {
    const result = attachSubjectToReferences([], subject(['a1']), 'video');
    expect(result.added).toBe(true);
    expect(result.references[0]).toMatchObject({
      assetId: 'a1',
      role: 'first-frame',
      subjectId: 's1',
    });
  });

  it('有一个定妆图时**用锚点**，不用原始照片（V2.99 / N9）', () => {
    const result = attachSubjectToReferences(
      [],
      anchored(['a1', 'a2'], 'task:t-anchor'),
      'image',
      'omni-reference',
    );
    expect(result.added).toBe(true);
    expect(result.used).toBe('anchor');
    expect(result.references[0]).toMatchObject({ assetId: 'task:t-anchor', subjectId: 's1' });
  });

  it('锚点已失效（产物被清理）→ 回落第一张，不能拿死引用去提交（V2.100）', () => {
    const dead = { ...anchored(['a1', 'a2'], 'task:gone'), anchorAvailable: false };
    const result = attachSubjectToReferences([], dead, 'image', 'omni-reference');
    expect(result.used).toBe('fallback');
    expect(result.references[0]).toMatchObject({ assetId: 'a1', subjectId: 's1' });
  });

  it('没有定妆图时回落第一张，并如实标 fallback（界面据此提示"未出定妆图"）', () => {
    const result = attachSubjectToReferences(
      [],
      subject(['a1', 'a2']),
      'image',
      'omni-reference',
    );
    expect(result.used).toBe('fallback');
    expect(result.references[0]).toMatchObject({ assetId: 'a1' });
  });

  it('同一个素材已在节点里：只补 subjectId，不新增第二条', () => {
    const existing = [ref('a1', 'first-frame')];
    const result = attachSubjectToReferences(existing, subject(['a1']), 'video');
    expect(result.added).toBe(false);
    expect(result.linked).toBe(true);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.subjectId).toBe('s1');
  });

  it('主体没有素材：不加，并给出可执行原因', () => {
    const result = attachSubjectToReferences([], subject([]), 'video');
    expect(result.added).toBe(false);
    expect(result.reason).toBe('no-asset');
    expect(result.references).toEqual([]);
  });

  it('图片节点没切到全能参考：如实拒绝（不静默塞进首帧）', () => {
    const result = attachSubjectToReferences([], subject(['a1']), 'image');
    expect(result.added).toBe(false);
    expect(result.reason).toBe('unsupported');
  });

  it('视频节点的首/尾帧都占满：如实拒绝，不动已有参考', () => {
    const existing = [ref('a1', 'first-frame'), ref('a2', 'last-frame')];
    const result = attachSubjectToReferences(existing, subject(['a3']), 'video');
    expect(result.added).toBe(false);
    expect(result.reason).toBe('unsupported');
    expect(result.references).toEqual(existing);
  });
});

describe('主体溯源标签', () => {
  it('列出参考里出现过的 subjectId（去重）', () => {
    expect(
      subjectIdsInReferences([
        ref('a1', 'reference-image', 0, 's1'),
        ref('a2', 'reference-image', 1, 's1'),
        ref('a3', 'reference-image', 2, 's2'),
        ref('a4', 'reference-image', 3),
      ]),
    ).toEqual(['s1', 's2']);
  });

  it('库里没有的主体返回 null（界面显示「未知主体」，不静默当成不存在）', () => {
    expect(subjectName([subject([])], 's1')).toBe('斯坦茜');
    expect(subjectName([subject([])], 'gone')).toBeNull();
  });
});

describe('提交映射带 subjectId', () => {
  it('全能参考的请求体里每条 reference 保留 subjectId', () => {
    const image = node('image', 'omni-reference');
    image.data.draft.prompt = '院子里的{{image:0}}';
    image.data.draft.references = [
      ref('a1', 'reference-image', 0, 's1'),
      ref('a2', 'reference-image', 1),
    ];

    const request = buildCanvasGenerateRequest({
      node: image,
      provider: 'host-comfyui',
      projectId: 'proj',
      canvasProjectId: 'canvas',
    });

    expect(request.assets?.references).toEqual([
      { assetId: 'a1', role: 'reference-image', order: 0, subjectId: 's1' },
      { assetId: 'a2', role: 'reference-image', order: 1 },
    ]);
  });
});
