import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 视觉自检（Step 3 AC5 / AC6）。
 *
 * 为什么是静态检查而不是截图比对：这里要防的是**结构性回归**
 * ——"某个 keyframe 被删了引用，但页面看着没问题"、"有人顺手写了个 14px"。
 * 截图比对抓不到"孤置"，而静态检查能在 CI 里秒级失败。
 * （真正的视觉验收在 Step 4 的端到端截图。）
 *
 * 退出码非 0 = 失败。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const TOKENS = path.join(SRC, 'styles', 'tokens.css');

/** Astrmira 原生 8 个 keyframes（AC5 要求全部有实际使用位） */
const REQUIRED_KEYFRAMES = [
  'star-gather',
  'mira-breathe',
  'mira-orbit-turn',
  'origin-orbit-sway',
  'flow',
  'motion-bootstrap',
  'navigation-enter',
  'language-appear',
];

/** 分区标题必须走带索引号的 Eyebrow（AC6） */
const PANELS_EXPECTING_EYEBROW = ['LeftPanel.tsx', 'CenterPanel.tsx', 'RightPanel.tsx'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const contents = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const rel = (file) => path.relative(ROOT, file).replaceAll('\\', '/');

const failures = [];
const tokensText = contents.get(TOKENS);

if (tokensText === undefined) {
  console.error('✗ 找不到 tokens.css');
  process.exit(1);
}

// ── ① 8 个 keyframes：定义集合必须恰好一致，且每一个都有功能位使用 ──
const declared = [...tokensText.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);

for (const name of REQUIRED_KEYFRAMES) {
  if (!declared.includes(name)) {
    failures.push(`tokens.css 缺少 keyframe \`${name}\``);
    continue;
  }

  const used = [...contents.entries()].some(([file, text]) => {
    if (path.resolve(file) === TOKENS) return false; // 定义处不算使用
    return new RegExp(`animation(?:-name)?\\s*:[^;]*\\b${name}\\b`).test(text);
  });

  if (!used) {
    failures.push(`keyframe \`${name}\` 没有任何功能位使用（AC5 禁止孤置）`);
  }
}

for (const name of declared) {
  if (!REQUIRED_KEYFRAMES.includes(name)) {
    failures.push(`tokens.css 出现计划外的 keyframe \`${name}\`（8 个之外应显式登记）`);
  }
}

// ── ② 动效降级：必须有 prefers-reduced-motion 兜底 ──
if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(tokensText)) {
  failures.push('tokens.css 缺少 prefers-reduced-motion 降级（AC5）');
}

// ── ③ 零硬编码字号 / 字距（tokens.css 是变量定义处，豁免） ──
const HARDCODED_SIZE = /(?:fontSize|letterSpacing|font-size|letter-spacing)\s*:\s*['"]?\d/;

for (const [file, text] of contents) {
  if (path.resolve(file) === TOKENS) continue;

  text.split('\n').forEach((line, position) => {
    if (!HARDCODED_SIZE.test(line)) return;
    // 允许在注释里讨论（例如本文件顶部的纪律说明）
    if (/^\s*(?:\*|\/\/|\/\*)/.test(line)) return;
    failures.push(`${rel(file)}:${position + 1} 出现硬编码字号/字距（AC6）：${line.trim()}`);
  });
}

// ── ④ 分区标题必须使用带索引号的 Eyebrow ──
for (const panel of PANELS_EXPECTING_EYEBROW) {
  const entry = [...contents.entries()].find(([file]) => path.basename(file) === panel);

  if (entry === undefined) {
    failures.push(`找不到 ${panel}`);
    continue;
  }
  if (!/<Eyebrow\s+[^>]*index=/.test(entry[1])) {
    failures.push(`${panel} 的分区标题未使用带索引号的 Eyebrow（AC6）`);
  }
}

// ── ⑤ 水印：空态与页脚各至少一处 ──
const watermarkUsers = [...contents.entries()].filter(
  ([file, text]) => !file.endsWith('.css') && text.includes('wb-watermark'),
);

if (watermarkUsers.length < 2) {
  failures.push(`低对比水印使用位不足（需要 ≥2：空态 + 页脚），当前 ${watermarkUsers.length}`);
}

// ── ⑥ 索引号必须是 3 位（formatIndex 实现处校验） ──
const formatEntry = [...contents.entries()].find(([file]) => path.basename(file) === 'format.ts');

if (formatEntry === undefined || !/padStart\(3,\s*'0'\)/.test(formatEntry[1])) {
  failures.push('formatIndex 未按 3 位补零（AC6 要求 3 位索引号）');
}

// ── ⑦ 数据路径零 innerHTML（PLAN §9 台账 B15「公网刚需」的自动化断言）──
//
// 这条的价值不在"现在有没有"（现状是没有），而在**防止它以后被写回来**：
// innerHTML / dangerouslySetInnerHTML 是 XSS 最直接的入口，而"只是拼一个字符串"
// 看起来永远人畜无害。将来真要渲染富文本，请走显式白名单组件（而不是放开这条）。
const DANGEROUS_HTML = /\binnerHTML\b|dangerouslySetInnerHTML/;

for (const [file, text] of contents) {
  text.split('\n').forEach((line, position) => {
    if (!DANGEROUS_HTML.test(line)) return;
    if (/^\s*(?:\*|\/\/|\/\*)/.test(line)) return; // 注释里讨论不算
    failures.push(
      `${rel(file)}:${position + 1} 出现 innerHTML（B15 禁止数据路径注入 HTML）：${line.trim()}`,
    );
  });
}

// ── 汇总 ──
if (failures.length > 0) {
  console.error(`✗ 视觉自检失败（${failures.length} 项）：`);
  for (const item of failures) console.error(`  · ${item}`);
  process.exit(1);
}

console.log(
  `✓ 视觉自检通过：${REQUIRED_KEYFRAMES.length} 个 keyframes 均有功能位、` +
    `无硬编码字号/字距、${PANELS_EXPECTING_EYEBROW.length} 处分区标题走 eyebrow 体系、` +
    `水印 ${watermarkUsers.length} 处、数据路径零 innerHTML`,
);
