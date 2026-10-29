#!/usr/bin/env node
/**
 * 人脸身份相似度的**真机验收**：锚点（定妆图）与若干张图是不是同一张脸（B103 片 B 的量化）。
 *
 * 为什么要有这个脚本：B103 已经用两张场景图证明"换场景换姿势还是同一张脸"，但那是**看图说话**，
 * 下一版换了模型/工作流之后既没人复跑、也没法复跑。这里把判断落成一个数字（ArcFace 余弦），
 * 并固化成一条命令：
 *
 *   pnpm smoke:face -- --anchor .tmp/e2e/anchor.png --images .tmp/e2e/scene1.png .tmp/e2e/scene2.png \
 *                      --negatives .tmp/e2e/other.png
 *
 * 退出码（照 v2.x 的规矩：**没测**不能当成**通过**）：
 *   0 = 所有 subject 判定同人（且给了对照图时对照图确实判不同人）
 *   1 = 有 subject 不成立 / 图里没脸 / 多张脸
 *   2 = 后端不可用（没装 Python 依赖或没下模型）—— CI 与本地默认不装，所以这不算失败
 *
 * 这个脚本只做"把解释器找出来 + 转发参数"，判定逻辑全在 scripts/face-similarity/compare_faces.py。
 *
 * 装在哪：**默认 `D:\dev-tools\facesim\{venv,models}`**（本机 C 盘紧张，模型合计约 650MB）；
 * 仓库 `.tmp` 那两个路径只是旧位置的后备。换机器用 `FACE_SIM_HOME` 或 `FACE_SIM_PYTHON` 覆盖。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'face-similarity', 'compare_faces.py');

/** 模型与 venv 的默认落点：**优先 D 盘**（本机 C 盘紧张），仓库 `.tmp` 只作后备。 */
const HOME_D = process.env.FACE_SIM_HOME ?? 'D:\\dev-tools\\facesim';
const MODEL_ROOTS = [path.join(HOME_D, 'models'), path.join(ROOT, '.tmp', 'facesim-models')];

const CANDIDATES = [
  process.env.FACE_SIM_PYTHON,
  path.join(HOME_D, 'venv', 'Scripts', 'python.exe'),
  path.join(HOME_D, 'venv', 'bin', 'python'),
  path.join(ROOT, '.tmp', 'facesim-venv', 'Scripts', 'python.exe'),
  path.join(ROOT, '.tmp', 'facesim-venv', 'bin', 'python'),
  'python3',
  'python',
].filter(Boolean);

const args = process.argv.slice(2);
const hasModelRoot = args.includes('--model-root');
const modelRoot = MODEL_ROOTS.find((dir) => existsSync(dir)) ?? MODEL_ROOTS[0];
const forwarded = hasModelRoot ? args : [...args, '--model-root', modelRoot];

function run(executable) {
  return spawnSync(executable, [SCRIPT, ...forwarded], { stdio: 'inherit', cwd: ROOT });
}

let lastError = null;
for (const executable of CANDIDATES) {
  // 只在"看起来能用"的时候才试：绝对路径先判存在，裸命令交给 spawn 的 ENOENT 兜。
  if (path.isAbsolute(executable) && !existsSync(executable)) continue;
  const result = run(executable);
  if (result.error) {
    lastError = result.error;
    continue;
  }
  process.exit(result.status ?? 1);
}

console.error('✗ 找不到可用的 Python（没测，不是通过）。');
console.error('  一次性准备见 scripts/face-similarity/README.md；也可以用 FACE_SIM_PYTHON 指定解释器。');
if (lastError) console.error(`  最后一次错误：${lastError.message}`);
process.exit(2);
