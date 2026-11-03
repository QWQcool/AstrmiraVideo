import { describe, expect, it } from 'vitest';
import {
  MossLayoutSchema,
  buildMossLayout,
  type CanvasLayoutFrame,
} from '@astrmira/shared';

/**
 * 画布构图 → MOSS 布局提示词（V2.113）。
 *
 * 判据分两层：
 * 1. **几何**：手算一遍中心像素坐标，断言逐个对上（不"看着差不多"）；
 * 2. **形状**：产出的 JSON 必须能被 `MossLayoutSchema` 解析，且键名与真机验证过的
 *    那份完全一致（`bbox_coord_space` / `bbox_format` 写错，模型会当普通提示词忽略）。
 */

function frame(id: string, x: number, y: number, width: number, height: number, caption: string): CanvasLayoutFrame {
  return { id, layout: { x, y, width, height }, caption };
}

const SIZE = { width: 1024, height: 576 };

describe('画布构图 → 布局提示词', () => {
  it('左右两个框：坐标是中心像素、yxyx，且与手算一致', () => {
    // 两个 200×200 的框，水平相距 200；padding=0 便于手算
    const result = buildMossLayout({
      summary: '白底产品图',
      frames: [
        frame('left', 0, 0, 200, 200, '左：红球'),
        frame('right', 400, 0, 200, 200, '右：蓝方块'),
      ],
      size: SIZE,
      padding: 0,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 包围盒 = 600×200 → 映射到 1024×576；框 1 = x∈[0,200]，框 2 = x∈[400,600]
    // x: 0→0-512=-512, 200→341-512=-171, 400→683-512=171, 600→1024-512=512
    // y: 0→0-288=-288, 200→576-288=288
    expect(result.layout.items[0]?.bbox).toEqual([-288, -512, 288, -171]);
    expect(result.layout.items[1]?.bbox).toEqual([-288, 171, 288, 512]);
    expect(result.layout.items[0]?.caption).toBe('左：红球');
    expect(result.layout.items[1]?.caption).toBe('右：蓝方块');
    expect(result.layout.bbox_coord_space).toBe('abs_centralized');
    expect(result.layout.bbox_format).toBe('yxyx');
  });

  it('产出的 JSON 能被契约 schema 解析，且能原样 parse 回来（发出去的就是它）', () => {
    const result = buildMossLayout({
      summary: '白底产品图',
      frames: [frame('a', 0, 0, 100, 100, 'A'), frame('b', 200, 0, 100, 100, 'B')],
      size: SIZE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(MossLayoutSchema.safeParse(JSON.parse(result.promptText)).success).toBe(true);
    expect(JSON.parse(result.promptText)).toEqual(result.layout);
  });

  it('padding 会把框往里收（贴边的框不会被当成背景）', () => {
    const frames = [frame('a', 0, 0, 100, 100, 'A'), frame('b', 300, 0, 100, 100, 'B')];
    const tight = buildMossLayout({ summary: 's', frames, size: SIZE, padding: 0 });
    const padded = buildMossLayout({ summary: 's', frames, size: SIZE, padding: 0.2 });
    expect(tight.ok && padded.ok).toBe(true);
    if (!tight.ok || !padded.ok) return;

    // 外扩后同样的框占的比例更小 → |x| 更小
    expect(Math.abs(padded.layout.items[0]!.bbox[1])).toBeLessThan(Math.abs(tight.layout.items[0]!.bbox[1]));
  });

  it('单个框拒绝：一个框铺满整张图，等于没有布局约束', () => {
    const result = buildMossLayout({ summary: 's', frames: [frame('a', 0, 0, 100, 100, 'A')], size: SIZE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('至少需要两个框');
  });

  it('空描述 / 空 summary 拒绝（不生成一条会被模型当噪声的提示词）', () => {
    const noSummary = buildMossLayout({
      summary: '   ',
      frames: [frame('a', 0, 0, 10, 10, 'A'), frame('b', 20, 0, 10, 10, 'B')],
      size: SIZE,
    });
    expect(noSummary.ok).toBe(false);

    const allEmpty = buildMossLayout({
      summary: 's',
      frames: [frame('a', 0, 0, 100, 100, '  '), frame('b', 200, 0, 100, 100, '')],
      size: SIZE,
    });
    expect(allEmpty.ok).toBe(false);
  });

  it('空白描述的框被跳过，其余照常（不因为一个空框整体失败）', () => {
    const result = buildMossLayout({
      summary: 's',
      frames: [
        frame('a', 0, 0, 100, 100, 'A'),
        frame('empty', 200, 0, 100, 100, '   '),
        frame('c', 400, 0, 100, 100, 'C'),
      ],
      size: SIZE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.items.map((item) => item.caption)).toEqual(['A', 'C']);
  });

  it('框太小 → 拒绝并说清是哪个框（而不是发一条模型会无视的提示词）', () => {
    // 一个巨大的框 + 一个 2px 的框
    const result = buildMossLayout({
      summary: 's',
      frames: [frame('big', 0, 0, 1000, 1000, '大'), frame('tiny', 500, 500, 2, 2, '小')],
      size: SIZE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('太小');
    expect(result.reason).toContain('小');
  });

  it('尺寸不合法时拒绝（中心像素依赖它，不能默默用 0 除）', () => {
    expect(
      buildMossLayout({ summary: 's', frames: [frame('a', 0, 0, 9, 9, 'A'), frame('b', 9, 0, 9, 9, 'B')], size: { width: 0, height: 0 } }).ok,
    ).toBe(false);
  });

  it('垂直方向的框：上/下的 bbox 顺序仍然是 yxyx（y0<y1）', () => {
    const result = buildMossLayout({
      summary: 's',
      frames: [frame('top', 0, 0, 300, 100, '上'), frame('bottom', 0, 300, 300, 100, '下')],
      size: SIZE,
      padding: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [top, bottom] = result.layout.items;
    expect(top!.bbox[0]).toBeLessThan(top!.bbox[2]);
    expect(top!.bbox[2]).toBeLessThan(bottom!.bbox[0]);
  });
});
