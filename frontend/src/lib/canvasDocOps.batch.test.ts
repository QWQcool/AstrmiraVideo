import { describe, expect, it } from 'vitest';
import {
  createCanvasNode,
  createEmptyCanvasDoc,
  type CanvasDoc,
  type CanvasDocNode,
  type TaskProgress,
} from '@astrmira/shared';
import {
  addCanvasBatch,
  addCanvasNodesFromAssets,
  canvasActiveTaskNodeIds,
  canvasBatchPatchFromTask,
  canvasLostActiveTaskNodes,
  canvasNodeActiveBatches,
  canvasNodeVisibleOutput,
  cloneCanvasNode,
  insertCanvasNodes,
  latestCanvasOutput,
  nextCanvasNodePositions,
  patchCanvasBatch,
  selectCanvasNodeBatch,
  updateCanvasNodeDraft,
} from './canvasDocOps';

const LABELS = { text: '文本', image: '图片', video: '视频', audio: '音频' } as const;

function emptyDoc(now = 1): CanvasDoc {
  return createEmptyCanvasDoc('p1', '画布', now);
}

function nodeOf(id: string, type: 'image' | 'video' = 'video'): CanvasDocNode {
  return createCanvasNode({ id, type, x: 0, y: 0, title: `${id} 标题`, now: 10 });
}

function docWith(node: CanvasDocNode, now = 20): CanvasDoc {
  const doc = emptyDoc(now);
  doc.nodes = [node];
  return doc;
}

/** 只关心批次与产物字段；其余按契约补全 */
function task(
  taskId: string,
  status: TaskProgress['status'],
  extra: Partial<TaskProgress> = {},
): TaskProgress {
  return {
    taskId,
    status,
    progressPercent: 0,
    createdAt: 1,
    requestSnapshot: {
      prompt: 'p',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'host-comfyui',
    },
    ...extra,
  };
}

describe('草稿修改（B3）', () => {
  it('改提示词：写回草稿并更新 updatedAt；原文档不变', () => {
    const doc = docWith(nodeOf('n1'));
    const next = updateCanvasNodeDraft(doc, 'n1', { prompt: '雨夜街头' }, 99);
    expect(next.nodes[0]!.data.draft.prompt).toBe('雨夜街头');
    expect(next.nodes[0]!.data.draft.updatedAt).toBe(99);
    expect(doc.nodes[0]!.data.draft.prompt).toBe('');
    expect(next.updatedAt).toBe(99);
  });

  it('改参数是浅合并：没碰的字段保留', () => {
    const node = nodeOf('n1');
    node.data.draft.settings = { aspectRatio: '16:9', durationSec: 5 };
    const doc = docWith(node);
    const next = updateCanvasNodeDraft(doc, 'n1', { settings: { durationSec: 10 } }, 30);
    expect(next.nodes[0]!.data.draft.settings).toMatchObject({ aspectRatio: '16:9', durationSec: 10 });
  });

  it('值没变 → 返回原对象（避免每敲一次键都触发自动保存）', () => {
    const doc = docWith(nodeOf('n1'));
    expect(updateCanvasNodeDraft(doc, 'n1', { prompt: '' })).toBe(doc);
    expect(updateCanvasNodeDraft(doc, 'ghost', { prompt: 'x' })).toBe(doc);
  });
});

describe('批次写回（B3）', () => {
  it('追加批次；同 id 不重复追加', () => {
    const doc = docWith(nodeOf('n1'));
    const batch = { id: 'b1', createdAt: 1, status: 'queued' as const, outputs: [] };
    const once = addCanvasBatch(doc, 'n1', batch, 50);
    expect(once.nodes[0]!.data.batches).toHaveLength(1);
    expect(addCanvasBatch(once, 'n1', batch, 60)).toBe(once);
  });

  it('任务成功 → 产物写 task:<taskId>（不是临时 URL）', () => {
    const patch = canvasBatchPatchFromTask(
      task('t1', 'succeeded', { outputVideoUrl: '/media/t1.mp4' }),
    );
    expect(patch).toEqual({
      status: 'succeeded',
      outputs: [{ assetId: 'task:t1', kind: 'video', url: '/media/t1.mp4' }],
      failure: null,
    });
  });

  it('图片产物同样走 task: 引用；失败批次带可读原因', () => {
    const image = canvasBatchPatchFromTask(
      task('t2', 'succeeded', { outputImageUrl: '/media/t2.png' }),
    );
    expect(image.outputs).toEqual([{ assetId: 'task:t2', kind: 'image', url: '/media/t2.png' }]);

    const failed = canvasBatchPatchFromTask(
      task('t3', 'failed', { error: { code: 'UPSTREAM_ERROR', message: '模型没加载', disposition: 'retryable' } }),
    );
    expect(failed).toMatchObject({
      status: 'failed',
      failure: { code: 'UPSTREAM_ERROR', message: '模型没加载' },
    });
  });

  it('任务成功但没有产物 → 不覆盖已有 outputs', () => {
    const patch = canvasBatchPatchFromTask(task('t4', 'succeeded'));
    expect(patch.outputs).toBeUndefined();
  });

  it('运行中只写状态：无变化时返回原文档（轮询不白写盘）', () => {
    const doc = docWith(nodeOf('n1'));
    const withBatch = addCanvasBatch(
      doc,
      'n1',
      { id: 'b1', taskId: 't1', createdAt: 1, status: 'queued', outputs: [] },
      1,
    );
    const running = patchCanvasBatch(withBatch, 'n1', 'b1', { status: 'running' }, 2);
    expect(running).not.toBe(withBatch);
    const again = patchCanvasBatch(running, 'n1', 'b1', { status: 'running' }, 3);
    expect(again).toBe(running);
  });

  it('成功写回后节点 source 变为 model_generated，并清掉旧失败', () => {
    const doc = docWith(nodeOf('n1'));
    const withBatch = addCanvasBatch(
      doc,
      'n1',
      {
        id: 'b1',
        taskId: 't1',
        createdAt: 1,
        status: 'failed',
        outputs: [],
        failure: { code: 'UPSTREAM_ERROR', message: '旧的' },
      },
      1,
    );
    const done = patchCanvasBatch(
      withBatch,
      'n1',
      'b1',
      {
        status: 'succeeded',
        outputs: [{ assetId: 'task:t1', kind: 'video', url: '/media/t1.mp4' }],
        failure: null,
      },
      5,
    );
    expect(done.nodes[0]!.data.source).toBe('model_generated');
    expect(done.nodes[0]!.data.batches[0]!.failure).toBeUndefined();
  });

  it('展示产物取最近一次成功（失败批次不把上一版顶掉）', () => {
    const node = nodeOf('n1');
    node.data.batches = [
      { id: 'b1', createdAt: 1, status: 'succeeded', outputs: [{ assetId: 'a1', kind: 'image', url: '/a' }] },
      { id: 'b2', createdAt: 2, status: 'failed', outputs: [], failure: { code: 'UPSTREAM_ERROR', message: 'x' } },
    ];
    expect(latestCanvasOutput(node)?.output.assetId).toBe('a1');
  });

  it('在跑批次包含“结果未知”的 queued（V2.49：有 request 才挡住删除/撤销）', () => {
    const node = nodeOf('n1');
    node.data.batches = [
      {
        id: 'b1',
        createdAt: 1,
        status: 'queued',
        outputs: [],
        request: {
          prompt: 'p',
          mode: 't2i',
          aspectRatio: '1:1',
          provider: 'host-comfyui',
        },
      },
      { id: 'b2', taskId: 't2', createdAt: 2, status: 'running', outputs: [] },
    ];
    expect(canvasNodeActiveBatches(node).map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('旧版 queued 无 request 不永久锁死（允许显式重提/删除）', () => {
    const node = nodeOf('n1');
    node.data.batches = [{ id: 'legacy', createdAt: 1, status: 'queued', outputs: [] }];
    expect(canvasNodeActiveBatches(node)).toEqual([]);
  });

  it('已完成/失败批次不挡路（不会因撤销重新执行）', () => {
    const node = nodeOf('n1');
    node.data.batches = [
      { id: 'b1', taskId: 't1', createdAt: 1, status: 'succeeded', outputs: [] },
      { id: 'b2', createdAt: 2, status: 'failed', outputs: [] },
    ];
    expect(canvasNodeActiveBatches(node)).toEqual([]);
    expect(canvasActiveTaskNodeIds(docWith(node))).toEqual([]);
  });

  it('撤销守卫：只报"会被丢掉且还有任务在跑"的节点', () => {
    const running = nodeOf('n1');
    running.data.batches = [
      { id: 'b1', taskId: 't1', createdAt: 1, status: 'running', outputs: [] },
    ];
    const idle = nodeOf('n2');
    const current = docWith(running);
    current.nodes.push(idle);

    expect(canvasActiveTaskNodeIds(current)).toEqual(['n1']);
    // target 里保留 n1、去掉 n2 → 没有丢掉在跑的节点
    const keepRunning = docWith(running);
    expect(canvasLostActiveTaskNodes(keepRunning, current)).toEqual([]);
    // target 里两个都不留 → n1 会被丢掉
    expect(canvasLostActiveTaskNodes(emptyDoc(), current)).toEqual(['n1']);
  });
});

describe('复制 / 批量插入 / 资产入库（B3）', () => {
  it('新节点落点：空文档从原点起；有内容时在右侧另起网格', () => {
    expect(nextCanvasNodePositions(emptyDoc(), 2)).toEqual([
      { x: 0, y: 0 },
      { x: 480, y: 0 },
    ]);
    const doc = docWith(nodeOf('n1'));
    doc.nodes[0]!.layout = { x: 100, y: 50, width: 320, height: 320 };
    expect(nextCanvasNodePositions(doc, 1)).toEqual([{ x: 580, y: 50 }]);
    expect(nextCanvasNodePositions(doc, 0)).toEqual([]);
  });

  it('复制节点：新 id / 新标题 / 位置错开，草稿与批次是深拷贝（改副本不影响原件）', () => {
    const source = nodeOf('n1');
    source.data.draft.prompt = '原文';
    source.data.draft.references = [{ assetId: 'a1', role: 'first-frame', order: 0 }];
    source.data.batches = [
      { id: 'b1', createdAt: 1, status: 'succeeded', outputs: [{ assetId: 'a1', kind: 'image' }] },
    ];
    const copy = cloneCanvasNode(source, { id: 'n2', title: '视频 2', now: 5 });
    expect(copy.id).toBe('n2');
    expect(copy.layout.x).toBe(source.layout.x + 40);
    expect(copy.data.batches[0]!.outputs[0]!.assetId).toBe('a1');
    copy.data.draft.references[0]!.assetId = 'changed';
    expect(source.data.draft.references[0]!.assetId).toBe('a1');
  });

  it('批量插入：标题逐个递增，不会两个副本都叫"视频 2"', () => {
    const source = nodeOf('n1');
    source.data.title = '视频 1';
    const doc = docWith(source);
    const inserted = insertCanvasNodes(doc, [source, source], {
      ids: ['c1', 'c2'],
      labels: LABELS,
      now: 9,
    });
    expect(inserted.nodes.map((n) => n.data.title)).toEqual(['视频 2', '视频 3']);
    expect(inserted.doc.nodes).toHaveLength(3);
  });

  it('长度不一致的批量插入返回空（调用方 bug 不产生半份数据）', () => {
    const doc = emptyDoc();
    const result = insertCanvasNodes(doc, [nodeOf('n1')], { ids: [], labels: LABELS });
    expect(result.nodes).toEqual([]);
    expect(result.doc).toBe(doc);
  });

  it('资产入库：每项一个节点 + 一个 succeeded 批次；来源与名字如实', () => {
    const doc = emptyDoc();
    const result = addCanvasNodesFromAssets(doc, {
      assets: [
        { assetId: 'a1', kind: 'image', url: '/media/assets/a1.jpg', name: '封面.jpg' },
        { assetId: 'a2', kind: 'video', url: '/media/assets/a2.mp4' },
      ],
      ids: ['n1', 'n2'],
      batchIds: ['b1', 'b2'],
      source: 'from_asset',
      positions: [
        { x: 0, y: 0 },
        { x: 480, y: 0 },
      ],
      labels: LABELS,
      now: 7,
    });
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]!.data.title).toBe('封面.jpg');
    expect(result.nodes[0]!.data.source).toBe('from_asset');
    expect(result.nodes[0]!.data.batches[0]).toMatchObject({
      status: 'succeeded',
      outputs: [{ assetId: 'a1', kind: 'image', url: '/media/assets/a1.jpg' }],
    });
    // 没有名字 → 按类型递增
    expect(result.nodes[1]!.data.title).toBe('视频 1');
    expect(result.doc.nodes.map((n) => n.layout.x)).toEqual([0, 480]);
  });
});

describe('S5-B3 选中版本', () => {
  function versionedDoc(): CanvasDoc {
    const node = nodeOf('n1');
    node.data.batches = [
      {
        id: 'b1',
        createdAt: 1,
        status: 'succeeded',
        outputs: [{ assetId: 'a1', kind: 'image', url: '/media/a1.png' }],
      },
      {
        id: 'b2',
        createdAt: 2,
        status: 'failed',
        outputs: [],
        failure: { code: 'X', message: '失败' },
      },
      {
        id: 'b3',
        createdAt: 3,
        status: 'succeeded',
        outputs: [{ assetId: 'a3', kind: 'video', url: '/media/a3.mp4' }],
      },
    ];
    return docWith(node);
  }

  it('缺省预览最新成功批次；选中旧成功后只读旧产物', () => {
    const doc = versionedDoc();
    const node = doc.nodes[0]!;
    expect(canvasNodeVisibleOutput(node)).toMatchObject({ state: 'latest', output: { assetId: 'a3' } });

    const selected = selectCanvasNodeBatch(doc, 'n1', 'b2');
    expect(selected).toBe(doc); // 失败批次不可选
    const next = selectCanvasNodeBatch(doc, 'n1', 'b1');
    expect(next.nodes[0]!.data.selectedBatchId).toBe('b1');
    expect(canvasNodeVisibleOutput(next.nodes[0]!)).toMatchObject({
      state: 'selected',
      output: { assetId: 'a1' },
    });
  });

  it('选中 id 失效时返回 invalid，不静默回退到最新成功版本', () => {
    const doc = versionedDoc();
    doc.nodes[0]!.data.selectedBatchId = 'missing';
    expect(canvasNodeVisibleOutput(doc.nodes[0]!)).toEqual({ state: 'invalid', batch: null });
    expect(canvasNodeVisibleOutput(nodeOf('empty'))).toEqual({ state: 'none' });
  });
});
