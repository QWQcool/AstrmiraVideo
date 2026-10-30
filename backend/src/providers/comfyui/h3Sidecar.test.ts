import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMFY_WIRED_MODES, alignFramesTo, parseTemplateDeclaration } from './comfyuiProtocol.js';

/**
 * `docs/templates/minimax-h3-t2v.meta.json` —— **上机当天直接抄过去用的 sidecar**。
 *
 * 为什么要为一份文档里的 JSON 写测试：这份文件是"租到 GPU 机器后第一步"要复制到模板目录的东西，
 * 一旦写成 `modes` 拼错/多写一个本仓没接线的模式，现场的表现是**自检结论不对**而不是报错
 * （`parseTemplateDeclaration` 只在"形状不对"时抛错，语义问题靠这份断言兜）。
 *
 * 钉住三件事：
 * 1. 文件本身能被解析（形状没漂）；
 * 2. 声明的模式**都在本仓已接线的集合里**（否则现场会被静默剔除，白折腾）；
 * 3. `modelMatch` 的关键词真的是 H3 的文件名片段（`minimax_h3` 那套），不是 Wan 的。
 */
describe('MiniMax H3 的 sidecar 样例（docs/templates）', () => {
  const file = path.resolve(process.cwd(), '..', 'deploy', 'comfyui-templates', 'minimax-h3-t2v.meta.json');
  const declaration = parseTemplateDeclaration(JSON.parse(readFileSync(file, 'utf8')), file);

  it('能被解析，且声明了 t2v / i2v', () => {
    expect(declaration.modes).toEqual(['t2v', 'i2v']);
    expect(declaration.label).toContain('MiniMax H3');
  });

  it('声明的模式**全部在本仓已接线**（fl2v / v2v 没接线，所以不该出现在文件里）', () => {
    for (const mode of declaration.modes) {
      expect(COMFY_WIRED_MODES).toContain(mode);
    }
  });

  it('modelMatch 指向 H3 的文件名片段（换模板时这条防"拿 Wan 的模板配 H3 的权重"）', () => {
    expect(declaration.modelMatch?.unet).toBe('minimax_h3');
    expect(declaration.modelMatch?.clip).toContain('minimax_h3');
    expect(declaration.modelMatch?.vae).toContain('minimax_h3');
  });

  it('notes 里写明了两件现场会踩的事（占位符 + fl2v 未接线）', () => {
    const notes = declaration.notes ?? '';
    expect(notes).toContain('{{START_IMAGE');
    expect(notes).toContain('fl2v');
  });

  it('帧数对齐是 **17n+5**（Wan 的 4n+1 会把 H3 的长度提交错）', () => {
    expect(declaration.frameAlign).toEqual({ mod: 17, offset: 5 });
    // 5 秒 @24fps = 120 → 124（5.17s），不是 Wan 的 121
    expect(alignFramesTo(120, declaration.frameAlign)).toBe(124);
    expect(alignFramesTo(120)).toBe(121);
  });
});
