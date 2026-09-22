#!/usr/bin/env node
/**
 * 一键部署（施工单 §9-3）。
 *
 * 职责边界很清楚：**只做校验与拼装**，不代替 Docker 做任何事。
 * 它存在的理由是"少一次手工出错的机会"：
 *   - 三个必填项缺一个就当场拦下（而不是让容器起来后在运行期报错）；
 *   - `TLS_MODE`（domain / ip）自动推断，避免人手选错模板；
 *   - `PUBLIC_BASE_URL` / `CORS_ORIGINS` 由 `DEPLOY_HOST` 推导，
 *     避免"部署完发现参考图传不上去"这种要读代码才能定位的问题。
 *
 * 用法：
 *   node scripts/deploy.mjs            # 校验 + 构建 + 启动
 *   node scripts/deploy.mjs --dry-run  # 只校验并打印将要执行的命令
 *   node scripts/deploy.mjs --logs     # 跟随日志（不重建）
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, '.env.deploy');
const composePath = path.join(repoRoot, 'deploy', 'compose.yaml');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const LOGS_ONLY = args.has('--logs');

/** 三项必填：前两项是"用户必须提供"的输入，第三项是生产安全红线 */
const REQUIRED_KEYS = [
  ['DEPLOY_HOST', '服务器地址（域名或 IP）'],
  ['DEPLOY_PORT', '对外 HTTPS 端口'],
  ['PUBLIC_API_TOKEN', '公网最小鉴权 Token（openssl rand -hex 24）'],
  ['BASIC_AUTH_PASSWORD', '站点登录密码（浏览器会弹框要求输入的用户名/密码）'],
];

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function parseEnv(text) {
  const out = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // 行内注释：只在 `#` 前面有空白时才算注释，避免误伤含 # 的值
    const hashAt = value.search(/\s#/);
    if (hashAt !== -1) value = value.slice(0, hashAt).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out.set(key, value);
  }

  return out;
}

/** 形如 `1.2.3.4`、`1.2.3.4:8443`、`[::1]:443` 都视为 IP 访问 */
function isIpAccess(host) {
  const bare = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return true;
  return bare.includes(':');
}

// ── 1. 读取并校验配置 ───────────────────────────────────────────────────────
if (!existsSync(envPath)) {
  fail(
    `找不到 ${path.relative(repoRoot, envPath)}。\n` +
      '  请先复制模板：Copy-Item .env.deploy.example .env.deploy（Linux/mac: cp）\n' +
      '  然后填写 DEPLOY_HOST / DEPLOY_PORT / PUBLIC_API_TOKEN（火山 Key 可选）。',
  );
}

const env = parseEnv(readFileSync(envPath, 'utf8'));
const missing = REQUIRED_KEYS.filter(([key]) => {
  const value = env.get(key);
  return value === undefined || value === '';
});

if (missing.length > 0) {
  fail(
    '.env.deploy 缺少必填项：\n' +
      missing.map(([key, label]) => `  · ${key} —— ${label}`).join('\n'),
  );
}

// 模板存在性检查：compose 若挂载了一个**不存在**的路径，Docker 会**创建一个同名目录**，
// 于是 Caddy 拿到的是个目录而不是配置文件，报出来的错跟"文件没找到"毫无关系。
const caddyfile = path.join(repoRoot, 'deploy', `Caddyfile.${isIpAccess(env.get('DEPLOY_HOST')) ? 'ip' : 'domain'}`);
if (!existsSync(caddyfile)) {
  fail(`反代模板不存在：${path.relative(repoRoot, caddyfile)}`);
}

const deployHost = env.get('DEPLOY_HOST');
const deployPort = env.get('DEPLOY_PORT');
const tlsMode = isIpAccess(deployHost) ? 'ip' : 'domain';

// 端口一致性：Caddy 会监听 DEPLOY_HOST 里的端口，不一致会造成"起了但访问不到"
const hostPort = /:(\d+)$/.exec(deployHost)?.[1];
if (hostPort !== undefined && hostPort !== deployPort) {
  fail(
    `DEPLOY_HOST 里的端口（${hostPort}）与 DEPLOY_PORT（${deployPort}）不一致。\n` +
      '  Caddy 以 DEPLOY_HOST 里的端口监听，请让二者相同，或把 DEPLOY_HOST 写成纯地址。',
  );
}

// 推导值：让"部署完发现参考图传不上去"这类问题在部署前就消失
//
// ⚠️ CORS 的 origin 必须与浏览器发出的 `Origin` 头**逐字符相等**，而该头是带端口的
// （`https://host:8443`）。早期版本在这里"顺手"去掉了非 443 的端口，
// 结果就是浏览器的每个跨源请求都被挡下、而服务端日志里什么都看不到。
// 省事的规则是：直接用对外地址原样作为 origin。
const origin = `https://${deployHost}`;
const derived = {
  PUBLIC_BASE_URL: env.get('PUBLIC_BASE_URL') || origin,
  CORS_ORIGINS: env.get('CORS_ORIGINS') || origin,
  // IP 档必需：IPv4/主机名以外**不能带端口**（Caddy 的 default_sni 只接受主机标识）。
  // 缺了它，用 IP 访问时客户端不发 SNI，Caddy 选不出证书 → 握手直接失败。
  DEPLOY_SNI: deployHost.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''),
};

// ── 站点登录（Basic Auth → Bearer 转换的前半段）──────────────────────────────
//
// 为什么必须有它：后端生产环境强制 `PUBLIC_API_TOKEN`（Bearer 鉴权），
// 而浏览器里的前端**只会自动带 Basic 凭据、不会带 Bearer** —— 不处理的话部署完
// 全站 API 都是 401，而页面本身能打开（HTML 是静态的），现象极容易误判成"后端挂了"。
// 所以由 Caddy 做一次凭据形态转换，前端因此完全不需要知道令牌的存在。
//
// Caddy 只接受 bcrypt 哈希，不存明文；这里借 Caddy 官方镜像现算，
// 避免为此引入 bcrypt 依赖（服务器上本来就有这个镜像/会自动拉取）。
const basicUser = env.get('BASIC_AUTH_USER') || 'astrmira';
const basicPassword = env.get('BASIC_AUTH_PASSWORD') ?? '';

function hashPassword(plain) {
  const result = spawnSync(
    'docker',
    ['run', '--rm', 'caddy:2-alpine', 'caddy', 'hash-password', '--plaintext', plain],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    fail(
      '生成 Basic Auth 密码哈希失败（需要 docker 可用）。\n' +
        `  docker 输出：${(result.stderr ?? '').trim() || '(空)'}`,
    );
  }
  return result.stdout.trim();
}

// ── 2. 打印将要发生的事 ─────────────────────────────────────────────────────
console.log('\n── 部署检查 ────────────────────────────────────────────');
console.log(`  仓库根目录      ${repoRoot}`);
console.log(`  配置文件        ${path.relative(repoRoot, envPath)}`);
console.log(`  对外地址        ${origin}`);
console.log(`  TLS 模式        ${tlsMode === 'domain' ? 'domain（Let\'s Encrypt 自动证书）' : 'ip（Caddy 本地 CA 自签，浏览器会告警一次）'}`);
console.log(`  云端兜底 Key    ${env.get('VOLCANO_API_KEY') ? '已配置（cloud.available=true）' : '未配置（访客需自带 BYOK Key）'}`);
console.log(`  PUBLIC_BASE_URL ${derived.PUBLIC_BASE_URL}`);
console.log(`  CORS_ORIGINS    ${derived.CORS_ORIGINS}`);
console.log(`  DEPLOY_SNI      ${derived.DEPLOY_SNI}${tlsMode === 'ip' ? '（IP 档必需：客户端不发 SNI 时用它选证书）' : ''}`);
console.log(`  站点登录        用户名 ${basicUser}（密码见 .env.deploy；浏览器会弹框要求输入）`);
console.log('────────────────────────────────────────────────────────\n');

// Basic Auth 只接受 bcrypt 哈希，生成时需要跑一次 docker（dry-run 跳过）
const basicHash = DRY_RUN ? undefined : hashPassword(basicPassword);

if (tlsMode === 'ip') {
  console.log(
    '⚠️  使用 IP 访问：浏览器会提示证书不受信任，需要手工信任一次。\n' +
      '   这不是缺陷 —— 公网纯 HTTP 会让前端直接禁用 Key 输入（PLAN §9-2）。\n',
  );
}

// ── 3. 拼装并执行 ───────────────────────────────────────────────────────────
const composeArgs = [
  'compose',
  '--env-file',
  envPath,
  '-f',
  composePath,
  ...(LOGS_ONLY ? ['logs', '-f', '--tail', '100'] : ['up', '-d', '--build']),
];

const childEnv = {
  ...process.env,
  ...derived,
  TLS_MODE: tlsMode,
  BASIC_AUTH_USER: basicUser,
  ...(basicHash === undefined ? {} : { BASIC_AUTH_HASH: basicHash }),
};

console.log(`$ docker ${composeArgs.join(' ')}\n`);

if (DRY_RUN) {
  console.log('（--dry-run：上面这条命令没有被执行）\n');
  process.exit(0);
}

const probe = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' });
if (probe.status !== 0) {
  fail(
    '未检测到可用的 `docker compose`。\n' +
      '  服务器需要预装 Docker + Docker Compose（施工单 §9-1）。',
  );
}

const result = spawnSync('docker', composeArgs, { stdio: 'inherit', cwd: repoRoot, env: childEnv });

if (result.status !== 0) {
  fail(`docker compose 执行失败（退出码 ${result.status}）。上方的输出即为原因。`);
}

if (!LOGS_ONLY) {
  console.log('\n✓ 已启动。建议按顺序自检：');
  console.log(`  1. 健康探针      curl -k https://${deployHost}/api/health`);
  console.log(`  2. 能力位        curl -k https://${deployHost}/api/providers/status`);
  console.log('     （关注 cloud.available / local.reason 是否为对**本服务**的事实陈述）');
  console.log(`  3. 前端可访问    https://${deployHost}/`);
  console.log(`                   ⚠️ 会**先弹登录框**：用户名 ${basicUser}，密码 = .env.deploy 里的 BASIC_AUTH_PASSWORD`);
  console.log('                   （若是自签证书，浏览器还会先提示"证书不受信任"，选择继续即可）');
  console.log(`  4. 上传上限      从浏览器上传一张参考图（>1MB）确认未被反代静默拦掉`);
  console.log(`  5. Range 直链    出片后在播放器里拖动进度条，能拖动即 206 未被压缩破坏`);
  console.log('\n  失败时看日志：node scripts/deploy.mjs --logs\n');
}
