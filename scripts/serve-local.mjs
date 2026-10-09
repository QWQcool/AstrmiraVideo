#!/usr/bin/env node
/**
 * 本地验收服务器（**生产形态**）：把"线上那份形态"搬到本机 ——
 * **单进程**同时托管 `/api/*`、`/media/*`（含 Range）与**前端构建产物**（SPA fallback），
 * 与线上 `app` 容器跑的是同一个入口（`backend/dist/index.js`），只少了反代那一层。
 *
 * 用法（先 `pnpm build`，或让它自己提示）：
 *   node scripts/serve-local.mjs                                  # http://127.0.0.1:3000
 *   node scripts/serve-local.mjs --port 3100                      # 换端口
 *   node scripts/serve-local.mjs --fixture                        # 开放夹具引擎（无 Key、零成本造验收数据）
 *   node scripts/serve-local.mjs --evict-mb 3                     # 容量淘汰阈值压到 3MB（当场看"成片已清理"）
 *   node scripts/serve-local.mjs --public-base-url https://xxx    # V2V / 成片参考：上游要能抓到的公网地址
 *
 * ## 与线上（Caddy 之后）的差别 —— 诚实清单，逐条有据
 * 1. **没有反代**：本地无 TLS、无 Caddy 登录、无 `request_body` 限制；
 *    上传体积由应用层把关（100MB，与反代同口径，见 CONTRACT §5 / PLAN §7-9）。
 * 2. **限流按"本机一个 IP"计**：回环来源全部同 IP —— 生成 60s 冷却（防线 5）、
 *    `verify` 10s/5 次、`logs` 10s/30 次都会按这一个 IP 算。连点会被拦，**这是预期行为**
 *    （线上按真实来源 IP 各自计；`TRUST_PROXY=1` 才认 X-Forwarded-For）。
 * 3. **`PUBLIC_BASE_URL` 默认没配**：I2V 的图片走 data URL 兜底可正常出片；
 *    V2V 视频参考 / `task:` 成片引用会被上游拒（上游抓不到 localhost）—— 本服务会**如实报错**
 *    并给出"去哪配"的指引（这条本身就是验收项 8-4 / 10-4 的一部分）。
 * 4. **数据在仓库本地**：`DATA_DIR`=`data/`、`OUTPUT_DIR`=`outputs/`（gitignored），与线上容器卷无关；
 *    想从零开始就换个目录：`--data-dir <path>`。
 * 5. **Node 版本**：本机 24（`engines >=22` 允许）vs 线上镜像 22 —— 已知行为差异：无。
 * 6. **ffmpeg**：本机依赖 PATH 里的 ffmpeg（缩略图 / 剪辑 / 夹具合成都要它）；线上镜像内置。
 * 7. **无服务端兜底 Key**：出片请在「凭据设置（BYOK）」填自己的 Key（与线上同一把即可，
 *    Key 只存浏览器、服务端过手不留存）。
 *
 * 本脚本**只做三件事**：检查构建产物 → 装好环境变量 → 起进程并把差别打印给你。
 * 不写文件、不改配置、不碰线上任何东西。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'backend', 'dist', 'index.js');
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');

function readFlag(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const port = Number(readFlag('port', '3000'));
const dataDir = readFlag('data-dir', path.join(ROOT, 'data'));
const outputsDir = readFlag('outputs-dir', path.join(ROOT, 'outputs'));
const publicBaseUrl = readFlag('public-base-url');
const evictMb = readFlag('evict-mb');
const fixture = hasFlag('fixture');

if (!existsSync(ENTRY) || !existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
  console.error(
    '缺少构建产物（backend/dist 或 frontend/dist）。\n  先跑一次：pnpm build\n  然后再执行本脚本。',
  );
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
mkdirSync(outputsDir, { recursive: true });

const url = `http://127.0.0.1:${port}`;

console.log(`
┌─ 本地验收服务器（生产形态 = 单进程托管 API + /media + 前端产物）────────────┐
│  打开：${url}
│    · 创作入口（默认落地页）  ${url}/#/create
│    · 专业模式工作台          ${url}/#/workbench
│    · 血缘画布（只读）        ${url}/#/canvas
│    · 操作日志（排错第一站）  ${url}/#/logs
│  验收清单：docs/step8-10-acceptance.md
└──────────────────────────────────────────────────────────────────────────┘

环境：
  NODE_ENV          production（与线上同形态；回环来源免鉴权，所以浏览器不需要 Token）
  DATA_DIR          ${dataDir}
  OUTPUT_DIR        ${outputsDir}
  夹具引擎          ${fixture ? '已开放（零成本造任务：ENABLE_FIXTURE_PROVIDER=1）' : '关闭（加 --fixture 可开放）'}
  PUBLIC_BASE_URL   ${publicBaseUrl ?? '未配 —— V2V / 成片参考会如实报错（图片参考不受影响）'}
  容量淘汰阈值      ${evictMb === undefined ? '默认 4GiB（加 --evict-mb 3 可压小，当场看到"成片已清理"）' : `${evictMb}MB（会被触发！会真删本地 outputs/ 里最旧的成片）`}

与线上的差别（详见脚本头注释）：
  · 没有 Caddy：无 TLS / 无登录页 / 无反代请求体上限（应用层仍是 100MB）
  · 限流按"本机一个 IP"计：连点会被 60s 冷却拦下 —— 预期行为，不是缺陷
  · PUBLIC_BASE_URL 未配时，视频参考类会被上游拒（本服务给出可执行指引）

按 Ctrl+C 停止。
`);

const child = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    FRONTEND_DIST,
    DATA_DIR: dataDir,
    OUTPUT_DIR: outputsDir,
    // 生产形态要求有 Token 才启动；本机浏览器来自回环，鉴权钩子对回环一律放行 ——
    // 这把 Token 只是为了让"生产形态"的自检通过，不对外暴露、也不打印。
    PUBLIC_API_TOKEN: process.env.PUBLIC_API_TOKEN ?? 'local-acceptance-loopback',
    ...(publicBaseUrl === undefined ? {} : { PUBLIC_BASE_URL: publicBaseUrl }),
    ...(fixture ? { ENABLE_FIXTURE_PROVIDER: '1' } : {}),
    ...(evictMb === undefined
      ? {}
      : { OUTPUTS_MAX_BYTES: String(Math.floor(Number(evictMb) * 1024 * 1024)) }),
  },
});

child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
