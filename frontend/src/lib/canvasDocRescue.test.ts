import { describe, expect, it } from 'vitest';
import { createEmptyCanvasDoc } from '@astrmira/shared';
import { rescueAsNewCanvas, rescueName } from './canvasDocRescue';

/**
 * "另存为新画布"（V2.110 / B85 片 C）。
 *
 * 这条路径只在"画布已被别处删掉"时走到，平时不会出现；正因为它罕见，
 * 更需要把"改什么 / 不改什么"钉死 —— 一旦写错，用户唯一的救命稻草就没了。
 */
describe('画布救援：另存为新画布', () => {
  it('只改身份（projectId / name / revision / 时间），内容原样带过去', () => {
    const original = createEmptyCanvasDoc('old', '原画布', 1_700_000_000_000);
    const rescued = rescueAsNewCanvas(original, 'new-id', '原画布（副本）', 1_800_000_000_000);

    expect(rescued.projectId).toBe('new-id');
    expect(rescued.name).toBe('原画布（副本）');
    // 新文档必须从 revision 1 开始，否则服务端会当成旧修订
    expect(rescued.revision).toBe(1);
    expect(rescued.createdAt).toBe(1_800_000_000_000);
    expect(rescued.updatedAt).toBe(1_800_000_000_000);

    // 内容一个字节都不能丢
    expect(rescued.nodes).toEqual(original.nodes);
    expect(rescued.edges).toEqual(original.edges);
    expect(rescued.groups).toEqual(original.groups);
    expect(rescued.viewport).toEqual(original.viewport);
    expect(rescued.version).toBe(original.version);
    // 原对象不许被改（救援失败时用户还在原画布上）
    expect(original.projectId).toBe('old');
    expect(original.revision).toBe(1);
  });

  it('副本名字：不叫空串，也不丢原名', () => {
    expect(rescueName('蓝调客厅')).toBe('蓝调客厅（副本）');
    expect(rescueName('   ')).toBe('画布（副本）');
    expect(rescueName('')).toBe('画布（副本）');
  });
});
