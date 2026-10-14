import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { COMFYUI_PROVIDER_PREFIX, COMFYUI_SERVER_NAME_PATTERN } from '@astrmira/shared';
import { isAllowedEngineUrl } from '../statusProbe.js';
import type { ComfyTuning } from './comfyuiProtocol.js';

/**
 * 本地 ComfyUI 的**实例表**（CONTRACT §19-1 / V2.36；台账 A1 后续）。
 *
 * ## 为什么需要它
 * 此前"本地 ComfyUI 只有一个地址"（`COMFYUI_BASE_URL`），而真实场景是**多台机器**：
 * 3080 跑 480p、5090 跑 720p，或者"公司一台 / 家里一台"。一份服务要给它们各自的结论
 * （各自是否可用、各自能否连上、各自用什么模板），就必须先把"有哪些实例"解析出来。
 *
 * ## 两种写法（可同时用）
 * - `COMFYUI_BASE_URL` → **默认实例**（provider id = `host-comfyui`，老部署零改动）；
 * - `COMFYUI_SERVERS_FILE` → 一份 JSON：`[{ name, label?, url, template?, …档位 }]`
 *   → 每个得到 `host-comfyui:<name>`。
 *
 * ## 三条纪律（与契约逐条对应）
 * 1. **白名单逐实例**：不合规的那一台只是**它自己**不可用（`available:false` + 人话原因），
 *    不影响其它实例 —— 这正是多实例相对"整块配置"的价值；
 * 2. **文件坏了不静默回落**：读不出来 / 结构不对 → 记为 `problems`（由调用方如实带出），
 *    **绝不**假装"只配了 `COMFYUI_BASE_URL`"（那会让人以为自己那几台生效了）；
 * 3. **非法档位值逐项忽略**（回落全局 env / 内置默认）：与 §19-3 既有的旋钮纪律一致 ——
 *    档位是"能用"的旋钮，不是"配错就起不来"的开关。
 *
 * ⚠️ 地址明文**存在本对象里**（provider 要用它去连），但 `/status` **不下发**它
 * （只给 id / label / available / reason）—— 脱敏纪律见 §2。
 */

/** 默认实例的 provider id（只配 `COMFYUI_BASE_URL` 时就是它） */
export const DEFAULT_COMFY_SERVER_ID = 'host-comfyui';

export interface ComfyUiServer {
  /** provider id：`host-comfyui`（default）或 `host-comfyui:<name>` */
  id: string;
  /** 实例名（id 的一部分；`default` 表示来自 `COMFYUI_BASE_URL` 的那一台） */
  name: string;
  /** 显示名（给人看；缺省 = name / 「默认引擎」） */
  label: string;
  /** 引擎地址（**不下发**；只给 provider 用） */
  url: string;
  /** 该实例的模板名（覆盖全局 `COMFYUI_TEMPLATE`；缺省 = 用全局） */
  template?: string;
  /** 该实例的档位覆盖（**逐项**覆盖全局 env；缺省项回落） */
  tuning?: Partial<ComfyTuning>;
  /** 这一台的配置事实：地址白名单过了没 */
  available: boolean;
  /** `available:false` 时的人话原因（**不回显地址明文**） */
  reason?: string;
}

export interface ResolvedComfyServers {
  servers: ComfyUiServer[];
  /** 实例文件级别的问题（读不出来 / 结构不对）—— 有它时调用方必须如实带出 */
  problems: string[];
}

/** 档位覆盖的合法字段（六项，与 §19-3 的表一一对应） */
const ServerEntrySchema = z
  .object({
    name: z.string().regex(COMFYUI_SERVER_NAME_PATTERN, 'name 限 [A-Za-z0-9_-]{1,24}'),
    label: z.string().min(1).max(40).optional(),
    url: z.string().min(1),
    template: z.string().min(1).max(80).optional(),
    maxPixels: z.number().positive().optional(),
    steps: z.number().int().positive().optional(),
    cfg: z.number().positive().optional(),
    shift: z.number().positive().optional(),
    fps: z.number().int().positive().optional(),
    dtype: z.string().min(1).max(40).optional(),
  })
  // strict：拼错的键要**报错**而不是被静默忽略（"我明明配了"是最难查的一类问题）
  .strict();

export type ComfyServerEntry = z.infer<typeof ServerEntrySchema>;

/** 实例文件结构：1~8 台（上限是防手滑，不是产品限制 —— 家用/工作室不会超过这个量级） */
export const ComfyServersFileSchema = z.array(ServerEntrySchema).min(1).max(8);

/** 把 `default` 之外的实例名拼成 provider id */
export function comfyUiServerId(name: string): string {
  return name === 'default' ? DEFAULT_COMFY_SERVER_ID : `${COMFYUI_PROVIDER_PREFIX}${name}`;
}

function pickTuning(entry: ComfyServerEntry): Partial<ComfyTuning> | undefined {
  const tuning: Partial<ComfyTuning> = {};
  if (entry.maxPixels !== undefined) tuning.maxPixels = entry.maxPixels;
  if (entry.steps !== undefined) tuning.steps = entry.steps;
  if (entry.cfg !== undefined) tuning.cfg = entry.cfg;
  if (entry.shift !== undefined) tuning.shift = entry.shift;
  if (entry.fps !== undefined) tuning.fps = entry.fps;
  if (entry.dtype !== undefined) tuning.dtype = entry.dtype;
  return Object.keys(tuning).length === 0 ? undefined : tuning;
}

function configuredServer(entry: ComfyServerEntry): ComfyUiServer {
  const id = comfyUiServerId(entry.name);
  const label = entry.label ?? (entry.name === 'default' ? '默认引擎' : entry.name);

  if (!isAllowedEngineUrl(entry.url)) {
    return {
      id,
      name: entry.name,
      label,
      url: entry.url,
      available: false,
      // 不回显地址明文（与 §2 / §19-1 同一份脱敏纪律）
      reason: '地址不合规：本地引擎只允许回环或内网地址（http / https）',
    };
  }

  const tuning = pickTuning(entry);
  return {
    id,
    name: entry.name,
    label,
    url: entry.url,
    available: true,
    ...(entry.template === undefined ? {} : { template: entry.template }),
    ...(tuning === undefined ? {} : { tuning }),
  };
}

function readServersFile(file: string): { entries: ComfyServerEntry[] } | { problem: string } {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    // 只报"哪一步失败"，不回显路径明文（与 H3_WORKDIR 的自检同一条纪律）
    return {
      problem: 'COMFYUI_SERVERS_FILE 指向的文件读不出来（请确认它存在、路径正确且可读）',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { problem: 'COMFYUI_SERVERS_FILE 不是合法的 JSON' };
  }

  const result = ComfyServersFileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      problem:
        'COMFYUI_SERVERS_FILE 结构不对' +
        (first === undefined ? '' : `：第 ${Number(first.path[0] ?? 0) + 1} 项 ${first.path.slice(1).join('.')} ${first.message}`),
    };
  }
  return { entries: result.data };
}

/**
 * 解析出"这台服务上配了哪些 ComfyUI 实例"（纯函数：读 env + 读一次文件）。
 *
 * 顺序：默认实例（`COMFYUI_BASE_URL`）在前，文件里的实例随后 —— 它们是**不同的地址**，
 * 不存在"谁覆盖谁"。同名（含与 `default` 撞名）后面的那一项**标记不可用**并说清原因：
 * 静默覆盖会让"我配了两台，只有一台亮"变成一个查不出来的谜。
 */
export function resolveComfyServers(env: NodeJS.ProcessEnv = process.env): ResolvedComfyServers {
  const servers: ComfyUiServer[] = [];
  const problems: string[] = [];

  const single = env.COMFYUI_BASE_URL?.trim();
  if (single !== undefined && single !== '') {
    servers.push(configuredServer({ name: 'default', url: single }));
  }

  const file = env.COMFYUI_SERVERS_FILE?.trim();
  if (file !== undefined && file !== '') {
    const loaded = readServersFile(file);
    if ('problem' in loaded) {
      problems.push(loaded.problem);
    } else {
      const seen = new Set(servers.map((server) => server.name));
      for (const entry of loaded.entries) {
        const server = configuredServer(entry);
        if (seen.has(entry.name)) {
          servers.push({
            ...server,
            available: false,
            reason: `实例名重复：${entry.name}（name 必须唯一，且 COMFYUI_BASE_URL 那台固定叫 default）`,
          });
          continue;
        }
        seen.add(entry.name);
        servers.push(server);
      }
    }
  }

  return { servers, problems };
}

/** 按 provider id 找实例（registry 用）；找不到返回 null → 调用方走既有的"未注册 → 503"路径 */
export function findComfyServer(
  id: string,
  servers: ComfyUiServer[] = resolveComfyServers().servers,
): ComfyUiServer | null {
  return servers.find((server) => server.id === id) ?? null;
}
