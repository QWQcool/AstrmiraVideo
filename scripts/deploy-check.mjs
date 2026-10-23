#!/usr/bin/env node
/**
 * 部署状态自检：HEAD 这个 commit 到底上没上线？
 *
 * 为什么需要它：CI 已改为**手动 workflow_dispatch**（额度原因），于是"push 完就等于部署完"
 * 的直觉不再成立 —— 2026-10-24 就发生过一次"线上其实早就部署过同一个 commit，却又手动
 * 触发了一遍"，白跑 32 分钟。这个脚本在**触发前**回答一个问题：
 *
 *   HEAD 是不是已经有一次 **deploy job 成功**的运行？
 *
 * 判定依据只看 GitHub Actions 的事实（`gh run view` 里 deploy job 的 conclusion），
 * **不读 PLAN 的文字记录** —— 文档里的"已部署"会滞后，Actions 的结论不会。
 *
 * 用法：
 *   node scripts/deploy-check.mjs            # 人读输出
 *   node scripts/deploy-check.mjs --json     # 机器读输出
 *
 * 退出码（方便串在 shell 里）：
 *   0 = HEAD 已部署（不必再触发）
 *   1 = HEAD 未部署（可以触发 `gh workflow run CI --ref main -f deploy=true`）
 *   2 = 无法判断（gh 不可用 / 不在 git 仓库 / 没有历史运行）
 *
 * 依赖：已登录的 `gh`（`gh auth status` 通过）。**代理由调用方的环境提供**
 * （如需 HTTPS_PROXY，请自行 export；本文件刻意不写入任何环境特定的地址）。
 */

import { execFileSync } from 'node:child_process';

/** 只看这个 workflow；名字改了这里要一起改（`gh workflow list` 可查） */
const WORKFLOW_NAME = 'CI';
/** 往回查多少次运行；额度紧张时运行很稀疏，30 次足够覆盖最近若干天 */
const RUN_LIMIT = 30;

/** @param {string[]} args */
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** @param {string[]} args */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function main() {
  const asJson = process.argv.includes('--json');

  let head;
  try {
    head = git(['rev-parse', 'HEAD']).trim();
  } catch {
    return fail(asJson, '不在 git 仓库里，或 git 不可用');
  }

  let runs;
  try {
    const raw = gh([
      'run',
      'list',
      '--workflow',
      WORKFLOW_NAME,
      '--limit',
      String(RUN_LIMIT),
      '--json',
      'databaseId,headSha,conclusion,createdAt,displayTitle',
    ]);
    runs = JSON.parse(raw);
  } catch (error) {
    return fail(asJson, `gh 调用失败（先确认 gh auth status）：${String(error.message).slice(0, 200)}`);
  }

  if (!Array.isArray(runs) || runs.length === 0) {
    return fail(asJson, `找不到 "${WORKFLOW_NAME}" 的历史运行`);
  }

  // 只看成功的运行：失败/取消的运行不可能部署成功
  const candidates = runs.filter((run) => run.conclusion === 'success');
  if (candidates.length === 0) {
    return fail(asJson, `最近 ${RUN_LIMIT} 次运行里没有成功的，无法判断线上版本`);
  }

  // 从新到旧找"第一次真正跑了 deploy 且成功"的运行
  let deployed = null;
  for (const run of candidates) {
    let jobs;
    try {
      const raw = gh(['run', 'view', String(run.databaseId), '--json', 'jobs']);
      jobs = JSON.parse(raw).jobs ?? [];
    } catch {
      continue; // 单次查询失败不该让整个检查失败
    }
    const deployJob = jobs.find((job) => job.name === 'deploy');
    // `deploy` job 存在且 success ⇒ 真的部署过；被 if 跳过时 conclusion 是 'skipped'
    if (deployJob?.conclusion === 'success') {
      deployed = { ...run, deployedAt: deployJob.completedAt ?? run.createdAt };
      break;
    }
  }

  if (deployed === null) {
    return fail(asJson, `成功的运行里没有一次 deploy job 成功（可能都是 verify-only）`);
  }

  const upToDate = deployed.headSha === head;
  const short = (sha) => sha.slice(0, 7);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          head,
          deployedSha: deployed.headSha,
          deployedRunId: deployed.databaseId,
          deployedAt: deployed.deployedAt,
          upToDate,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`HEAD           : ${short(head)}`);
    console.log(`最近一次部署   : ${short(deployed.headSha)}  (run ${deployed.databaseId} @ ${deployed.deployedAt})`);
    console.log('');
    if (upToDate) {
      console.log('✅ 已是最新：HEAD 就是线上那一版，**不需要**再触发部署。');
    } else {
      console.log('⚠️  未部署：HEAD 还没有上线。要部署请执行：');
      console.log('');
      console.log('   gh workflow run CI --ref main -f deploy=true');
      console.log('');
      console.log('   （先在网页 Actions 确认剩余额度；一次完整运行约 5~32 分钟。）');
    }
  }

  return upToDate ? 0 : 1;
}

/**
 * @param {boolean} asJson
 * @param {string} message
 */
function fail(asJson, message) {
  if (asJson) {
    console.log(JSON.stringify({ error: message }, null, 2));
  } else {
    console.log(`❌ 无法判断：${message}`);
  }
  return 2;
}

process.exitCode = main();
