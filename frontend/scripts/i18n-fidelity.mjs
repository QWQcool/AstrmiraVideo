/**
 * **语言迁移的忠实性核对**（迁移期工具，不在 CI 里跑）。
 *
 * ## 它防的是什么
 * 迁移的硬纪律是「**不改文案**」——把界面上的中文原样搬进字典。而"少一个空格 /
 * 把 `"` 换成 `“”` / 少一个标点 / 把「」写成『』"**人眼几乎看不出来**，code review 也看不住
 * （几百行 diff 里，一个字符的区别不是可见性问题，而是注意力问题）。
 * 中文文案一旦被悄悄改动，"切语言时逐字不变"这件事就再也说不清了。
 *
 * ## 判据（三点都是权衡后的）
 * 1. **按 `{..}` 切段再找**：原文里是 `{node.lastTaskId.slice(0, 8)}`，字典里只能写 `{id}` ——
 *    占位符名字必然不同，所以不能整串比对，只能逐段；
 * 2. **两边空白先归一**：原文跨行的句子在 JSX 里会被合成一个空格（或按标签边界被删掉），
 *    而"边界空格要不要保留"是**设计决定**（本仓的做法：写进字典值，保证渲染逐字节一致）——
 *    那种边界在写字典时就逐处确认过，机器这一步只管字词；
 * 3. **两级判据（硬失败 vs 跨边界软提示）**：原文里同一句话常被 **JSX 文本节点 / 字符串拼接**
 *    切成几截（`（{expr} · 后缀`、`` `…条连线` + `（文件里…` ``）—— 整段在源码里**本来就不连续**，
 *    那不是誊写错误，是工具看不见渲染后的拼接。判据是**连续中文串（≥3 字）**：
 *    全部找到 = 软提示（人工看一眼）；有一条找不到 = 硬失败（内容字被改动了）。
 *    **第一次跑 `CanvasView` 就用到这条**：7 条报错全是边界，内容字一字不差。
 *
 * ## 为什么必须指定 `--ref`（所以它进不了 CI）
 * 它比的是"**改之前**那个版本"，而这个上下文只存在于**提交之前**：
 * 迁完一批、提交之后，`HEAD` 里已经没有旧文案了。所以它的用法是
 * **每批迁完、`git commit` 之前跑一次**（默认 `--ref HEAD` 就是"上一提交"）。
 *
 * ⚠️ **同一个域分几批迁时，`--ref` 不能给 `HEAD`**：上一提交可能已经迁走了其中几个文件，
 * 那些文件的旧文案在 `HEAD` 里已经不存在 → 会报一堆假失败。
 * 正确做法是给**该域开始迁移之前**的那个提交（例：canvas 域片 A 已提交后再迁片 B，
 * 要 `--ref <片 A 的父提交>`），并且 `--files` 要列出**这个域的全部来源文件**。
 *
 * ## 用法
 * ```
 * node scripts/i18n-fidelity.mjs --domain canvas \
 *   --files canvas/NoteCard.tsx,canvas/PlanNodeCard.tsx,canvas/PlanInspector.tsx
 * ```
 * 退出码非 0 = 有字典里的中文在原文里找不到（誊写时动过文案）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
/** `git show <rev>:<path>` 的路径**永远相对仓库根**，而本脚本在 `frontend/scripts/` 下 */
const REPO_PREFIX = path.basename(ROOT);
const CJK = /[\u4e00-\u9fa5]/;

function parseArgs(argv) {
  const options = { domain: '', files: [], ref: 'HEAD' };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--domain') options.domain = argv[++i] ?? '';
    else if (flag === '--files') options.files = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (flag === '--ref') options.ref = argv[++i] ?? 'HEAD';
    else {
      console.error(`未知参数：${flag}`);
      process.exit(2);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.domain === '' || options.files.length === 0) {
  console.error('用法：node scripts/i18n-fidelity.mjs --domain <域> --files <相对 src 的路径,逗号分隔> [--ref HEAD]');
  process.exit(2);
}

const norm = (text) => text.replace(/\s+/g, ' ');

/** 原文取自 `--ref` 那个版本（默认上一提交）——这就是它"迁移期专用"的原因 */
function originalText(file) {
  const spec = `${options.ref}:${REPO_PREFIX}/src/${file}`;
  try {
    return execFileSync('git', ['show', spec], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    console.error(`✗ 取不到 ${spec}（路径写错了？还是这一批已经提交过了？）`);
    process.exit(2);
  }
}

const text = norm(options.files.map(originalText).join('\n'));

const dictPath = path.join(SRC, 'lib', 'dict', `${options.domain}.ts`);
const source = readFileSync(dictPath, 'utf8');
const zhStart = source.indexOf('_ZH = {');
const zhEnd = source.indexOf('_EN = {');
if (zhStart < 0 || zhEnd < 0 || zhEnd < zhStart) {
  console.error(
    `✗ 认不出 ${path.relative(ROOT, dictPath)} 里的 ZH / EN 两块（本脚本按 "_ZH = {" 与 "_EN = {" 切）`,
  );
  process.exit(2);
}

const zhBlock = source.slice(zhStart, zhEnd);
/** 值都是**单引号字面量**（含跨行拼接的多个字面量），所以逐个取出来再找 */
const literals = [...zhBlock.matchAll(/'([^'\\]*)'/g)].map((match) => match[1]);

let checked = 0;
/** 硬失败：连**内容字**都对不上 —— 这一定是誊写时改了文案 */
const broken = [];
/** 软提示：整段因**边界**找不到，但里面的内容字一字不差（见文件头的"两级判据"） */
const boundary = [];

for (const literal of literals) {
  if (!CJK.test(literal)) continue;
  checked += 1;
  const segments = literal
    .split(/\{[^}]*\}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && CJK.test(segment));
  for (const segment of segments) {
    if (text.includes(segment)) continue;
    /**
     * **两级判据**（2026-10-16 实战加的，第一次跑 CanvasView 就用到）：
     * 原文里同一句话常常被 **JSX 文本节点 / 字符串拼接**切成几截
     * （`（{expr} · 后缀` / `` `…条连线` + `（文件里…` ``），于是"整段"在源码里**本来就不连续**——
     * 那不是誊写错误，是工具看不见渲染后的拼接结果。
     *
     * 所以：把段里的**连续中文串**（≥3 字）逐条拿去原文里找 ——
     * - 全部找到 → **软提示**（边界问题，人工看一眼即可，退出码不变）；
     * - 有一条找不到 → **硬失败**（内容字被改动了，这正是这个工具存在的理由）。
     */
    const runs = segment.match(/[\u4e00-\u9fa5]{3,}/g) ?? [];
    const missingRuns = runs.filter((run) => !text.includes(run));
    if (missingRuns.length > 0) broken.push({ literal, segment, missingRuns });
    else boundary.push({ literal, segment });
  }
}

for (const item of boundary) {
  console.log(
    `· 跨边界（核对不到，需人工看一眼）：${JSON.stringify(item.segment)}\n` +
      `  来自字典值：${JSON.stringify(item.literal)}`,
  );
}

if (broken.length > 0) {
  for (const item of broken) {
    console.error(
      `✗ 原文里找不到这些内容字：${JSON.stringify(item.missingRuns)}\n` +
        `  所在段：${JSON.stringify(item.segment)}\n  来自字典值：${JSON.stringify(item.literal)}`,
    );
  }
  console.error(
    `\n✗ i18n 忠实性核对失败：${checked} 条含中文的字典值里，有 ${broken.length} 段的**内容字**在 ${options.ref} 的原文里找不到\n` +
      '  —— 迁移**不改文案**：请把字典值改回原文（别改原文去迁就字典）。',
  );
  process.exit(1);
}

console.log(
  `✓ i18n 忠实性核对通过：${options.domain} 域 ${checked} 条含中文的字典值，` +
    `内容字逐条都能在 ${options.ref} 的原文里找到（${options.files.length} 个文件）` +
    (boundary.length === 0 ? '' : `；另有 ${boundary.length} 段跨了文本节点边界，已单独列出供人工核对`),
);
