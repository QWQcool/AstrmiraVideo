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
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

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
 * @returns `available:false` + 对**自身**的事实陈述；绝不描述访问者设备
 */
export function runLocalEngineSelfCheck(env: NodeJS.ProcessEnv = process.env): LocalEngineSelfCheck {
  const workdir = env.H3_WORKDIR?.trim();
  const comfyUrl = env.COMFYUI_BASE_URL?.trim();

  const hasWorkdir = workdir !== undefined && workdir !== '';
  const hasComfy = comfyUrl !== undefined && comfyUrl !== '';

  if (!hasWorkdir && !hasComfy) {
    return { available: false, reason: '本服务未配置本地引擎' };
  }

  const problems: string[] = [];

  if (hasWorkdir && !isAllowedWorkdir(workdir)) {
    // 只报"哪一项不合规"，不回显路径明文（脱敏）
    problems.push('H3_WORKDIR 必须是存在的绝对目录路径');
  }

  if (hasComfy && !isAllowedEngineUrl(comfyUrl)) {
    problems.push('COMFYUI_BASE_URL 仅允许回环或内网地址');
  }

  if (problems.length > 0) {
    return { available: false, reason: `本地引擎自检失败：${problems.join('；')}` };
  }

  const tier = parseTier(env.H3_TIER);
  return {
    available: true,
    ...(tier === undefined ? {} : { tier }),
    reason: '本服务已配置本地引擎（自检通过）',
  };
}
