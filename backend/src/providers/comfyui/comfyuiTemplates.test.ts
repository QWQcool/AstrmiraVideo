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
  COMFYUI_IMAGE_REF_TEMPLATE_NAME,
  COMFYUI_IMAGE_TEMPLATE_NAME,
  isWorkflowTemplate,
  loadWorkflowTemplate,
  loadWorkflowTemplates,
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

  it('**空目录 → 抛错**（不静默回落内置：那会让用户以为自己的模板生效了）', () => {
    const dir = tempDir();
    expect(() =>
      loadWorkflowTemplate({ COMFYUI_TEMPLATE_DIR: dir, COMFYUI_TEMPLATE: 'nope' } as NodeJS.ProcessEnv),
    ).toThrow(/模板目录里没有/);
  });

  it('**指定了目录里没有的模板名 → 抛错**（并列出目录里有什么）', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }), 'utf8');
    expect(() =>
      loadWorkflowTemplate({ COMFYUI_TEMPLATE_DIR: dir, COMFYUI_TEMPLATE: 'nope' } as NodeJS.ProcessEnv),
    ).toThrow(/在目录里找不到/);
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

  it('内置模板带**内置声明**（V2.39：默认配置下"声明优先"这条路径也真的走一遍）', () => {
    const loaded = loadWorkflowTemplate({} as NodeJS.ProcessEnv);
    expect(loaded.declaration?.modes).toEqual(['t2v', 'i2v']);
  });

  it('sidecar 声明被读出来（`<name>.meta.json`：modes + modelMatch + label + notes）', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'h3.api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }), 'utf8');
    writeFileSync(
      path.join(dir, 'h3.meta.json'),
      JSON.stringify({
        modes: ['t2v', 'i2v', 'fl2v'],
        modelMatch: { unet: 'minimax_h3', clip: 'qwen3vl' },
        label: 'MiniMax H3',
        notes: '一个模型支持多种用法',
      }),
      'utf8',
    );

    const loaded = loadWorkflowTemplate({
      COMFYUI_TEMPLATE_DIR: dir,
      COMFYUI_TEMPLATE: 'h3',
    } as NodeJS.ProcessEnv);

    expect(loaded.declaration).toEqual({
      modes: ['t2v', 'i2v', 'fl2v'],
      modelMatch: { unet: 'minimax_h3', clip: 'qwen3vl' },
      label: 'MiniMax H3',
      notes: '一个模型支持多种用法',
    });
  });

  it('**没有 sidecar = 合法**（老模板照旧走文件名启发式，不报错）', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'plain.api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }), 'utf8');
    const loaded = loadWorkflowTemplate({
      COMFYUI_TEMPLATE_DIR: dir,
      COMFYUI_TEMPLATE: 'plain',
    } as NodeJS.ProcessEnv);
    expect(loaded.declaration).toBeUndefined();
  });

  it('sidecar **坏了就抛错**（不静默回落 —— 那会让用户以为自己的声明生效了）', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'badmeta.api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }), 'utf8');
    writeFileSync(path.join(dir, 'badmeta.meta.json'), '{ oops', 'utf8');
    expect(() =>
      loadWorkflowTemplate({ COMFYUI_TEMPLATE_DIR: dir, COMFYUI_TEMPLATE: 'badmeta' } as NodeJS.ProcessEnv),
    ).toThrow(/sidecar 不是合法 JSON/);
  });

  it('sidecar 里 `modes` 写了不认识的值 → 抛错（并列出合法值）', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'badmode.api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }), 'utf8');
    writeFileSync(path.join(dir, 'badmode.meta.json'), JSON.stringify({ modes: ['t2v', 'txt2vid'] }), 'utf8');
    expect(() =>
      loadWorkflowTemplate({ COMFYUI_TEMPLATE_DIR: dir, COMFYUI_TEMPLATE: 'badmode' } as NodeJS.ProcessEnv),
    ).toThrow(/不认识的值/);
  });

  it('isWorkflowTemplate：空对象 / 数组 / 缺 class_type 都判否', () => {
    expect(isWorkflowTemplate({})).toBe(false);
    expect(isWorkflowTemplate([])).toBe(false);
    expect(isWorkflowTemplate({ '1': { inputs: {} } })).toBe(false);
    expect(isWorkflowTemplate({ '1': { class_type: 'X', inputs: {} } })).toBe(true);
  });
});

/**
 * 清单式加载（V2.40）—— 一台 ComfyUI 同时装"视频模型"与"图片模型"是常态，
 * 而一套模型 = 一张节点图，所以模板必须是**清单**（每份各自声明能做什么）。
 */
describe('loadWorkflowTemplates · 清单', () => {
  it('零配置 → **三份内置**（视频 + 图片 + 参考图变体），defaultIndex 指向视频那份', () => {
    const loaded = loadWorkflowTemplates({} as NodeJS.ProcessEnv);
    expect(loaded.templates.map((item) => item.name)).toEqual([
      COMFYUI_DEFAULT_TEMPLATE_NAME,
      COMFYUI_IMAGE_TEMPLATE_NAME,
      COMFYUI_IMAGE_REF_TEMPLATE_NAME,
    ]);
    expect(loaded.defaultIndex).toBe(0);
    // 图片那份的声明必须写着 t2i（否则能力位不会亮）
    expect(loaded.templates[1]?.declaration?.modes).toEqual(['t2i']);
    // S9-A1：参考图变体也声明 t2i，且带 referenceImage 标志（provider 挑模板的依据）
    expect(loaded.templates[2]?.declaration?.modes).toEqual(['t2i']);
    expect(loaded.templates[2]?.declaration?.referenceImage).toBe(true);
  });

  it('目录里每份 `<name>.api.json` 各成一条（**加一份模板 = 多一种能力**）', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }), 'utf8');
    writeFileSync(path.join(dir, 'b.api.json'), JSON.stringify({ '2': { class_type: 'Y', inputs: {} } }), 'utf8');

    const loaded = loadWorkflowTemplates({ COMFYUI_TEMPLATE_DIR: dir } as NodeJS.ProcessEnv);
    expect(loaded.templates.map((item) => item.name)).toEqual(['a', 'b']);
    expect(loaded.defaultIndex).toBe(0);
  });

  it('`COMFYUI_TEMPLATE` 决定 defaultIndex（多份都能跑同一模式时优先它）', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }), 'utf8');
    writeFileSync(path.join(dir, 'b.api.json'), JSON.stringify({ '2': { class_type: 'Y', inputs: {} } }), 'utf8');

    const loaded = loadWorkflowTemplates({
      COMFYUI_TEMPLATE_DIR: dir,
      COMFYUI_TEMPLATE: 'b',
    } as NodeJS.ProcessEnv);
    expect(loaded.defaultIndex).toBe(1);
  });

  it('没配目录时指定了非内置名 → 抛错（只能选内置的那几份，且如实列出）', () => {
    expect(() =>
      loadWorkflowTemplates({ COMFYUI_TEMPLATE: 'my-own-template' } as NodeJS.ProcessEnv),
    ).toThrow(/只能用内置模板/);
  });

  it('配了目录就不再叠加内置（与 V2.33 起的既有行为一致）', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'only.api.json'), JSON.stringify({ '1': { class_type: 'X', inputs: {} } }), 'utf8');
    const loaded = loadWorkflowTemplates({ COMFYUI_TEMPLATE_DIR: dir } as NodeJS.ProcessEnv);
    expect(loaded.templates.map((item) => item.name)).toEqual(['only']);
  });
});
