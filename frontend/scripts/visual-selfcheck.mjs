import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

/**
 * keyframes 登记表（AC5 要求全部有实际使用位）。
 *
 * V9 · B6 从 8 个扩到 11 个：新增的 3 个属于"界面级动效体系"（呼吸微光晕 / 卡片级联 / 骨架扫光），
 * 全部只动 transform/opacity。**新增动效必须登记在这里** —— 下面的"计划外 keyframe"检查
 * 就是防止有人随手往 tokens.css 里塞动画而没人知道它从哪来、为什么在。
 */
const REQUIRED_KEYFRAMES = [
  'star-gather',
  'mira-breathe',
  'mira-orbit-turn',
  'origin-orbit-sway',
  'flow',
  'motion-bootstrap',
  'breathe-glow',
  'card-rise',
  'skeleton-sweep',
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

/**
 * 剥掉 **块注释**（斜杠星号到星号斜杠之间的部分）再判定，**保留换行数**（行号不能错位）。
 *
 * 为什么必须剥（两个方向都真实踩过，2026-09-23 B6 破坏性验证当场发现）：
 * - **漏检**：把 `animation: breathe-glow …` 注释掉之后，正则仍在注释里匹配到它 →
 *   "挂接被摘掉"检不出来（这是更危险的方向）；
 * - **误报**：注释里写"别用 font-size: 0 那种写法"会被 ③ 当成真实硬编码。
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

// ── ① keyframes：定义集合必须恰好一致，且每一个都有功能位使用 ──
const declared = [...stripComments(tokensText).matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);

for (const name of REQUIRED_KEYFRAMES) {
  if (!declared.includes(name)) {
    failures.push(`tokens.css 缺少 keyframe \`${name}\``);
    continue;
  }

  const used = [...contents.entries()].some(([file, text]) => {
    if (path.resolve(file) === TOKENS) return false; // 定义处不算使用
    return new RegExp(`animation(?:-name)?\\s*:[^;]*\\b${name}\\b`).test(stripComments(text));
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

  stripComments(text)
    .split('\n')
    .forEach((line, position) => {
      if (!HARDCODED_SIZE.test(line)) return;
      // 行内注释的兜底豁免（剥块注释后仍可能剩下 `//` 说明）
      if (/^\s*(?:\*|\/\/)/.test(line)) return;
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

// ── ⑧ index.html 不得引用任何跨源资源（生产 CSP 下必被拦）──
//
// 这条来自 2026-09-22 实测到的真实缺陷：`index.html` 曾外链 `fonts.googleapis.com`，
// 而生产 CSP 是 `style-src 'self'` / `font-src 'self'` → **线上字体被拦**，
// 本地开发却"看着正常"（开发环境按设计不开 CSP），于是形成"只有线上才看得见"的视觉偏差。
// 浏览器级冒烟（`scripts/smoke-ui.mjs`）能抓到它，这里再用静态检查把同一类问题挡在更早的一层
// （秒级、不需要浏览器、不需要构建产物）。
const INDEX_HTML = path.join(ROOT, 'index.html');

if (!existsSync(INDEX_HTML)) {
  failures.push('找不到 frontend/index.html');
} else {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const crossOrigin = [...html.matchAll(/(?:href|src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map(
    (match) => match[1],
  );

  if (crossOrigin.length > 0) {
    failures.push(
      `index.html 引用了跨源资源（生产 CSP 的 style-src/font-src/script-src 均为 'self'，` +
        `线上必被拦）：${crossOrigin.join(', ')}`,
    );
  }
}

// ── ⑨ 非 tokens 文件零硬编码色值（主题化的前提）──
//
// 来自 2026-09-22 的主题改造：组件层原先散着 13 处 `rgba(...)`（本质都是"token 色 + alpha"），
// 它们会**绕过主题**——日间模式下仍然是暗色主题的那几个数值。收进 tokens.css 之后，
// 这条断言防止以后有人"顺手写一个颜色"又把主题撕出一个洞。
const HARDCODED_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

for (const [file, text] of contents) {
  if (path.resolve(file) === TOKENS) continue;

  text.split('\n').forEach((line, position) => {
    if (!HARDCODED_COLOR.test(line)) return;
    if (/^\s*(?:\*|\/\/|\/\*)/.test(line)) return; // 注释里讨论不算
    failures.push(
      `${rel(file)}:${position + 1} 出现硬编码色值（应改用 tokens.css 的变量，否则日间主题会漏）`,
    );
  });
}

// ── ⑩ 两套主题的对比度（WCAG 相对亮度公式，逐对核算）──
//
// 为什么放进静态检查：对比度是"眼睛会骗人"的典型 —— 上次调参就出现过
// "看着够" 而实测 3.64:1 的情况。这里按公式算，谁改 token 谁立刻知道。
const THEMES = [
  { name: '暗色（:root）', pattern: /:root\s*\{([^}]*)\}/ },
  { name: '日间（:root[data-theme=day]）', pattern: /:root\[data-theme='day'\]\s*\{([^}]*)\}/ },
];

function parseTokens(blockText) {
  const tokens = {};
  for (const match of blockText.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

function toRgb(value) {
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (hex) {
    const raw = hex[1];
    const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgba) {
    const parts = rgba[1].split(',').map((part) => Number.parseFloat(part.trim()));
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
      return parts.slice(0, 3);
    }
  }
  return null;
}

function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/** [前景 token, 背景 token, 最低比值, 说明] —— 正文类按 WCAG AA 4.5；低对比水印按 AC5 的定位放宽到 3.0 */
const CONTRAST_RULES = [
  ['text', 'bg', 4.5, '正文 / 页面底'],
  ['text', 'panel', 4.5, '正文 / 卡片'],
  ['muted', 'panel', 4.5, '次要文字 / 卡片'],
  ['gold', 'panel', 4.5, '主色（eyebrow / 描边 / 主按钮） / 卡片'],
  ['on-action', 'action-fill', 4.5, '主按钮文字 / 主按钮底'],
  ['faint', 'panel', 3.0, '低对比水印字标（AC5 明确要求"低对比"）'],
  // V8.3 批次 7：放映区在两套主题下都是深色，区内的文字用独立的 --canvas-* 那一组。
  // 这三条正是"日间模式下放映区文字看不见"那类缺陷的**机器兜底**（眼睛会骗人，公式不会）。
  ['canvas-text', 'canvas', 4.5, '放映区标题 / 深色放映底'],
  ['canvas-muted', 'canvas', 4.5, '放映区说明与时间码 / 深色放映底'],
  ['canvas-danger', 'canvas', 4.5, '放映区告警 / 深色放映底'],
];

for (const theme of THEMES) {
  const block = theme.pattern.exec(tokensText);
  if (block === null) {
    failures.push(`tokens.css 缺少主题块：${theme.name}`);
    continue;
  }

  const tokens = parseTokens(block[1]);

  for (const [fgName, bgName, min, label] of CONTRAST_RULES) {
    const fg = toRgb(tokens[fgName] ?? '');
    const bg = toRgb(tokens[bgName] ?? '');

    if (fg === null || bg === null) {
      failures.push(`${theme.name} 的 --${fgName} / --${bgName} 无法解析（${label}）`);
      continue;
    }

    const ratio = contrastRatio(fg, bg);
    if (ratio < min) {
      failures.push(
        `${theme.name} 对比度不足：${label} 实测 ${ratio.toFixed(2)}:1 < ${min}:1（--${fgName} on --${bgName}）`,
      );
    }
  }
}

// ── ⑪ 崩溃兜底层还在（台账 B61）──
//
// 为什么静态查得动：兜底层是**不可见**的 —— 它不渲染任何东西（没出错时），
// 因此"被摘掉"不会有任何视觉回归、不会有类型错误、测试也不会红。
// 唯一能被摘掉的方式就是**有人动了这段代码**，而那正是这里要挡的：
// ① 把 class 组件"现代化"成函数组件（React 至今没有函数式 error boundary ——
//    换掉之后 `getDerivedStateFromError` / `componentDidCatch` 消失，兜底**静默失效**）；
// ② 把 `<ErrorBoundary>` 从渲染路径上摘掉（"这层好像没用"）。
const BOUNDARY = path.join(SRC, 'components', 'ErrorBoundary.tsx');
const boundaryText = contents.get(BOUNDARY);

if (boundaryText === undefined) {
  failures.push('找不到 components/ErrorBoundary.tsx（B61 的兜底层不见了）');
} else {
  for (const api of ['getDerivedStateFromError', 'componentDidCatch']) {
    if (!boundaryText.includes(api)) {
      failures.push(
        `ErrorBoundary 不再实现 \`${api}\`（B61）：React 只有 class 组件能做 error boundary，` +
          '改成函数组件会**静默失去**全部兜底能力',
      );
    }
  }
}

/** 顶层（main.tsx）必须包住 App —— 壳自身崩掉时那是唯一还剩的出口 */
const MAIN = path.join(SRC, 'main.tsx');
const mainText = contents.get(MAIN);

if (mainText === undefined || !/<ErrorBoundary[\s>]/.test(mainText)) {
  failures.push('main.tsx 未用 <ErrorBoundary> 包住 App（B61：壳自身渲染抛错会直接白屏）');
}

/**
 * 壳里每个视图各一层：数一下 `<ErrorBoundary` 的出现次数。
 * 3 = 工作台 / 创作入口（两个 keep-alive 常驻视图）+ ActiveView（按路由切换的那个）。
 * 少于 3 就是有人摘掉了一层 —— 而**摘掉一层不会有任何可见症状**（只会在真出事时才暴露）。
 */
const APP = path.join(SRC, 'App.tsx');
const appText = contents.get(APP);
const boundaryUses = appText === undefined ? 0 : (appText.match(/<ErrorBoundary[\s>]/g) ?? []).length;

if (boundaryUses < 3) {
  failures.push(
    `App.tsx 只有 ${boundaryUses} 处 <ErrorBoundary>（B61 要求 ≥3：两个 keep-alive 视图 + 路由视图）`,
  );
}

/**
 * 从 `marker` 起取出**平衡大括号**包住的那一段（CSS 块体）。
 * 用平衡计数而不是正则 —— 媒体查询块里还会嵌规则块，正则数不清嵌套。
 * 返回**全部**匹配（同一文件里可能有多个同名断点块）。
 */
function cssBlocks(text, marker) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(marker, from);
    if (start < 0) return blocks;
    const open = text.indexOf('{', start);
    if (open < 0) return blocks;
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          blocks.push(text.slice(open + 1, i));
          from = i + 1;
          break;
        }
      }
    }
    if (from <= start) return blocks; // 防御：不应发生（块未闭合时避免死循环）
  }
}

// ── ⑫ 移动端四件套（台账 B60）──
//
// 与第 ⑪ 条同一条理由：这四项全是**不可见**的 CSS 规则（窄屏断点覆盖 / 触屏 hover 兜底 /
// dvh 兜底 / 字号下限）—— 在桌面浏览器上看不出差别、删掉也不会有任何测试变红。
// 静态钉住"它们还在，且形状正确"，真正的行为断言在 UI 冒烟的 [7c] 段（390×844）。
const workbenchText = contents.get(path.join(SRC, 'styles', 'workbench.css'));

if (workbenchText === undefined) {
  failures.push('找不到 styles/workbench.css（B60 的四项收口都在这里与 tokens.css）');
}

const hoverBlock = cssBlocks(workbenchText ?? '', '@media (hover: none)')[0] ?? '';

if (hoverBlock === '') {
  failures.push('workbench.css 缺 @media (hover: none) 块（B60：触屏没有 hover，靠它点亮操作入口）');
} else {
  for (const selector of ['.lib-acts', '.wb-card-play']) {
    if (!hoverBlock.includes(selector)) {
      failures.push(`@media (hover: none) 块里缺 ${selector}（B60：触屏下它必须常显）`);
    }
  }
}

/** ② 日志行窄屏覆盖：六列在 375px 必溢出 → 必须在某个 ≤768 块里改成两列 */
const narrowBlocks = cssBlocks(workbenchText ?? '', '@media (max-width: 768px)');
if (!narrowBlocks.some((block) => block.includes('.wb-log-row-main'))) {
  failures.push('workbench.css 的 768 断点未覆盖 .wb-log-row-main（B60：六列在手机上横向溢出会被剪掉）');
}

/** ③ 字号下限：≤768 时 --fs-note / --fs-micro 必须 ≥12px（10~11px 档在手机上不可读） */
const tokenNarrow = cssBlocks(tokensText, '@media (max-width: 768px)')[0] ?? '';
if (tokenNarrow === '') {
  failures.push('tokens.css 缺 ≤768 的字号覆盖块（B60：小字号档在手机上不可读）');
} else {
  for (const token of ['--fs-note', '--fs-micro']) {
    const matched = tokenNarrow.match(new RegExp(`${token}\\s*:\\s*(\\d+)px`));
    if (matched === null) {
      failures.push(`tokens.css 的 ≤768 块未重定义 ${token}（B60）`);
    } else if (Number(matched[1]) < 12) {
      failures.push(`${token} 的移动端值 ${matched[1]}px < 12px（B60 的可读性下限）`);
    }
  }
}

/** ④ dvh 兜底：每个 `100vh` 的下一行必须是同前缀的 `100dvh`（旧浏览器忽略 dvh 用 vh） */
for (const [file, text] of contents) {
  if (!file.endsWith('.css')) continue;
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (!line.includes('100vh')) return;
    const next = lines[index + 1] ?? '';
    if (!next.includes('100dvh')) {
      failures.push(`${rel(file)}:${index + 1} 的 100vh 没有 100dvh 兜底行（B60）`);
    }
  });
}

/** ⑤ 触屏点击高亮必须被关掉（否则移动浏览器给一层与主题不符的蓝框） */
const hasTapHighlight = [...contents.values()].some((text) =>
  text.includes('-webkit-tap-highlight-color: transparent'),
);
if (!hasTapHighlight) {
  failures.push('没有任何 CSS 关掉 -webkit-tap-highlight-color（B60：触屏点击高亮与主题不符）');
}

// ── ⑬ 画布规模的两个抓手（V2.25 / 台账 B44）──
//
// 与 ⑪⑫ 同一条理由：这两件事在**小数据下完全看不出差别**（一页 50 条以内、节点都在视口里），
// 被摘掉不会有任何症状 —— 直到真有几百条任务、画布卡住时才发现"开关早就被删了"。
// 行为断言在冒烟 [7e] 段（注入 120 条后验分页与裁剪），这里钉住**代码事实**（开关与调用形态）。
const CANVAS_VIEW = path.join(SRC, 'views', 'CanvasView.tsx');
const canvasText = contents.get(CANVAS_VIEW);

if (canvasText === undefined) {
  failures.push('找不到 views/CanvasView.tsx（B44 的分页与视口裁剪都在这里）');
} else {
  if (!canvasText.includes('onlyRenderVisibleElements')) {
    failures.push(
      'CanvasView 未开 `onlyRenderVisibleElements`（B44：一百多个节点一列排开时，' +
        'fitView 被 minZoom 钳住 —— 大多数节点在视口外，全量建 DOM 是纯浪费）',
    );
  }
  for (const needle of ['limit: CANVAS_PAGE_SIZE', 'before: page.before']) {
    if (!canvasText.includes(needle)) {
      failures.push(
        `CanvasView 的分页调用缺 \`${needle}\`（B44：没有游标时「加载更早」会反复取回同一页）`,
      );
    }
  }
}

// ── ⑭ 编排模式的两个"会花钱"的约定（V2.26 / 台账 A5 片 A）──
//
// 与 ⑪⑫⑬ 同一条理由：不走一遍完全看不出来，而失效方式要么是**真花钱**（随机键 → 重复提交），
// 要么是功能静默消失（编排模式进不去）。行为断言在冒烟 [7e] 的编排子段（真提交 + 幂等复验）。
const RUNNER = path.join(SRC, 'lib', 'canvasPlanRunner.ts');
const runnerText = contents.get(RUNNER);

if (runnerText === undefined) {
  failures.push('找不到 lib/canvasPlanRunner.ts（A5 片 A 的编排执行器不见了）');
} else {
  if (!runnerText.includes('planIdempotencyKey(')) {
    failures.push(
      '编排执行器没有用确定性的 `planIdempotencyKey` —— 随机键意味着每次点「运行」都是一次新提交（真花钱）',
    );
  }
  if (runnerText.includes('newIdempotencyKey')) {
    failures.push(
      '编排执行器引用了 `newIdempotencyKey`（随机键）—— 那是单次手动提交用的；编排必须用确定性键',
    );
  }
  // V2.29（A5 片 B / B69）：**代数必须进幂等键**。漏了它的症状是"点了没反应"：
  // 代数换了、键没换 → 提交仍然命中上一代的任务 → 用户以为重跑了，其实什么都没发生（还白等）。
  if (!runnerText.includes('planIdempotencyKey(plan.id, nodeId, runSeq)')) {
    failures.push(
      '编排执行器没有把**运行代数**传进幂等键（`planIdempotencyKey(plan.id, nodeId, runSeq)`）—— ' +
        '「🔁 重跑」会变成"点了没反应"',
    );
  }
}

if (canvasText !== undefined && !canvasText.includes("query.get('mode') === 'plan'")) {
  failures.push('CanvasView 没有读 `mode=plan`（A5 片 A 的编排模式入口没了）');
}

// V2.29（A5 片 B / B69）：重跑入口（换键）必须真的接在界面上 —— 没有它，"重跑"这个能力
// 在界面上等于不存在，而**单测全绿也不会知道**（runner 的换键逻辑照样被测到）。
if (canvasText !== undefined && !canvasText.includes('bumpPlanRun')) {
  failures.push(
    'CanvasView 没有用 `bumpPlanRun` —— 「🔁 重跑」入口不见了（只剩幂等的「运行」，用户无法换键重跑）',
  );
}

// ── ⑮ window 层运行期兜底还在，且**没有偷偷上报**（台账 B61 片 B / 决策 D52）──
//
// 与 ⑪ 同一条理由：这一层在**没出错时什么都不渲染** —— 被摘掉不会有任何视觉回归、
// 类型错误或测试变红。而它一旦"顺手加上报"，性质就变了：D52 定的是**只本地提示**，
// 上报等于把用户的运行时错误送出这台机器，那正是用户明确不要的那一项。
// 行为断言在冒烟 [7f] 段（真抛一个错 → 真看到提示条 → 真点关闭）。
const NOTICE = path.join(SRC, 'lib', 'runtimeErrorNotice.ts');
const noticeText = contents.get(NOTICE);
// 复用上面第 ⑪ 条读到的 `mainText`（同一个 main.tsx，别再读一遍）

if (mainText === undefined || !mainText.includes('installRuntimeErrorNotice()')) {
  failures.push(
    'main.tsx 没有安装 `installRuntimeErrorNotice()`（B61 片 B：事件回调与 Promise 里的抛错' +
      '会退回"静默白屏"，只能开 DevTools 才看得见）',
  );
}

if (noticeText === undefined) {
  failures.push('找不到 lib/runtimeErrorNotice.ts（B61 片 B 的 window 层兜底不见了）');
} else {
  for (const listener of ["addEventListener('error'", "addEventListener('unhandledrejection'"]) {
    if (!noticeText.includes(listener)) {
      failures.push(`window 层兜底没有监听 \`${listener}\`（B61 片 B）`);
    }
  }
  for (const sink of ['fetch(', 'sendBeacon', 'XMLHttpRequest']) {
    if (noticeText.includes(sink)) {
      failures.push(
        `window 层兜底里出现了 \`${sink}\` —— D52 定的是**只本地提示**：` +
          '上报会把用户的运行时错误送出这台机器',
      );
    }
  }
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
    `水印 ${watermarkUsers.length} 处、数据路径零 innerHTML、index.html 零跨源资源、` +
    `组件层零硬编码色值、两套主题对比度全部达标（${CONTRAST_RULES.length} 对 × ${THEMES.length} 套）、` +
    `移动端四件套就位（B60：窄屏日志 / hover 兜底 / dvh / 字号下限）、` +
    `画布规模抓手就位（B44：分页游标 + 视口裁剪）、` +
    `编排的三个花钱约定就位（A5 片 A+B：确定性幂等键 + 代数换键的重跑入口 + mode=plan 入口）、` +
    `window 层兜底就位且零上报（B61 片 B：两个事件 + D52 只本地提示）`,
);
