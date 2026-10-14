import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  renderWorkflow,
  WAN22_TI2V_5B_TEMPLATE,
  type WorkflowTemplate,
} from './comfyuiProtocol.js';
import {
  COMFYUI_DEFAULT_TEMPLATE_NAME,
  isWorkflowTemplate,
  loadWorkflowTemplate,
} from './comfyuiTemplates.js';

/**
 * 模板外置（V2.33 / CONTRACT §19-3）。
 *
 * 两条要钉住的事：
 * 1. **渲染规则**（占位符换任意 JSON 值 / 未提供就删键 / `_dropWhenMissing` 删节点）——
 *    它是"模板能表达条件"的全部机制，写错了症状是"提交被上游拒"，且报错信息离根因很远；
 * 2. **加载失败必须抛错，不许回落内置** —— 回落会让用户以为自己的模板生效了，
 *    而实际跑的是内置那张（本仓铁律：不静默降级）。
 */

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'comfy-template-'));
  tempDirs.push(dir);
  return dir;
}

describe('renderWorkflow · 三条规则', () => {
  it('规则1：`"{{KEY}}"` 独占字符串时替换为**任意 JSON 值**（数字 / 数组 / 字符串）', () => {
    const template: WorkflowTemplate = {
      '1': { class_type: 'A', inputs: { n: '{{NUM}}', arr: '{{ARR}}', s: '{{STR}}' } },
    };
    const rendered = renderWorkflow(template, { NUM: 42, ARR: ['37', 0], STR: 'x' });
    expect(rendered['1']?.inputs).toEqual({ n: 42, arr: ['37', 0], s: 'x' });
  });

  it('规则2：未提供的键**删掉**（这是"可选输入"的表达方式）', () => {
    const template: WorkflowTemplate = {
      '1': { class_type: 'A', inputs: { keep: '{{VALUE}}', drop: '{{MISSING}}' } },
    };
    expect(renderWorkflow(template, { VALUE: 1 })['1']?.inputs).toEqual({ keep: 1 });
  });

  it('规则3：`_dropWhenMissing` 命中 → **整个节点消失**（t2v 不该出现 LoadImage）', () => {
    const template: WorkflowTemplate = {
      '1': { class_type: 'A', inputs: {} },
      '56': { _dropWhenMissing: ['START_IMAGE_NAME'], class_type: 'LoadImage', inputs: { image: '{{START_IMAGE_NAME}}' } },
    };
    expect(Object.keys(renderWorkflow(template, {}))).toEqual(['1']);
    expect(Object.keys(renderWorkflow(template, { START_IMAGE_NAME: 'astrmira/x.png' }))).toEqual(['1', '56']);
  });

  it('下划线开头的键都是**元数据**，不会漏进 API prompt（否则 ComfyUI 直接拒）', () => {
    const template: WorkflowTemplate = {
      '1': { _dropWhenMissing: ['X'], _note: '说明', class_type: 'A', inputs: {} },
    };
    const rendered = renderWorkflow(template, { X: 1 });
    expect(Object.keys(rendered['1'] as object).sort()).toEqual(['class_type', 'inputs']);
  });

  it('模板写坏（节点没有 class_type）→ 跳过该节点，不抛错（剩下的照样能用）', () => {
    const template: WorkflowTemplate = {
      '1': { class_type: 'A', inputs: {} },
      '2': { inputs: {} },
    };
    expect(Object.keys(renderWorkflow(template, {}))).toEqual(['1']);
  });

  it('内置模板本身可用：渲染后节点数与图结构完整（t2v / i2v 各一遍）', () => {
    const t2v = renderWorkflow(WAN22_TI2V_5B_TEMPLATE, {
      UNET_NAME: 'u',
      CLIP_NAME: 'c',
      CLIP_TYPE: 'wan',
      VAE_NAME: 'v',
      WEIGHT_DTYPE: 'fp8_e4m3fn',
      PROMPT: 'p',
      NEGATIVE_PROMPT: 'n',
      WIDTH: 832,
      HEIGHT: 480,
      FRAMES: 121,
      FPS: 24,
      SEED: 1,
      STEPS: 20,
      CFG: 5,
      SHIFT: 8,
      OUTPUT_PREFIX: 'astrmira/comfy',
      START_IMAGE_NAME: undefined,
      START_IMAGE: undefined,
    });
    expect(t2v['56']).toBeUndefined(); // t2v 没有 LoadImage
    expect(t2v['55']?.inputs['start_image']).toBeUndefined();
    expect(t2v['8']?.class_type).toBe('VAEDecodeTiled'); // 分块解码是硬要求

    const i2v = renderWorkflow(WAN22_TI2V_5B_TEMPLATE, {
      START_IMAGE_NAME: 'astrmira/x.png',
      START_IMAGE: ['56', 0],
    });
    expect(i2v['56']?.class_type).toBe('LoadImage');
    expect(i2v['55']?.inputs['start_image']).toEqual(['56', 0]);
  });
});

describe('loadWorkflowTemplate · 从哪拿模板', () => {
  it('没配目录 → 内置（并把来源说出来）', () => {
    const loaded = loadWorkflowTemplate({} as NodeJS.ProcessEnv);
    expect(loaded.template).toBe(WAN22_TI2V_5B_TEMPLATE);
    expect(loaded.source).toContain(COMFYUI_DEFAULT_TEMPLATE_NAME);
  });

  it('配了目录 → 读 `<name>.api.json`（**这就是"换模型不改代码"的入口**）', () => {
    const dir = tempDir();
    const custom: WorkflowTemplate = { '1': { class_type: 'MyNode', inputs: { text: '{{PROMPT}}' } } };
    writeFileSync(path.join(dir, 'my-model.api.json'), JSON.stringify(custom), 'utf8');

    const loaded = loadWorkflowTemplate({
      COMFYUI_TEMPLATE_DIR: dir,
      COMFYUI_TEMPLATE: 'my-model',
    } as NodeJS.ProcessEnv);

    expect(loaded.template).toEqual(custom);
    expect(loaded.source).toContain('my-model.api.json');
  });

  it('配了目录但没配名字 → 用默认名找（少写一个 env 也能跑）', () => {
    const dir = tempDir();
    writeFileSync(
      path.join(dir, `${COMFYUI_DEFAULT_TEMPLATE_NAME}.api.json`),
      JSON.stringify({ '1': { class_type: 'X', inputs: {} } }),
      'utf8',
    );
    expect(loadWorkflowTemplate({ COMFYUI_TEMPLATE_DIR: dir } as NodeJS.ProcessEnv).template).toEqual({
      '1': { class_type: 'X', inputs: {} },
    });
  });

  it('**读不到就抛错，绝不回落内置**（回落会让用户以为自己的模板生效了）', () => {
    const dir = tempDir();
    expect(() =>
      loadWorkflowTemplate({ COMFYUI_TEMPLATE_DIR: dir, COMFYUI_TEMPLATE: 'nope' } as NodeJS.ProcessEnv),
    ).toThrow(/读不到工作流模板/);
  });

  it('非法 JSON → 抛错并带上文件路径', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'broken.api.json'), '{ not json', 'utf8');
    expect(() =>
      loadWorkflowTemplate({ COMFYUI_TEMPLATE_DIR: dir, COMFYUI_TEMPLATE: 'broken' } as NodeJS.ProcessEnv),
    ).toThrow(/不是合法 JSON/);
  });

  it('形状不对（不是"节点 id → { class_type, inputs }"）→ 抛错并提示怎么导出', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'ui-format.api.json'), JSON.stringify({ nodes: [], links: [] }), 'utf8');
    expect(() =>
      loadWorkflowTemplate({ COMFYUI_TEMPLATE_DIR: dir, COMFYUI_TEMPLATE: 'ui-format' } as NodeJS.ProcessEnv),
    ).toThrow(/另存为 API 格式/);
  });

  it('isWorkflowTemplate：空对象 / 数组 / 缺 class_type 都判否', () => {
    expect(isWorkflowTemplate({})).toBe(false);
    expect(isWorkflowTemplate([])).toBe(false);
    expect(isWorkflowTemplate({ '1': { inputs: {} } })).toBe(false);
    expect(isWorkflowTemplate({ '1': { class_type: 'X', inputs: {} } })).toBe(true);
  });
});
