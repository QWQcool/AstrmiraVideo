#!/usr/bin/env node
/**
 * DeepSeek 真实全链路实测（S8 收官证据；PLAN §5）。
 *
 * 剧本 →（真实 DeepSeek）→ 分镜表 → 每镜生成参数 → 创作会话 →（fixture 引擎）→ 自动拼接成片。
 * 文本轨是真钱（几厘～几毛），生成轨是夹具（零成本）。可反复跑；幂等键按 runId 每次新建。
 *
 * 用法：
 *   node scripts/deepseek-run-e2e.mjs                     # 默认 http://127.0.0.1:3000
 *   BASE=http://127.0.0.1:3100 node scripts/deepseek-run-e2e.mjs
 * 前置：DEEPSEEK_API_KEY 环境变量；服务以 --fixture 启动（会话引擎需要本地轨）。
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000';
const KEY = process.env.DEEPSEEK_API_KEY ?? '';
const INSTRUCTION =
  process.env.PROMPT ??
  '雨夜霓虹小巷里的橘猫：从巷口推进到猫抬头，最后定格霓虹倒影。共 3 个镜头、每镜约 3 秒、16:9 电影感。';

if (KEY === '') {
  console.error('缺少 DEEPSEEK_API_KEY（本脚本只用环境变量，不落盘）');
  process.exit(2);
}

const t0 = Date.now();
const llm = { preset: 'deepseek' };

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-llm-key': KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function pollRun(id, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${BASE}/api/agent/runs/${id}`);
    if (!res.ok) throw new Error(`GET run → HTTP ${res.status}`);
    const { run } = await res.json();
    // awaiting-confirmation 是合法暂停态：返回给调用方决定是否 confirm
    if (['succeeded', 'failed', 'cancelled', 'awaiting-confirmation'].includes(run.state)) return run;
    if (Date.now() > deadline) {
      throw new Error(`会话 ${id} 在 ${timeoutMs}ms 内未终态（当前 ${run.state}）`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

// ① 分镜（真实 DeepSeek）
let s = Date.now();
const storyboard = await call('/api/agent/storyboard', { instruction: INSTRUCTION, llm });
console.log(`[1] 分镜 OK ${fmt(Date.now() - s)} · ${storyboard.model} · tokens ${storyboard.usage?.promptTokens}+${storyboard.usage?.completionTokens}`);
console.log(`    《${storyboard.plan.title}》 ${storyboard.plan.aspectRatio} ${storyboard.plan.durationSec}s ${storyboard.plan.shots.length} 镜`);

// ② 展开（第二次规划）
s = Date.now();
const expanded = await call('/api/agent/storyboard/expand', { plan: storyboard.plan, references: [], llm });
console.log(`[2] 展开 OK ${fmt(Date.now() - s)} · tokens ${expanded.usage?.promptTokens}+${expanded.usage?.completionTokens}`);
for (const shot of expanded.plan.shots) {
  console.log(
    `    #${shot.index} ${shot.title} · ${shot.aspectRatio} ${shot.resolutionTier} ${shot.durationSec}s${shot.imagePrompt === undefined ? '' : ' · 先出首帧图'}${shot.referenceAssetIds.length === 0 ? '' : ` · 参考x${shot.referenceAssetIds.length}`}${shot.warnings.length === 0 ? '' : ` · ⚠${shot.warnings.length}`}`,
  );
}

// ③ 组装会话输入（与前端 buildCreationRunInput 同规则）
const steps = [];
for (const shot of expanded.plan.shots) {
  if (shot.imagePrompt !== undefined) {
    steps.push({ id: `img-${shot.index}`, kind: 'image', prompt: shot.imagePrompt, aspectRatio: shot.aspectRatio, resolutionTier: shot.resolutionTier, referenceAssetIds: [], dependsOn: [] });
    steps.push({ id: `shot-${shot.index}`, kind: 'video', prompt: shot.videoPrompt, aspectRatio: shot.aspectRatio, resolutionTier: shot.resolutionTier, durationSec: shot.durationSec, referenceAssetIds: shot.referenceAssetIds, dependsOn: [`img-${shot.index}`] });
  } else {
    steps.push({ id: `shot-${shot.index}`, kind: 'video', prompt: shot.videoPrompt, aspectRatio: shot.aspectRatio, resolutionTier: shot.resolutionTier, durationSec: shot.durationSec, referenceAssetIds: shot.referenceAssetIds, dependsOn: [] });
  }
}

// ④ 创建 + 启动（首帧确认档：真实走一遍暂停/继续）
const created = await call('/api/agent/runs', {
  title: `DeepSeek 实测 · ${storyboard.plan.title}`.slice(0, 120),
  mode: 'first-frame-confirm',
  provider: 'fixture-local',
  steps,
});
await fetch(`${BASE}/api/agent/runs/${created.run.id}/start`, { method: 'POST' });
console.log(`[3] 会话已创建并启动（${created.run.steps.length} 步 · 首帧确认档）`);

let run = await pollRun(created.run.id, 180_000);
if (run.state === 'awaiting-confirmation') {
  console.log(`[4] 首帧确认暂停（图片步 ${run.steps.filter((x) => x.kind === 'image').length} 个已完成）→ 继续`);
  await fetch(`${BASE}/api/agent/runs/${created.run.id}/confirm`, { method: 'POST' });
  run = await pollRun(created.run.id, 180_000);
}

if (run.state !== 'succeeded') {
  console.error(`[5] 会话终态 = ${run.state}；failure =`, run.failure);
  for (const step of run.steps) {
    console.error(`    ${step.id} ${step.status} ${step.error ?? ''}`);
  }
  process.exit(1);
}

const finalTask = await fetch(`${BASE}/api/tasks/${run.assembledTaskId}`).then((r) => r.json());
console.log(`[5] 会话成功 ${fmt(Date.now() - t0)} · 成片任务 ${run.assembledTaskId?.slice(0, 8)} · ${finalTask.outputVideoUrl}`);
console.log(`DONE OK · 幂等键前缀 run:${created.run.id}`);
