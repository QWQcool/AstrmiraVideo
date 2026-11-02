#!/usr/bin/env node

/**
 * **停机姿态**验收（V2.107）：GPU 关机时，该报错的地方报错、该能用的地方还能用。
 *
 * ## 为什么需要它
 * 停机不是异常，是常态（算力机按小时租，用完就关）。而"关机时的表现"只有真关机才暴露：
 * 2026-11-02 实测发现 `POST /api/audio(bgm)` 在 GPU 机关机时**仍然返回 200 + taskId**，
 * 任务 0.1s 后 failed —— 接口像是接了单，用户靠轮询才知道没做成，任务表里多一条脏记录。
 * 修完之后由这个脚本钉住，每次停机都能复跑一遍。
 *
 * ## 判据（三条，都能复算）
 * 1. `GET /api/audio/engines` 在 **2 秒内**返回，并且不可用的那条**原因里带地址**
 *    （"连不上 http://…"，只写 `fetch failed` 的话看日志的人还得翻 env）；
 * 2. `POST /api/audio(bgm)` **不是 200**（应为 503 `PROVIDER_UNAVAILABLE`），
 *    且响应里**没有 taskId** —— 任务根本不该建；
 * 3. `POST /api/audio(tts)` 若云端 Key 配了，**仍然能接单**（配音不依赖 GPU）。
 *    没配就跳过这条并用一句话说明（不用 "skip" 假装通过）。
 *
 * ## 用法
 * ```bash
 * pnpm smoke:offline -- --base http://127.0.0.1:3000          # 站点容器内/本机
 * pnpm smoke:offline -- --base https://<host> --token <PUBLIC_API_TOKEN> --tts
 * ```
 * 退出码：0 全过；1 有失败；2 跑不了（连不上 / 这个部署还没有这些接口）。
 */

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')
    ? argv[index + 1]
    : fallback;
};

const BASE = (arg('base', process.env.ASTRMIRA_BASE ?? 'http://127.0.0.1:3000')).replace(/\/+$/, '');
const TOKEN = arg('token', process.env.PUBLIC_API_TOKEN ?? '');
const WITH_TTS = argv.includes('--tts');
const headers = TOKEN === '' ? {} : { authorization: `Bearer ${TOKEN}` };

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
}

async function main() {
  console.log(`=== 停机姿态验收 · ${BASE} ===`);

  const started = Date.now();
  let engines;
  try {
    const response = await fetch(`${BASE}/api/audio/engines`, { headers });
    if (!response.ok) {
      console.error(`✗ GET /api/audio/engines → HTTP ${response.status}`);
      process.exit(2);
    }
    engines = (await response.json()).engines;
  } catch (error) {
    console.error(`✗ 连不上 ${BASE}：${error.message}`);
    process.exit(2);
  }
  const elapsed = Date.now() - started;
  check(elapsed < 2000, `引擎状态 ${elapsed}ms 内返回（停机时不能挂住）`);

  const bed = engines.find((entry) => entry.engine === 'host-stable-audio');
  const voice = engines.find((entry) => entry.engine === 'mimo-tts');
  if (bed === undefined || voice === undefined) {
    console.error('✗ 响应里没有两个引擎（这个部署还没有 V2.106 的 /api/audio/engines）');
    process.exit(2);
  }

  // ① 配乐引擎：此刻应当不可用（停机场景），且原因里带地址
  check(bed.available === false, `配乐引擎不可用（reason: ${bed.reason ?? '（未给原因）'}）`);
  check((bed.reason ?? '').includes('http'), '原因里带**地址**（不只是 "fetch failed"）');

  // ② 提交配乐：必须当场拒绝，而不是"接单后失败"
  const bgm = await fetch(`${BASE}/api/audio`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'bgm',
      engine: 'host-stable-audio',
      prompt: 'offline acceptance probe, no audio should be produced',
      seconds: 1,
    }),
  });
  const bgmBody = await bgm.json().catch(() => ({}));
  check(bgm.status === 503, `POST /api/audio(bgm) → ${bgm.status}（期望 503，不是 200+脏任务）`);
  check(bgmBody.taskId === undefined, '响应里没有 taskId（任务没被建出来）');
  check(bgmBody.code === 'PROVIDER_UNAVAILABLE', `错误码 ${bgmBody.code ?? '（缺失）'}`);

  // ③ 配音：云端路径不依赖 GPU
  if (voice.available !== true) {
    console.log(`· 配音引擎不可用（${voice.reason ?? '未配 MIMO_API_KEY'}），跳过云端可用性检查`);
  } else if (!WITH_TTS) {
    console.log('· 配音引擎可用；加 --tts 才会真的提交一条（会消耗 token）');
  } else {
    const tts = await fetch(`${BASE}/api/audio`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'tts', engine: 'mimo-tts', text: '停机时云端配音仍可用。' }),
    });
    const body = await tts.json().catch(() => ({}));
    check(tts.status === 200 && typeof body.taskId === 'string', `POST /api/audio(tts) → ${tts.status}（云端不依赖 GPU）`);
  }

  console.log(`\n${failures === 0 ? '✓ 停机姿态正确' : `✗ ${failures} 项不符合预期`}`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
