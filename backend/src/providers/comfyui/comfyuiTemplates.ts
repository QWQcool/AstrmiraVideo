import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  FLUX2_KLEIN_T2I_DECLARATION,
  FLUX2_KLEIN_T2I_TEMPLATE,
  parseTemplateDeclaration,
  WAN22_TI2V_5B_DECLARATION,
  WAN22_TI2V_5B_TEMPLATE,
  type ComfyTemplateDeclaration,
  type WorkflowTemplate,
} from './comfyuiProtocol.js';

/**
 * 工作流模板的**加载**（V2.33 / CONTRACT §19-3）—— 纯逻辑在 `comfyuiProtocol.renderWorkflow`，
 * 这里只管"从哪拿到模板"。
 *
 * ## 两条 env
 * | env | 说明 |
 * |---|---|
 * | `COMFYUI_TEMPLATE` | 模板名（**不含扩展名**，如 `wan22-ti2v-5b`）；未配 = 用清单里第一份 |
 * | `COMFYUI_TEMPLATE_DIR` | 模板目录（你自己的文件夹）；文件命名约定 `<name>.api.json` |
 *
 * ## 两个文件（V2.39）
 * | 文件 | 作用 | 缺省 |
 * |---|---|---|
 * | `<name>.api.json` | 节点图（ComfyUI「另存为 API 格式」原样放） | 配了目录就必须有 |
 * | `<name>.meta.json` | **可选**的能力声明（`modes` / `modelMatch` / `notes`） | 没有 = 回落文件名启发式 |
 *
 * ## 为什么是**清单**而不是单份（V2.40）
 * 一台 ComfyUI 上同时装"视频模型（Wan）"与"图片模型（Flux）"是常态，而**一套模型 = 一张节点图**。
 * 单份模板逼用户"要么出视频要么出图"，所以改成清单：每份各自声明能力，
 * **按请求的 `mode` 挑那一份**（`defaultIndex` 只在"多份都能跑同一模式"时决定优先谁）。
 *
 * ## 为什么"配了但读不出来 / 指定了但找不到"必须**抛错**，而不是回落内置
 * 回落会让用户**以为自己的模板生效了** —— 于是他改了半天节点图、跑出来的还是内置那张，
 * 而界面上一切正常。这正是本仓铁律「不静默降级」要挡的东西：宁可起不来（日志里一行说清），
 * 也不要"看起来能跑、跑的不是你以为的东西"。
 *
 * ## 为什么内置模板是 TS 常量而不是仓库里的 .json
 * `tsc` 不会把 `.json` 拷进 `dist/`（那要额外改构建与部署链路）。内置的用常量**零风险**，
 * 而"用户放自己的模板"走 `COMFYUI_TEMPLATE_DIR`（运行时读文件）—— 这条路才是外置的价值所在。
 */

export const COMFYUI_DEFAULT_TEMPLATE_NAME = 'wan22-ti2v-5b';

/** 内置的图片模板名（V2.40） */
export const COMFYUI_IMAGE_TEMPLATE_NAME = 'flux2-klein-t2i';

export interface LoadedTemplate {
  /** 模板名（不含扩展名）：内置的用内置名，用户的用文件名 —— `COMFYUI_TEMPLATE` 按它匹配 */
  name: string;
  template: WorkflowTemplate;
  /** 模板从哪来（写进 `checkHealth().reason`，出问题时一眼知道跑的是哪张图） */
  source: string;
  /**
   * 模板**声明的能力**（V2.39；CONTRACT §19-3）。
   * 缺省 = 这套模板**没有**声明 → 能力位回落文件名启发式（老模板行为一字不变）。
   */
  declaration?: ComfyTemplateDeclaration;
}

/**
 * 读模板 sidecar（`<name>.meta.json`，与 `<name>.api.json` 同目录同名）。
 *
 * **三种情况刻意区分开**（与"模板读不出来不许静默回落"同一条铁律）：
 * - **文件不存在** → `undefined`：这是**合法**的（老模板没有声明，照旧走启发式）；
 * - **文件存在但读不出来 / 不是合法 JSON / 形状不对** → **抛错**：
 *   静默回落会让用户以为自己的声明生效了，而实际跑的还是启发式判定；
 * - 读得出来且合法 → 返回声明。
 *
 * 为什么用独立文件而不是把 `modes` 写进 `.api.json`：**重新导出会丢**——
 * 用户在 ComfyUI 里改完节点图再"另存为 API 格式"，写在模板里的声明会被覆盖掉，
 * 而那种丢失是静默的（能力位悄悄退回启发式）。独立文件不会被 ComfyUI 写到。
 */
export function loadTemplateDeclaration(
  dir: string,
  templateName: string,
): ComfyTemplateDeclaration | undefined {
  const file = path.join(dir, `${templateName}.meta.json`);
  if (!existsSync(file)) return undefined; // 没有声明 ≠ 配错

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      `读不到模板 sidecar ${file}：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `模板 sidecar 不是合法 JSON：${file} —— ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return parseTemplateDeclaration(parsed, `模板 sidecar ${file}`);
}

/** 粗校验：是对象、至少一个节点、每个节点都有 `class_type`（模板写坏了要早说） */
export function isWorkflowTemplate(value: unknown): value is WorkflowTemplate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const nodes = Object.values(value as Record<string, unknown>);
  if (nodes.length === 0) return false;
  return nodes.every((node) => {
    if (typeof node !== 'object' || node === null) return false;
    return typeof (node as Record<string, unknown>)['class_type'] === 'string';
  });
}

export interface LoadedTemplates {
  /** 模板清单（至少一份） */
  templates: LoadedTemplate[];
  /** `COMFYUI_TEMPLATE` 指定的那份在清单里的下标（未指定 = 0） */
  defaultIndex: number;
}

/**
 * 内置模板清单（V2.40）：**视频一份 + 图片一份** —— 零配置下两种能力都在。
 *
 * 为什么两份都内置：装了对应模型就能用，不必先抄一份模板出来。
 * 没装的那份会**如实不可用**（模型关键词命中不了 / 模板所需节点缺失），不会假装能跑。
 */
export const BUILTIN_TEMPLATES: readonly LoadedTemplate[] = [
  {
    name: COMFYUI_DEFAULT_TEMPLATE_NAME,
    template: WAN22_TI2V_5B_TEMPLATE,
    source: `内置 ${COMFYUI_DEFAULT_TEMPLATE_NAME}`,
    declaration: WAN22_TI2V_5B_DECLARATION,
  },
  {
    name: COMFYUI_IMAGE_TEMPLATE_NAME,
    template: FLUX2_KLEIN_T2I_TEMPLATE,
    source: `内置 ${COMFYUI_IMAGE_TEMPLATE_NAME}`,
    declaration: FLUX2_KLEIN_T2I_DECLARATION,
  },
];

/**
 * 取工作流模板**清单**（V2.40；V2.33 外置、V2.36 实例级模板的延续）。
 *
 * 三种情形：
 * 1. **没配 `COMFYUI_TEMPLATE_DIR`** → 用内置清单（视频 + 图片两份）；
 *    `COMFYUI_TEMPLATE` 指定内置名时按它排 `defaultIndex`，指了不存在的内置名 → **抛错**；
 * 2. **配了目录** → 扫 `<name>.api.json`（**每份一份模板**），坏文件立刻抛错；
 *    这是"**加一份模板 = 多一种能力**"的入口（例如放一份 LTX 的图进来）；
 * 3. 配了目录 + 指定 `COMFYUI_TEMPLATE` → 那份排到 `defaultIndex`；找不到 → **抛错**。
 *
 * ⚠️ **配了目录就不再叠加内置**（与 V2.33 起的既有行为一致）：那是"我要自己管模板"的意思。
 */
export function loadWorkflowTemplates(
  env: NodeJS.ProcessEnv = process.env,
  nameOverride?: string,
): LoadedTemplates {
  const requested = (nameOverride ?? env.COMFYUI_TEMPLATE)?.trim();
  const dir = env.COMFYUI_TEMPLATE_DIR?.trim();
  const hasRequest = requested !== undefined && requested !== '';

  if (dir === undefined || dir === '') {
    const found = hasRequest
      ? BUILTIN_TEMPLATES.findIndex((item) => item.name === requested)
      : 0;
    if (found < 0) {
      throw new Error(
        `没配 COMFYUI_TEMPLATE_DIR 时只能用内置模板（${BUILTIN_TEMPLATES.map((item) => item.name).join(' / ')}），` +
          `但 COMFYUI_TEMPLATE=${requested} —— 配了就得读出来，不静默回落`,
      );
    }
    return { templates: [...BUILTIN_TEMPLATES], defaultIndex: found };
  }

  return loadFromDir(dir, requested);
}

/** 扫目录加载（`<name>.api.json` 每份一条；任一坏文件立刻抛错） */
function loadFromDir(dir: string, requested: string | undefined): LoadedTemplates {
  let files: string[];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.api.json'));
  } catch (error) {
    throw new Error(
      `读不到模板目录 ${dir}（COMFYUI_TEMPLATE_DIR）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (files.length === 0) {
    throw new Error(
      `模板目录里没有 <name>.api.json：${dir}（在 ComfyUI 里用「另存为 API 格式」导出后放进来）`,
    );
  }

  const templates = files.sort().map((file) => loadOne(dir, file));
  const hasRequest = requested !== undefined && requested !== '';
  const found = hasRequest ? templates.findIndex((item) => item.name === requested) : 0;
  if (found < 0) {
    throw new Error(
      `COMFYUI_TEMPLATE=${requested} 在目录里找不到（目录里有：${templates.map((item) => item.name).join(' / ')}）` +
        ' —— 配了就得读出来，不静默回落',
    );
  }
  return { templates, defaultIndex: found };
}

function loadOne(dir: string, file: string): LoadedTemplate {
  const templateName = file.slice(0, -'.api.json'.length);
  const full = path.join(dir, file);

  let raw: string;
  try {
    raw = readFileSync(full, 'utf8');
  } catch (error) {
    throw new Error(
      `读不到工作流模板 ${full}（COMFYUI_TEMPLATE_DIR=${dir} / COMFYUI_TEMPLATE=${templateName}）：` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `工作流模板不是合法 JSON：${full} —— ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isWorkflowTemplate(parsed)) {
    throw new Error(
      `工作流模板形状不对：${full}（需要"节点 id → { class_type, inputs }"的 API 格式；` +
        '在 ComfyUI 里用「另存为 API 格式」导出）',
    );
  }

  // V2.39：sidecar 声明（缺省合法；坏了抛错 —— 见 loadTemplateDeclaration 的三段口径）
  const declaration = loadTemplateDeclaration(dir, templateName);
  return {
    name: templateName,
    template: parsed,
    source: full,
    ...(declaration === undefined ? {} : { declaration }),
  };
}

/**
 * 取**默认那一份**模板（V2.33 起就在的旧签名；V2.40 起只是清单的薄封装）。
 *
 * 保留它是因为调用点（与既有单测）只想问"默认跑的是哪张图" ——
 * 让每处都写一遍 `templates[defaultIndex]` 更容易写错。
 */
export function loadWorkflowTemplate(
  env: NodeJS.ProcessEnv = process.env,
  nameOverride?: string,
): LoadedTemplate {
  const { templates, defaultIndex } = loadWorkflowTemplates(env, nameOverride);
  const picked = templates[defaultIndex];
  if (picked === undefined) throw new Error('模板清单为空（不该发生：加载时已保证至少一份）');
  return picked;
}
