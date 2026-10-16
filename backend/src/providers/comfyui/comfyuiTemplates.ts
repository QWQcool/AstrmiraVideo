import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
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
 * | `COMFYUI_TEMPLATE` | 模板名（**不含扩展名**，如 `wan22-ti2v-5b`）；未配 = 用内置 |
 * | `COMFYUI_TEMPLATE_DIR` | 模板目录（你自己的文件夹）；文件命名约定 `<name>.api.json` |
 *
 * ## 两个文件（V2.39）
 * | 文件 | 作用 | 缺省 |
 * |---|---|---|
 * | `<name>.api.json` | 节点图（ComfyUI「另存为 API 格式」原样放） | 配了目录就必须有 |
 * | `<name>.meta.json` | **可选**的能力声明（`modes` / `modelMatch` / `notes`） | 没有 = 回落文件名启发式 |
 *
 * ## 为什么"配了但读不出来"必须**抛错**，而不是回落内置
 * 回落会让用户**以为自己的模板生效了** —— 于是他改了半天节点图、跑出来的还是内置那张，
 * 而界面上一切正常。这正是本仓铁律「不静默降级」要挡的东西：宁可起不来（日志里一行说清），
 * 也不要"看起来能跑、跑的不是你以为的东西"。
 *
 * ## 为什么内置模板是 TS 常量而不是仓库里的 .json
 * `tsc` 不会把 `.json` 拷进 `dist/`（那要额外改构建与部署链路）。内置的用常量**零风险**，
 * 而"用户放自己的模板"走 `COMFYUI_TEMPLATE_DIR`（运行时读文件）—— 这条路才是外置的价值所在。
 */

export const COMFYUI_DEFAULT_TEMPLATE_NAME = 'wan22-ti2v-5b';

export interface LoadedTemplate {
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

/**
 * 取工作流模板（V2.33 外置；V2.36 加 `nameOverride` = **实例级模板**）。
 *
 * 为什么需要实例级：多台引擎往往跑**不同模型**（3080 跑 Wan2.2、5090 跑 LTX），
 * 而"不同模型 = 不同的节点图" —— 一份全局模板压不住两台机器（§19-1 / §19-3）。
 */
export function loadWorkflowTemplate(
  env: NodeJS.ProcessEnv = process.env,
  nameOverride?: string,
): LoadedTemplate {
  const name = (nameOverride ?? env.COMFYUI_TEMPLATE)?.trim();
  const dir = env.COMFYUI_TEMPLATE_DIR?.trim();

  if (dir === undefined || dir === '') {
    return {
      template: WAN22_TI2V_5B_TEMPLATE,
      source: `内置 ${COMFYUI_DEFAULT_TEMPLATE_NAME}`,
      // 内置模板自带声明（V2.39）：把现状写实 —— 那张图确实只有 t2v / i2v 两种用法
      declaration: WAN22_TI2V_5B_DECLARATION,
    };
  }

  const templateName = name === undefined || name === '' ? COMFYUI_DEFAULT_TEMPLATE_NAME : name;
  const file = path.join(dir, `${templateName}.api.json`);

  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      `读不到工作流模板 ${file}（COMFYUI_TEMPLATE_DIR=${dir} / COMFYUI_TEMPLATE=${templateName}）：` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`工作流模板不是合法 JSON：${file} —— ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isWorkflowTemplate(parsed)) {
    throw new Error(
      `工作流模板形状不对：${file}（需要"节点 id → { class_type, inputs }"的 API 格式；` +
        '在 ComfyUI 里用「另存为 API 格式」导出）',
    );
  }

  // V2.39：sidecar 声明（缺省合法；坏了抛错 —— 见 loadTemplateDeclaration 的三段口径）
  const declaration = loadTemplateDeclaration(dir, templateName);
  return { template: parsed, source: file, ...(declaration === undefined ? {} : { declaration }) };
}
