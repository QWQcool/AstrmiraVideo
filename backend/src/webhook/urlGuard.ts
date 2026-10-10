import { WEBHOOK_URL_MAX_CHARS } from '@astrmira/shared';

/**
 * Webhook URL 的准入判定（V2.15 / 台账 B51）。
 *
 * ## 为什么必须有这一层（这不是洁癖，是 SSRF 的真实入口）
 * Webhook = **我们的服务器主动去请求一个由调用方给出的 URL**。没有约束时，
 * 客户可以把它指向 `http://169.254.169.254/...`（云元数据）、`http://127.0.0.1:6379/`（内网服务）、
 * 或 `http://10.0.0.5/`（同机房其他机器）—— 我们就成了它的内网跳板。
 *
 * ## 口径（"不静默"在安全上的具体化）
 * - 只允许 `http:` / `https:`；**不接受 URL 里带用户名密码**（`https://u:p@host/`）；
 * - **默认拒绝**环回 / 私网 / 链路本地 / 云元数据地址；
 * - B 端私有部署里"回调到客户内网"是**真实需求**，所以留了一个显式开关
 *   `WEBHOOK_ALLOW_PRIVATE=1`（部署者自己承担这个决定，且默认关）；
 * - 判定是**字面量**的（IP 字面 + 主机名规则）：不做 DNS 解析后再查 —— 那会引出一个
 *   "解析与请求之间地址变了"（DNS rebinding）的更大口子，而本服务是**单租户私有部署**，
 *   调用方本来就是部署者自己；真正的多租户场景需要固定出口代理，属另一个量级的事（已如实登记）。
 */

export interface WebhookUrlCheckOk {
  ok: true;
  url: string;
}
export interface WebhookUrlCheckFail {
  ok: false;
  reason: string;
}
export type WebhookUrlCheck = WebhookUrlCheckOk | WebhookUrlCheckFail;

/** IPv4 字面量是否落在"不该被我们主动访问"的网段 */
export function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 环回
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 运营商级 NAT 100.64/10
  return false;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

/** 主机名是否指向本机 / 内网（字面判定，见文件头说明） */
export function isBlockedHost(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::' ) return true;
  // IPv6 唯一本地地址（fc00::/7）与链路本地（fe80::/10）
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  if (isPrivateIpv4(host)) return true;
  return false;
}

export function checkWebhookUrl(raw: string, options: { allowPrivate?: boolean } = {}): WebhookUrlCheck {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'URL 不能为空' };
  if (trimmed.length > WEBHOOK_URL_MAX_CHARS) {
    return { ok: false, reason: `URL 过长（上限 ${WEBHOOK_URL_MAX_CHARS} 字符）` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'URL 解析失败（要写完整，含 http:// 或 https://）' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `只支持 http / https（收到 ${parsed.protocol}）` };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'URL 里不能带用户名密码（凭据请走签名校验）' };
  }
  if (!options.allowPrivate && isBlockedHost(parsed.hostname)) {
    return {
      ok: false,
      reason:
        '目标地址属于环回 / 私网 / 链路本地（SSRF 防护）。若客户系统确实在内网，请由部署者设 WEBHOOK_ALLOW_PRIVATE=1',
    };
  }
  return { ok: true, url: trimmed };
}
