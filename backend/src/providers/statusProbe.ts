/**
 * 本地引擎的**地址白名单**（CONTRACT §2 / §19-1；PLAN §6-D22 / §7-2 / AC6）。
 *
 * ## 历史（V2.37 删除了一半职责，记在这里免得后来者以为"少了什么"）
 * 这里曾同时承担「**MiniMax H3 档的配置自检**」（读 `H3_WORKDIR` 校验目录存在、读 `H3_TIER` 报档位），
 * 外加一个 `isAllowedWorkdir` 的路径白名单。**V2.37 起随该档撤掉一并删除**（决策 **D56**：
 * 那一档只有配置约定、没有执行实现，摆着它就是"界面上有一个点了才知道不行的档"）。
 * **它现在只剩一件事：判断一个地址是否允许被本服务连接**（防 SSRF）。
 *
 * ## 三条纪律不变
 * 1. **不扫描硬件**：只做白名单判断；不返回型号、显存、路径明文（D27）；
 * 2. **只陈述本服务自身**：`available:false` 的语义是"本服务没配 / 没开"，**不是**"你的设备不行"；
 * 3. **到达路径 = 配 env + 重启**：运行时自检在 CONTRACT §20（`GET /api/providers/selfcheck`），
 *    它逐台去连**部署者显式配置的** ComfyUI 实例（§19-1）。
 */

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
