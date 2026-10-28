import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 扩图模板的结构护栏（2026-10-28 真机修出来的教训）。
 *
 * 症状：扩图跑完几何是对的，但**新画的那一圈永远是中性灰 `#808080`**，
 * 把 `Flux2Scheduler.steps` 从 4 提到 12 也一样。
 * 根因：positive 接了 `ReferenceLatent`，而它的 latent 来自**补过灰边的整张图** ——
 * 模型照着参考复刻了灰边。去掉 ReferenceLatent（positive 直接接 `CLIPTextEncode`）后，
 * 同 seed、同参数立刻正常补画。
 *
 * 这条断言的理由：这类错误**没有类型/运行期症状**，只有"出图难看"，
 * 而"难看"在 4 步采样 + 720p 下很容易被当成模型能力问题放过。
 */

const ROOT = path.resolve(process.cwd(), '..');
const TEMPLATE_PATH = path.join(ROOT, 'deploy/comfyui-templates/outpaint-klein.api.json');

interface TemplateNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

const template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')) as Record<string, TemplateNode>;

describe('扩图模板：不要把补过灰边的 latent 当参考喂回去', () => {
  it('shipped 模板里没有 ReferenceLatent 节点', () => {
    const classes = Object.values(template).map((node) => node.class_type);
    expect(classes).not.toContain('ReferenceLatent');
  });

  it('CFGGuider 的 positive 直接指向 CLIPTextEncode', () => {
    const guider = Object.entries(template).find(([, node]) => node.class_type === 'CFGGuider');
    expect(guider).toBeDefined();
    const positive = guider?.[1].inputs['positive'] as [string, number] | undefined;
    expect(positive).toBeDefined();
    const source = template[positive![0]];
    expect(source?.class_type).toBe('CLIPTextEncode');
  });

  it('外扩仍走 ImagePadForOutpaint（几何靠它，占位符不能丢）', () => {
    const pad = Object.values(template).find((node) => node.class_type === 'ImagePadForOutpaint');
    expect(pad).toBeDefined();
    expect(pad?.inputs['left']).toBe('{{PAD_LEFT}}');
    expect(pad?.inputs['bottom']).toBe('{{PAD_BOTTOM}}');
  });
});
