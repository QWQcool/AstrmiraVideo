import { describe, expect, it } from 'vitest';
import type { AssetListEntry, TaskProgress, VideoGenerateRequest } from '@astrmira/shared';
import {
  LINEAGE_COLUMN_WIDTH,
  assetNodeId,
  buildLineage,
  isProblemNode,
  layoutLineage,
  lineageStatusClass,
  taskNodeId,
} from './lineage';

/**
 * 血缘图纯函数单测（P4-T1）。
 *
 * 最要紧的三类输入：**孤儿节点**（没有关系也要出现）、**缺失源**（引用了但不在列表里 → ghost）、
 * **环**（自引用 / 互相引用）—— 前两类决定"图会不会骗人"，第三类决定"会不会死循环"。
 */

const SNAPSHOT: VideoGenerateRequest = {
  prompt: '雨夜街头',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'cloud-volcano-seedance',
};

function task(partial: Partial<TaskProgress> & { taskId: string }): TaskProgress {
  return {
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: SNAPSHOT,
    createdAt: 1,
    ...partial,
  };
}

function asset(partial: Partial<AssetListEntry> & { assetId: string }): AssetListEntry {
  return {
    kind: 'image',
    mime: 'image/jpeg',
    size: 100,
    url: `/media/assets/${partial.assetId}.jpg`,
    createdAt: 1,
    // V2.11（B47）：资产永远有项目归属（缺省 = 默认项目）
    projectId: 'default',
    ...partial,
  };
}

describe('buildLineage · 节点', () => {
  it('空输入 → 空图', () => {
    expect(buildLineage({ tasks: [] })).toEqual({ nodes: [], edges: [] });
  });

  it('孤立的生成任务仍然入图（没有关系也如实呈现，不悄悄吞掉）', () => {
    const graph = buildLineage({ tasks: [task({ taskId: 'gen-a' })] });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0]).toMatchObject({
      id: taskNodeId('gen-a'),
      kind: 'task',
      label: '雨夜街头',
      depth: 0,
    });
  });

  it('剪辑产物：编辑边 + 深度 +1；标签带「剪辑产物」', () => {
    const graph = buildLineage({
      tasks: [
        task({ taskId: 'gen-a' }),
        task({ taskId: 'edit-b', origin: { kind: 'edit', sourceTaskId: 'gen-a', project: { version: 1, fps: 30, width: 1280, height: 720, tracks: [] } } }),
      ],
    });
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    expect(byId.get(taskNodeId('gen-a'))?.depth).toBe(0);
    expect(byId.get(taskNodeId('edit-b'))?.depth).toBe(1);
    expect(byId.get(taskNodeId('edit-b'))?.isEdit).toBe(true);
    expect(byId.get(taskNodeId('edit-b'))?.sublabel).toContain('剪辑产物');
    expect(graph.edges.some((edge) => edge.kind === 'edit')).toBe(true);
  });

  it('缺失源（引用了不在列表里的任务）→ ghost 节点 + 边仍在（图不能断）', () => {
    const graph = buildLineage({
      tasks: [task({ taskId: 'edit-b', origin: { kind: 'edit', sourceTaskId: 'gone', script: { sourceTaskId: 'gone', operations: [] } } })],
    });
    const ghost = graph.nodes.find((node) => node.id === taskNodeId('gone'));
    expect(ghost?.ghost).toBe(true);
    expect(ghost?.sublabel).toContain('不在最近记录里');
    expect(graph.edges).toHaveLength(1);
  });

  it('深度取最长路径：a → b → c 链，c 的深度是 2（不是 1）', () => {
    const graph = buildLineage({
      tasks: [
        task({ taskId: 'a' }),
        task({ taskId: 'b', origin: { kind: 'edit', sourceTaskId: 'a', script: { sourceTaskId: 'a', operations: [] } } }),
        task({ taskId: 'c', origin: { kind: 'edit', sourceTaskId: 'b', script: { sourceTaskId: 'b', operations: [] } } }),
      ],
    });
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    expect(byId.get(taskNodeId('c'))?.depth).toBe(2);
  });

  it('自引用（任务把自己当参考）不死循环，按 0 收口', () => {
    const graph = buildLineage({
      tasks: [
        task({
          taskId: 'self',
          requestSnapshot: { ...SNAPSHOT, mode: 'v2v', assets: { referenceVideo: 'task:self' } },
        }),
      ],
    });
    expect(graph.edges.some((edge) => edge.kind === 'task-ref')).toBe(true);
    const node = graph.nodes.find((item) => item.id === taskNodeId('self'));
    expect(node?.depth).toBe(0);
  });

  it('互相引用（A↔B）不死循环', () => {
    const graph = buildLineage({
      tasks: [
        task({ taskId: 'x', requestSnapshot: { ...SNAPSHOT, assets: { referenceVideo: 'task:y' } } }),
        task({ taskId: 'y', requestSnapshot: { ...SNAPSHOT, assets: { referenceVideo: 'task:x' } } }),
      ],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
    for (const node of graph.nodes) expect(Number.isFinite(node.depth)).toBe(true);
  });
});

describe('buildLineage · 边（三类派生关系）', () => {
  it('抽帧：任务 → 资产（extract），资产节点带上库里的事实', () => {
    const graph = buildLineage({
      tasks: [task({ taskId: 'gen-a', extractedAssetIds: ['asset-1'] })],
      assets: [asset({ assetId: 'asset-1' })],
    });
    const edge = graph.edges.find((item) => item.kind === 'extract');
    expect(edge).toMatchObject({ from: taskNodeId('gen-a'), to: assetNodeId('asset-1') });
    const node = graph.nodes.find((item) => item.id === assetNodeId('asset-1'));
    expect(node?.sublabel).toBe('图片');
    expect(node?.depth).toBe(1);
  });

  it('参考素材：资产 → 任务（reference）；任务深度 +1', () => {
    const graph = buildLineage({
      tasks: [
        task({
          taskId: 'i2v-1',
          requestSnapshot: { ...SNAPSHOT, mode: 'i2v', assets: { firstFrameImage: 'asset-img' } },
        }),
      ],
      assets: [asset({ assetId: 'asset-img' })],
    });
    const edge = graph.edges.find((item) => item.kind === 'reference');
    expect(edge).toMatchObject({ from: assetNodeId('asset-img'), to: taskNodeId('i2v-1') });
    const node = graph.nodes.find((item) => item.id === taskNodeId('i2v-1'));
    expect(node?.depth).toBe(1);
  });

  it('成片当参考（task: 引用）→ 任务 → 任务（task-ref）', () => {
    const graph = buildLineage({
      tasks: [
        task({ taskId: 'gen-a' }),
        task({
          taskId: 'v2v-1',
          requestSnapshot: { ...SNAPSHOT, mode: 'v2v', assets: { referenceVideo: 'task:gen-a' } },
        }),
      ],
    });
    const edge = graph.edges.find((item) => item.kind === 'task-ref');
    expect(edge).toMatchObject({ from: taskNodeId('gen-a'), to: taskNodeId('v2v-1') });
  });

  it('引用的素材不在库中 → ghost 资产节点（edge 保留，图不断）', () => {
    const graph = buildLineage({
      tasks: [
        task({
          taskId: 'i2v-2',
          requestSnapshot: { ...SNAPSHOT, mode: 'i2v', assets: { firstFrameImage: 'asset-gone' } },
        }),
      ],
    });
    const ghost = graph.nodes.find((item) => item.id === assetNodeId('asset-gone'));
    expect(ghost?.ghost).toBe(true);
    expect(ghost?.sublabel).toContain('不在资产库里');
    expect(graph.edges).toHaveLength(1);
  });

  it('同一对节点同时存在两种关系（参考 + 抽帧）时两条边都保留（语义不同）', () => {
    const graph = buildLineage({
      tasks: [
        task({
          taskId: 'gen-a',
          extractedAssetIds: ['asset-1'],
          requestSnapshot: { ...SNAPSHOT, assets: { firstFrameImage: 'asset-1' } },
        }),
      ],
      assets: [asset({ assetId: 'asset-1' })],
    });
    const kinds = graph.edges.map((edge) => edge.kind).sort();
    expect(kinds).toEqual(['extract', 'reference']);
  });
});

describe('layoutLineage · 分层布局', () => {
  it('每个节点都有位置；列 = 深度（x 递增），同列行号递增（y 递增）', () => {
    const graph = buildLineage({
      tasks: [
        task({ taskId: 'a' }),
        task({ taskId: 'b', createdAt: 2, origin: { kind: 'edit', sourceTaskId: 'a', script: { sourceTaskId: 'a', operations: [] } } }),
        task({ taskId: 'c', createdAt: 3, origin: { kind: 'edit', sourceTaskId: 'a', script: { sourceTaskId: 'a', operations: [] } } }),
      ],
    });
    const layout = layoutLineage(graph);
    for (const node of graph.nodes) expect(layout.positions[node.id]).toBeDefined();

    const a = layout.positions[taskNodeId('a')]!;
    const b = layout.positions[taskNodeId('b')]!;
    const c = layout.positions[taskNodeId('c')]!;
    expect(b.x - a.x).toBe(LINEAGE_COLUMN_WIDTH);
    expect(b.y).not.toBe(c.y);
    expect(layout.width).toBeGreaterThanOrEqual(LINEAGE_COLUMN_WIDTH);
    expect(layout.height).toBeGreaterThan(0);
  });
});

/**
 * V2.19（台账 B62）节点检查器：节点要带上**原始对象**。
 *
 * 为什么盯这条：检查器要显示提示词快照 / 成本 / warnings / 错误 ——
 * 如果血缘层"另抄一份字段"，每加一个任务字段就要同步两处（迟早漏）。
 * 断言用 `toBe`（同一引用）而不是 `toMatchObject`，就是为了钉住"不复制"这件事。
 */
/**
 * V2.19（台账 B63）：执行态分类。
 *
 * 最要紧的一条：**不确定（可能已计费）必须盖过普通失败** —— 它的 status 也是 `failed`，
 * 但"这条可能花了钱"是更重的信息（与成本台账 CONTRACT §13 同一口径）。
 */
describe('执行态分类（B63 执行态与失败链）', () => {
  it('按 status 分类；ghost 与 asset 各有自己的类', () => {
    const graph = buildLineage({
      tasks: [
        task({ taskId: 'ok', status: 'succeeded' }),
        task({ taskId: 'bad', status: 'failed' }),
        task({ taskId: 'run', status: 'running' }),
        task({ taskId: 'wait', status: 'queued' }),
        task({
          taskId: 'ghost-user',
          requestSnapshot: { ...SNAPSHOT, mode: 'i2v', assets: { firstFrameImage: 'gone' } },
        }),
      ],
      assets: [asset({ assetId: 'asset-1' })],
    });
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));

    expect(lineageStatusClass(byId.get(taskNodeId('ok'))!)).toBe('succeeded');
    expect(lineageStatusClass(byId.get(taskNodeId('bad'))!)).toBe('failed');
    expect(lineageStatusClass(byId.get(taskNodeId('run'))!)).toBe('running');
    expect(lineageStatusClass(byId.get(taskNodeId('wait'))!)).toBe('queued');
    expect(lineageStatusClass(byId.get(assetNodeId('gone'))!)).toBe('ghost');
    expect(lineageStatusClass(byId.get(assetNodeId('asset-1'))!)).toBe('asset');
  });

  it('**不确定盖过失败**：disposition=uncertain 时即使 status=failed 也归 uncertain', () => {
    const uncertain = task({
      taskId: 'u',
      status: 'failed',
      error: { code: 'UNCERTAIN_RESULT', message: '结果不明', disposition: 'uncertain' },
    });
    const terminal = task({
      taskId: 'f',
      status: 'failed',
      error: { code: 'UPSTREAM_ERROR', message: '上游 500', disposition: 'terminal' },
    });
    const graph = buildLineage({ tasks: [uncertain, terminal] });
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));

    expect(lineageStatusClass(byId.get(taskNodeId('u'))!)).toBe('uncertain');
    expect(lineageStatusClass(byId.get(taskNodeId('f'))!)).toBe('failed');

    // 两者都算"需要人看一眼"（画布的红点与「只看异常」用它）
    expect(isProblemNode(byId.get(taskNodeId('u'))!)).toBe(true);
    expect(isProblemNode(byId.get(taskNodeId('f'))!)).toBe(true);

    // 正常任务与资产都不是问题节点
    const normal = buildLineage({
      tasks: [task({ taskId: 'ok' })],
      assets: [asset({ assetId: 'asset-1' })],
    });
    for (const node of normal.nodes) expect(isProblemNode(node)).toBe(false);
  });
});

describe('节点带上原始对象（B62 节点检查器）', () => {
  it('task 节点带原始 TaskProgress（同一引用，不是深拷贝）', () => {
    const source = task({ taskId: 'gen-a' });
    const graph = buildLineage({ tasks: [source] });
    const node = graph.nodes.find((item) => item.id === taskNodeId('gen-a'));
    expect(node?.task).toBe(source);
    expect(node?.task?.requestSnapshot.prompt).toBe('雨夜街头');
  });

  it('asset 节点带原始 AssetListEntry；ghost 节点**没有**原始对象（如实缺席）', () => {
    const entry = asset({ assetId: 'asset-1' });
    const graph = buildLineage({ tasks: [], assets: [entry] });
    expect(graph.nodes.find((item) => item.id === assetNodeId('asset-1'))?.asset).toBe(entry);

    const ghostGraph = buildLineage({
      tasks: [
        task({
          taskId: 'i2v-1',
          requestSnapshot: { ...SNAPSHOT, mode: 'i2v', assets: { firstFrameImage: 'gone-asset' } },
        }),
      ],
    });
    const ghost = ghostGraph.nodes.find((item) => item.id === assetNodeId('gone-asset'));
    expect(ghost?.ghost).toBe(true);
    expect(ghost?.asset).toBeUndefined();
  });
});
