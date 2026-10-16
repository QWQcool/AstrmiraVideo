import { describe, expect, it } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';
import {
  alignDimension,
  alignFrames,
  buildComfyWorkflow,
  comfyCapabilities,
  comfyViewPath,
  COMFY_DEFAULT_TUNING,
  COMFY_MAX_PIXELS,
  describeComfySubmissionError,
  FLUX2_KLEIN_T2I_DECLARATION,
  FLUX2_KLEIN_T2I_TEMPLATE,
  parseComfyOutputs,
  parseTemplateDeclaration,
  pickComfyImageArtifact,
  pickComfyModels,
  pickComfyVideoArtifact,
  planComfyDimensions,
  planComfyFrames,
  resolveComfyTuning,
  templateNodeTypes,
  templatePlaceholders,
  WAN22_TI2V_5B_DECLARATION,
  WAN22_TI2V_5B_TEMPLATE,
  type ComfyModels,
  type WorkflowTemplate,
} from './comfyuiProtocol.js';

/**
 * ComfyUI 对接协议（CONTRACT §19 / A1 片 B）单测。
 *
 * 这里钉的都是**真机实测出来的约束**（V8.34 / V8.35），每一条写错的后果都不是"不好看"，
 * 而是"在 10GB 卡上慢 6 倍"或"提交被上游拒"：
 * - 尺寸必须 32 的倍数、帧数必须 `4n+1`（Wan 的要求）；
 * - 解码必须 `VAEDecodeTiled`（整段解码会退化成 CPU，实测 >14 分钟）；
 * - 权重精度默认 fp8（fp16 放不下 10GB 显存）；
 * - 产物必须落 `astrmira/` 子目录（那台 ComfyUI 的 output 与别的项目共用）。
 */

/** `/object_info` 的真实形状（从 958 节点的实际响应裁剪而来，字段名一字不改） */
function objectInfo(overrides: { unet?: string[]; nodeMissing?: string } = {}): unknown {
  const unet = overrides.unet ?? ['wan2.2_ti2v_5B_fp16.safetensors'];
  const info: Record<string, unknown> = {
    UNETLoader: {
      input: {
        required: {
          unet_name: [unet],
          weight_dtype: [['default', 'fp8_e4m3fn', 'fp8_e4m3fn_fast', 'fp8_e5m2'], { advanced: true }],
        },
      },
    },
    CLIPLoader: {
      input: {
        required: {
          clip_name: [['umt5_xxl_fp8_e4m3fn_scaled.safetensors']],
          type: [['stable_diffusion', 'wan', 'ltxv']],
        },
      },
    },
    VAELoader: { input: { required: { vae_name: [['wan2.2_vae.safetensors', 'taesd']] } } },
  };
  // V2.33：能力位按**模板引用的节点**判定，所以 fixture 必须像真机一样"该有的都有" ——
  // 动态补全（改模板不必改这里）
  for (const type of templateNodeTypes(WAN22_TI2V_5B_TEMPLATE)) {
    if (info[type] === undefined) info[type] = { input: { required: {} } };
  }
  if (overrides.nodeMissing !== undefined) delete info[overrides.nodeMissing];
  return info;
}

const MODELS: ComfyModels = {
  unet: 'wan2.2_ti2v_5B_fp16.safetensors',
  clip: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  clipType: 'wan',
  vae: 'wan2.2_vae.safetensors',
};

function request(overrides: Partial<VideoGenerateRequest> = {}): VideoGenerateRequest {
  return { prompt: '雨夜街角', mode: 't2v', aspectRatio: '16:9', provider: 'host-comfyui', ...overrides };
}

describe('ComfyUI 协议 · 模型挑选与能力位', () => {
  it('从 /object_info 的枚举里挑模型（优先 ti2v / umt5 / wan）', () => {
    const models = pickComfyModels(objectInfo({ unet: ['other.safetensors', 'wan2.2_ti2v_5B_fp16.safetensors'] }));
    expect(models.unet).toBe('wan2.2_ti2v_5B_fp16.safetensors');
    expect(models.clip).toBe('umt5_xxl_fp8_e4m3fn_scaled.safetensors');
    expect(models.clipType).toBe('wan');
    expect(models.vae).toBe('wan2.2_vae.safetensors');
  });

  it('TI2V 模型 → 同时支持 t2v 与 i2v（同一个模型两种用法）', () => {
    const caps = comfyCapabilities(objectInfo(), MODELS);
    expect(caps.modes).toEqual(['t2v', 'i2v']);
    expect(caps.hasTiledDecode).toBe(true);
  });

  it('纯 I2V 模型 → 只支持 i2v，并说清为什么没有 t2v', () => {
    const caps = comfyCapabilities(objectInfo({ unet: ['wan2.2_i2v_14B_fp8.safetensors'] }), {
      ...MODELS,
      unet: 'wan2.2_i2v_14B_fp8.safetensors',
    });
    expect(caps.modes).toEqual(['i2v']);
    expect(caps.unavailableReasons.join('')).toContain('只做图生视频');
  });

  it('缺 VAEDecodeTiled → **一个模式都不给**（10GB 卡上整段解码不可用，不许假装能跑）', () => {
    const caps = comfyCapabilities(objectInfo({ nodeMissing: 'VAEDecodeTiled' }), MODELS);
    expect(caps.modes).toEqual([]);
    expect(caps.unavailableReasons.join('')).toContain('VAEDecodeTiled');
  });

  it('fl2v / v2v 一律不在能力位里（需要另外的模型），且原因如实写着', () => {
    const caps = comfyCapabilities(objectInfo(), MODELS);
    expect(caps.modes).not.toContain('v2v');
    expect(caps.modes).not.toContain('fl2v');
    expect(caps.unavailableReasons.join('')).toContain('FLF2V');
  });
});

/**
 * 模板声明（V2.39 / CONTRACT §19-2、§19-3）—— 这组回答"**换模型不改代码**"能不能真的成立。
 *
 * 缘由（真机事实）：MiniMax H3 一个模型同时支持 t2v / i2v / 首尾帧 / 多参考 / 音频，
 * 而它的文件名里**既没有 `ti2v` 也不含 `i2v`** —— 原先"按文件名猜"必然判错（还不容易被发现）。
 */
describe('ComfyUI 协议 · 模板声明（V2.39）', () => {
  /** H3 风格的文件名（刻意不含 ti2v / i2v：这就是"猜文件名"会翻车的样本） */
  const H3_MODELS: ComfyModels = {
    unet: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
    clip: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
    clipType: 'minimax',
    vae: 'minimax_h3_video_vae_fp16.safetensors',
  };

  it('**先钉住旧行为**：没有声明时，H3 的文件名会被判成"按文生视频用，需要确认"', () => {
    const caps = comfyCapabilities(objectInfo(), H3_MODELS);
    expect(caps.modes).toEqual(['t2v']);
    expect(caps.unavailableReasons.join('')).toContain('需要确认');
  });

  it('有声明 → 按声明给模式（H3 那种文件名也能判对）；**判定依据单独给**、不混进"不支持"', () => {
    const caps = comfyCapabilities(objectInfo(), H3_MODELS, WAN22_TI2V_5B_TEMPLATE, {
      modes: ['t2v', 'i2v'],
    });
    expect(caps.modes).toEqual(['t2v', 'i2v']);
    expect(caps.declarationNote).toContain('判定依据：模板声明');
    // ⚠️ 回归线（实测踩到过）：判定依据**不能**出现在 unavailableReasons 里 ——
    // 那会让自检结论读成"支持 t2v / i2v；不支持 判定依据：模板声明……"（语义变形）
    expect(caps.unavailableReasons.join('')).not.toContain('判定依据');
    expect(caps.unavailableReasons.join('')).not.toContain('模板声明');
  });

  it('声明路径下"**不支持什么**"仍然说清（本仓未接线的模式 + 本模板未声明的模式）', () => {
    const caps = comfyCapabilities(objectInfo(), H3_MODELS, WAN22_TI2V_5B_TEMPLATE, {
      modes: ['t2v'],
    });
    const reasons = caps.unavailableReasons.join('；');
    expect(reasons).toContain('fl2v / v2v'); // 本仓未接线（与模板无关）
    expect(reasons).toContain('没有声明 i2v'); // 这份模板没声明
  });

  it('声明里的 **fl2v / v2v 被如实剔除**（本仓还没接首尾帧 / 参考视频的输入通道）', () => {
    const caps = comfyCapabilities(objectInfo(), H3_MODELS, WAN22_TI2V_5B_TEMPLATE, {
      modes: ['t2v', 'i2v', 'fl2v', 'v2v'],
    });
    expect(caps.modes).toEqual(['t2v', 'i2v']);
    const reasons = caps.unavailableReasons.join('');
    expect(reasons).toContain('fl2v');
    expect(reasons).toContain('§19-8');
  });

  it('声明 `i2v` 但模板里**没有首帧占位** → 该模式被剔除（不报假可用）', () => {
    const noStart: WorkflowTemplate = {
      '1': { class_type: 'KSampler', inputs: { seed: '{{SEED}}' } },
    };
    const info = { KSampler: { input: { required: {} } } };
    const caps = comfyCapabilities(info, MODELS, noStart, { modes: ['i2v'] });
    expect(caps.modes).toEqual([]);
    expect(caps.unavailableReasons.join('')).toContain('START_IMAGE');
  });

  it('**没有**声明时的判定与 V2.38 一字不差（老模板行为不变）', () => {
    expect(comfyCapabilities(objectInfo(), MODELS).modes).toEqual(['t2v', 'i2v']);
    expect(comfyCapabilities(objectInfo(), MODELS).unavailableReasons.join('')).toContain('FLF2V');

    const onlyI2v = comfyCapabilities(objectInfo({ unet: ['wan2.2_i2v_14B_fp8.safetensors'] }), {
      ...MODELS,
      unet: 'wan2.2_i2v_14B_fp8.safetensors',
    });
    expect(onlyI2v.modes).toEqual(['i2v']);
    expect(onlyI2v.unavailableReasons.join('')).toContain('只做图生视频');
  });

  it('声明解析：形状不对就抛错（不认识的值 / 缺 modes / 空的 modelMatch 值）', () => {
    expect(() => parseTemplateDeclaration(null)).toThrow(/JSON 对象/);
    expect(() => parseTemplateDeclaration({})).toThrow(/modes/);
    expect(() => parseTemplateDeclaration({ modes: ['t2v', 'txt2vid'] })).toThrow(/不认识的值/);
    expect(() => parseTemplateDeclaration({ modes: ['t2v'], modelMatch: { unet: '   ' } })).toThrow(
      /modelMatch/,
    );
  });

  it('声明解析：重复声明**去重保序**、可选字段缺省时不占键', () => {
    expect(parseTemplateDeclaration({ modes: ['i2v', 't2v', 'i2v'] })).toEqual({ modes: ['i2v', 't2v'] });
    expect(parseTemplateDeclaration({ modes: ['t2v'], notes: '   ' })).toEqual({ modes: ['t2v'] });
  });

  it('模型挑选：声明关键词**优先于**内置关键词（H3 的文件名靠它挑对文件）', () => {
    const info = objectInfo({
      unet: ['wan2.2_ti2v_5B_fp16.safetensors', 'minimax_h3_fl2va_pruned_int8_convrot.safetensors'],
    });
    expect(pickComfyModels(info).unet).toBe('wan2.2_ti2v_5B_fp16.safetensors');
    expect(
      pickComfyModels(info, undefined, { modes: ['t2v'], modelMatch: { unet: 'minimax_h3' } }).unet,
    ).toBe('minimax_h3_fl2va_pruned_int8_convrot.safetensors');
  });

  it('占位符提取：**内嵌在数组 / 对象里的也算**，连线里的裸值不算（`["37", 0]`）', () => {
    const tpl: WorkflowTemplate = {
      '1': {
        class_type: 'X',
        inputs: { ref: ['37', 0], text: '{{PROMPT}}', nested: { deep: ['{{SEED}}'] } },
      },
    };
    expect([...templatePlaceholders(tpl)].sort()).toEqual(['PROMPT', 'SEED']);

    // 内置模板：首帧的两个占位符都在（能力位判 i2v 时正靠它们）
    const builtin = templatePlaceholders(WAN22_TI2V_5B_TEMPLATE);
    expect(builtin.has('START_IMAGE')).toBe(true);
    expect(builtin.has('START_IMAGE_NAME')).toBe(true);
  });

  it('内置模板的声明把**现状**写实（t2v + i2v，且模型关键词与启发式一致）', () => {
    expect(WAN22_TI2V_5B_DECLARATION.modes).toEqual(['t2v', 'i2v']);
    expect(WAN22_TI2V_5B_DECLARATION.modelMatch).toEqual({ unet: 'ti2v', clip: 'umt5', vae: 'wan' });
  });
});

/**
 * 文生图（`t2i`，V2.40）—— 一台 ComfyUI 同时装视频与图片模型时，
 * "哪份模板能跑哪个模式"必须由**模板自己的声明**回答，而不是靠模型文件名的巧合。
 */
describe('ComfyUI 协议 · 文生图（t2i）', () => {
  /** `/object_info` 的 FLUX 版（按图片模板动态补节点，与视频版的 fixture 同理） */
  function fluxObjectInfo(overrides: { unet?: string[] } = {}): unknown {
    const info: Record<string, unknown> = {
      UNETLoader: {
        input: {
          required: {
            unet_name: [overrides.unet ?? ['flux-2-klein-4b.safetensors']],
            weight_dtype: [['default', 'fp8_e4m3fn'], { advanced: true }],
          },
        },
      },
      CLIPLoader: {
        input: { required: { clip_name: [['qwen_3_4b.safetensors']], type: [['flux2', 'wan']] } },
      },
      VAELoader: { input: { required: { vae_name: [['flux2-vae.safetensors']] } } },
    };
    for (const type of templateNodeTypes(FLUX2_KLEIN_T2I_TEMPLATE)) {
      if (info[type] === undefined) info[type] = { input: { required: {} } };
    }
    return info;
  }

  it('内置图片模板：声明只有 t2i，且**不需要分块解码**（那是视频模板的要求）', () => {
    expect(FLUX2_KLEIN_T2I_DECLARATION.modes).toEqual(['t2i']);
    expect(FLUX2_KLEIN_T2I_DECLARATION.modelMatch?.unet).toBe('klein');
    const types = templateNodeTypes(FLUX2_KLEIN_T2I_TEMPLATE);
    expect(types).toContain('EmptyFlux2LatentImage');
    expect(types).toContain('SaveImage');
    expect(types).not.toContain('VAEDecodeTiled');
  });

  it('模型命中（候选里有 klein）→ 图片模板给 t2i', () => {
    const info = fluxObjectInfo();
    const models = pickComfyModels(info, undefined, FLUX2_KLEIN_T2I_DECLARATION);
    expect(models.unet).toBe('flux-2-klein-4b.safetensors');
    const caps = comfyCapabilities(info, models, FLUX2_KLEIN_T2I_TEMPLATE, FLUX2_KLEIN_T2I_DECLARATION);
    expect(caps.modes).toEqual(['t2i']);
  });

  it('模型**没命中** → 该模板如实不可用（不拿别的模型硬跑），原因里点出要什么', () => {
    const info = fluxObjectInfo({ unet: ['wan2.2_ti2v_5B_fp16.safetensors'] });
    const models = pickComfyModels(info, undefined, FLUX2_KLEIN_T2I_DECLARATION);
    const caps = comfyCapabilities(info, models, FLUX2_KLEIN_T2I_TEMPLATE, FLUX2_KLEIN_T2I_DECLARATION);
    expect(caps.modes).toEqual([]);
    expect(caps.unavailableReasons.join('')).toContain('klein');
  });

  it('t2i 走**图片尺寸档**（1024 系），不是视频的 480p 档', () => {
    const square = planComfyDimensions(
      request({ mode: 't2i', aspectRatio: '1:1' }),
    );
    expect(square).toMatchObject({ width: 1024, height: 1024 });
    expect(square.warnings).toEqual([]);

    const wide = planComfyDimensions(request({ mode: 't2i', aspectRatio: '16:9' }));
    expect(wide).toMatchObject({ width: 1024, height: 576 });
  });

  it('图片产物挑选：**只认图片容器**（mp4 不会被当图片）', () => {
    expect(
      pickComfyImageArtifact([{ filename: 'a.mp4', subfolder: 'astrmira', type: 'output' }]),
    ).toBeUndefined();
    expect(
      pickComfyImageArtifact([
        { filename: 'a.mp4', subfolder: 'astrmira', type: 'output' },
        { filename: 'a_00001_.png', subfolder: 'astrmira', type: 'output' },
      ]),
    ).toMatchObject({ filename: 'a_00001_.png' });
  });
});

describe('ComfyUI 协议 · 参数映射（真机约束）', () => {
  it('尺寸对齐 32（Wan22 节点的 step=32）', () => {
    expect(alignDimension(830)).toBe(832);
    expect(alignDimension(10)).toBe(32); // 下限也是 32
    expect(alignDimension(480)).toBe(480);
  });

  it('帧数对齐 4n+1（Wan 的时序要求）：**取最近**，等距时向上', () => {
    expect(alignFrames(33)).toBe(33);
    expect(alignFrames(34)).toBe(33); // 更接近 33
    expect(alignFrames(36)).toBe(37); // 更接近 37
    expect(alignFrames(35)).toBe(37); // 等距 → 取上：宁可略长，不让成片比请求短一截
    expect(alignFrames(2)).toBe(5); // 最小值 5
  });

  it('5 秒 → 121 帧（与官方模板完全一致，不是巧合）', () => {
    expect(planComfyFrames(5)).toBe(121);
  });

  it('默认档按画幅给 480p（16:9 / 9:16 对调，1:1 取同一像素预算）', () => {
    expect(planComfyDimensions(request({ aspectRatio: '16:9' }))).toMatchObject({ width: 832, height: 480 });
    expect(planComfyDimensions(request({ aspectRatio: '9:16' }))).toMatchObject({ width: 480, height: 832 });
    const square = planComfyDimensions(request({ aspectRatio: '1:1' }));
    expect(square.width).toBe(square.height);
  });

  it('分辨率超上限 → 等比缩小**并如实告警**（不静默改参数，也不硬跑）', () => {
    const plan = planComfyDimensions(
      request({ resolution: { width: 1920, height: 1080 } }),
    );
    expect(plan.width * plan.height).toBeLessThanOrEqual(COMFY_MAX_PIXELS + 32 * 1080);
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0]).toContain('等比缩小');
  });

  it('用户明确给的尺寸在预算内 → 原样使用（对齐 32 后）', () => {
    const plan = planComfyDimensions(request({ resolution: { width: 704, height: 480 } }));
    expect(plan).toMatchObject({ width: 704, height: 480 });
    expect(plan.warnings).toEqual([]);
  });
});

/**
 * 档位可配（V2.32）—— 这一组是"**换硬件只改 env**"那条承诺的钉子。
 * 默认值是 10GB 卡实测出来的，但 5090 之类不该等我们发版才能跑 720p。
 */
describe('ComfyUI 协议 · 档位解析（env）', () => {
  it('什么都不配 → 全用默认（20 步 / cfg 5 / shift 8 / fps 24 / fp8）', () => {
    const tuning = resolveComfyTuning({} as NodeJS.ProcessEnv);
    expect(tuning).toMatchObject({
      maxPixels: COMFY_MAX_PIXELS,
      steps: 20,
      cfg: 5,
      shift: 8,
      fps: 24,
      dtype: 'fp8_e4m3fn',
    });
  });

  it('env 能覆盖每一项（这就是"换卡/换机器只改 env"的落点）', () => {
    const tuning = resolveComfyTuning({
      COMFYUI_MAX_PIXELS: '921600', // 1280×720
      COMFYUI_STEPS: '30',
      COMFYUI_CFG: '6.5',
      COMFYUI_SHIFT: '3',
      COMFYUI_FPS: '16',
      COMFYUI_WEIGHT_DTYPE: 'default',
    } as NodeJS.ProcessEnv);

    expect(tuning).toEqual({
      maxPixels: 921600,
      steps: 30,
      cfg: 6.5,
      shift: 3,
      fps: 16,
      dtype: 'default',
    });
  });

  it('非法值**回落到默认**（档位是"能用"的旋钮，不是"配错就起不来"的开关）', () => {
    const tuning = resolveComfyTuning({
      COMFYUI_MAX_PIXELS: 'abc',
      COMFYUI_STEPS: '-5',
      COMFYUI_CFG: '0',
      COMFYUI_SHIFT: '',
      COMFYUI_FPS: 'NaN',
      COMFYUI_WEIGHT_DTYPE: '   ',
    } as NodeJS.ProcessEnv);

    expect(tuning).toEqual(COMFY_DEFAULT_TUNING);
  });

  it('像素预算真的能放开：同一个 720p 请求，10GB 档被缩、24GB 档原样', () => {
    // 用 1280×704（32 的倍数）；注意 1280×720 会被对齐成 1280×736 —— 那是另一个坑，
    // 所以"放开预算"这条用官方那档尺寸来钉
    const wanted = request({ resolution: { width: 1280, height: 704 } });

    const small = planComfyDimensions(wanted);
    expect(small.width).toBeLessThan(1280);
    expect(small.warnings.length).toBe(1);

    // 5090 那类卡：显式把预算调高 → 不再被 10GB 档的默认值误伤
    const big = planComfyDimensions(wanted, 1280 * 704);
    expect(big).toMatchObject({ width: 1280, height: 704 });
    expect(big.warnings).toEqual([]);
  });
});

describe('ComfyUI 协议 · 工作流组装', () => {
  const base = {
    models: MODELS,
    prompt: '雨夜街角',
    negativePrompt: '模糊',
    mode: 't2v' as const,
    width: 832,
    height: 480,
    frames: 121,
    seed: 42,
    dtype: 'fp8_e4m3fn',
    outputPrefix: 'astrmira/comfy',
  };

  it('**必须用 VAEDecodeTiled，不许用 VAEDecode**（10GB 卡上整段解码会退化成 CPU，实测 >14 分钟）', () => {
    const workflow = buildComfyWorkflow(base);
    expect(workflow['8']?.class_type).toBe('VAEDecodeTiled');
    expect(workflow['8']?.inputs['tile_size']).toBe(256);
    expect(Object.values(workflow).some((node) => node.class_type === 'VAEDecode')).toBe(false);
  });

  it('权重精度进 UNETLoader（默认 fp8 —— fp16 在 10GB 上慢 6.3 倍）', () => {
    const workflow = buildComfyWorkflow(base);
    expect(workflow['37']?.inputs['weight_dtype']).toBe('fp8_e4m3fn');
    expect(workflow['37']?.inputs['unet_name']).toBe(MODELS.unet);
  });

  it('采样档与官方模板一致（20 步 / cfg 5 / uni_pc / simple / shift 8 / fps 24）', () => {
    const workflow = buildComfyWorkflow(base);
    expect(workflow['3']?.inputs).toMatchObject({
      steps: 20,
      cfg: 5,
      sampler_name: 'uni_pc',
      scheduler: 'simple',
      denoise: 1,
      seed: 42,
    });
    expect(workflow['48']?.inputs['shift']).toBe(8);
    expect(workflow['57']?.inputs['fps']).toBe(24);
  });

  it('产物落 `astrmira/` 子目录（那台 ComfyUI 的 output 与别的项目共用）', () => {
    expect(buildComfyWorkflow(base)['58']?.inputs['filename_prefix']).toBe('astrmira/comfy');
  });

  it('t2v **不挂**首帧节点（同一个模型两种用法，区别只在有没有 start_image）', () => {
    const workflow = buildComfyWorkflow(base);
    expect(workflow['56']).toBeUndefined();
    expect(workflow['55']?.inputs['start_image']).toBeUndefined();
  });

  it('i2v 挂 LoadImage，且 start_image 指向它', () => {
    const workflow = buildComfyWorkflow({ ...base, mode: 'i2v', startImageName: 'astrmira/frame.png' });
    expect(workflow['56']).toMatchObject({
      class_type: 'LoadImage',
      inputs: { image: 'astrmira/frame.png' },
    });
    expect(workflow['55']?.inputs['start_image']).toEqual(['56', 0]);
  });
});

describe('ComfyUI 协议 · 产物与错误解析', () => {
  it('解析实测形状的 outputs（SaveVideo 把视频放在 images 数组里）', () => {
    const outputs = {
      '58': {
        images: [{ filename: 'x_00001_.mp4', subfolder: 'astrmira', type: 'output' }],
        animated: [true],
      },
    };
    expect(parseComfyOutputs(outputs)).toEqual([
      { filename: 'x_00001_.mp4', subfolder: 'astrmira', type: 'output' },
    ]);
  });

  it('不假设节点 id（用户换模板会变）—— 任何带 filename 的项都收', () => {
    const outputs = { '999': { gifs: [{ filename: 'a.mp4' }] } };
    expect(parseComfyOutputs(outputs)).toEqual([{ filename: 'a.mp4', subfolder: '', type: 'output' }]);
  });

  it('空 / 异常形状 → 空数组（调用方据此报"执行结束但没有产物"）', () => {
    expect(parseComfyOutputs(undefined)).toEqual([]);
    expect(parseComfyOutputs({ '58': {} })).toEqual([]);
    expect(parseComfyOutputs('nope')).toEqual([]);
  });

  it('/view 地址带全 filename + subfolder + type（少一个就取不到文件）', () => {
    const path = comfyViewPath({ filename: 'a b.mp4', subfolder: 'astrmira', type: 'output' });
    expect(path).toContain('filename=a+b.mp4');
    expect(path).toContain('subfolder=astrmira');
    expect(path).toContain('type=output');
  });

  it('提交被拒时**原样带出节点级错误**（只说"提交失败"用户无法行动）', () => {
    const message = describeComfySubmissionError({
      error: { type: 'invalid_prompt' },
      node_errors: { '38': { errors: [{ message: 'clip_name 不存在' }] } },
    });
    expect(message).toContain('节点 38');
    expect(message).toContain('clip_name 不存在');
  });

  it('没有节点级错误时退回 error.message，再退回到兜底文案', () => {
    expect(describeComfySubmissionError({ error: { message: '模型加载失败' } })).toContain('模型加载失败');
    expect(describeComfySubmissionError({})).toContain('未给出细节');
  });

  it('产物挑选：**视频优先**（H3 类模板可能同时输出视频 + 音频，先遇到哪个看节点 id）', () => {
    const wav = { filename: 'clip_00001_.wav', subfolder: 'astrmira', type: 'output' };
    const mp4 = { filename: 'clip_00001_.mp4', subfolder: 'astrmira', type: 'output' };
    expect(pickComfyVideoArtifact([wav, mp4])).toEqual(mp4);
    expect(pickComfyVideoArtifact([mp4, wav])).toEqual(mp4);
  });

  it('产物挑选：**只有音频 → undefined**（把音频写进 .mp4 是静默出错，宁可如实失败）', () => {
    expect(pickComfyVideoArtifact([{ filename: 'a.wav', subfolder: '', type: 'output' }])).toBeUndefined();
    expect(pickComfyVideoArtifact([])).toBeUndefined();
  });

  it('产物挑选：无扩展名 / 非音频非视频时保持"取第一个"的老行为（不改既有场景）', () => {
    const plain = { filename: 'noext', subfolder: '', type: 'output' };
    expect(pickComfyVideoArtifact([plain])).toEqual(plain);
    const bin = { filename: 'a.bin', subfolder: '', type: 'output' };
    expect(pickComfyVideoArtifact([bin, plain])).toEqual(bin);
  });
});
