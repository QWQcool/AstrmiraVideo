import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * 本地引擎**配置自检**（CONTRACT §2 V1.8 / PLAN §6-D22 / §7-2 / AC6）。
 *
 * 三条纪律：
 * 1. **不扫描硬件**：只读 env，做一次轻量校验；不返回型号、显存、路径明文（D27）；
 * 2. **只陈述本服务自身**：`available:false` 的语义是"本服务没配 / 没开"，**不是**"你的设备不行"；
 * 3. **到达路径 = 配 env + 重启**：运行时自检路由属 PLAN §9 台账 B4，本片不实现。
 *
 * 白名单（PLAN §7-2「拒绝任意外部地址」）：`COMFYUI_BASE_URL` 只允许回环或 RFC1918；
 * `H3_WORKDIR` 只允许存在的绝对路径。
 */

export interface LocalEngineSelfCheck {
  available: boolean;
  /** 部署者显式声明的档位（`H3_TIER`）；未声明则缺省 —— 不由探测推导 */
  tier?: 0 | 1 | 2 | 3;
  reason: string;
}

/** RFC1918 私网 + 回环；其余一律拒绝（防 SSRF 面） */
export function isAllowedEngineHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host === '::1') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true; // 172.16~31 区间无法用前缀表达

  return false;
}

export function isAllowedEngineUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return isAllowedEngineHost(parsed.hostname);
}

/** 本机路径白名单：绝对路径 + 存在 + 是目录 */
export function isAllowedWorkdir(raw: string): boolean {
  if (!path.isAbsolute(raw)) return false;
  if (!existsSync(raw)) return false;
  try {
    return statSync(raw).isDirectory();
  } catch {
    return false;
  }
}

function parseTier(raw: string | undefined): 0 | 1 | 2 | 3 | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw.trim());
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : undefined;
}

/**
 * 执行一次配置自检（纯函数：只读 env，不产生副作用）。
 *
 * ## ⚠️ 它现在**只认 `H3_WORKDIR`**（V2.32 收窄；此前它把 `COMFYUI_BASE_URL` 也算进来）
 *
 * 收窄修的是一个**真实缺陷**：`/api/providers/status` 的 `local` 段表达的是
 * "**自装 MiniMax H3**"这一档（`provider: 'minimax-h3'`），而此前只要配了 `COMFYUI_BASE_URL`
 * 也会让 `local.available = true` —— 于是在配了 ComfyUI 的机器上，界面会**同时**宣称：
 * "本地 MiniMax H3 可用"（**假的**：`local-minimax-h3` 这个 provider 根本没实现，提交必 503）
 * 与"本地 ComfyUI 可用"（真的）。
 *
 * 现在：ComfyUI 的配置事实由 `comfyui` 段**独立陈述**（`routes/providers.ts` 的
 * `resolveComfyUiStatus`，用的是同一份白名单 `isAllowedEngineUrl`）——
 * 一个后端一段，谁配了谁亮。
 *
 * @returns `available:false` + 对**自身**的事实陈述；绝不描述访问者设备
 */
export function runLocalEngineSelfCheck(env: NodeJS.ProcessEnv = process.env): LocalEngineSelfCheck {
  const workdir = env.H3_WORKDIR?.trim();
  const hasWorkdir = workdir !== undefined && workdir !== '';

  if (!hasWorkdir) {
    return { available: false, reason: '本服务未配置本地 MiniMax H3（缺 H3_WORKDIR）' };
  }

  if (!isAllowedWorkdir(workdir)) {
    // 只报"哪一项不合规"，不回显路径明文（脱敏）
    return { available: false, reason: '本地引擎自检失败：H3_WORKDIR 必须是存在的绝对目录路径' };
  }

  const tier = parseTier(env.H3_TIER);
  return {
    available: true,
    ...(tier === undefined ? {} : { tier }),
    reason: '本服务已配置本地 MiniMax H3（自检通过）',
  };
}
