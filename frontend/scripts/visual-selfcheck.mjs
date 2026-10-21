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

// ── ⑬ 画布规模抓手（V2.25 / B44 → S5-C2）──
//
// 与 ⑪⑫ 同一条理由：这几件事在**小数据下完全看不出差别**（节点都在视口里），
// 被摘掉不会有任何症状 —— 直到真有 300 个节点、画布卡住时才发现"开关早就被删了"。
// 行为断言在 S5-C 的 100/300 夹具基线（`.tmp/s5c`），这里钉住**代码事实**。
const CANVAS_STUDIO = path.join(SRC, 'views', 'CanvasStudioView.tsx');
const canvasStudioText = contents.get(CANVAS_STUDIO);

if (canvasStudioText === undefined) {
  failures.push('找不到 views/CanvasStudioView.tsx（S5-C 的视口裁剪与轮询上限都在这里）');
} else {
  if (!canvasStudioText.includes('onlyRenderVisibleElements')) {
    failures.push(
      'CanvasStudioView 未开 `onlyRenderVisibleElements`（S5-C：300 个节点全量建 DOM/' +
        '全量解码，视口外预览也抢带宽）',
    );
  }
  if (
    !canvasStudioText.includes('mapWithConcurrency') ||
    !canvasStudioText.includes('CANVAS_TASK_POLL_CONCURRENCY')
  ) {
    failures.push(
      'CanvasStudioView 的任务轮询没有并发上限（S5-C：几十个 running 任务会每 2s 全量并发打 /api/tasks）',
    );
  }
}

// 后续 ⑭ 起的编排检查仍针对旧 CanvasView（D63 保留一版），不要误用上面的新画布文本。
const CANVAS_VIEW = path.join(SRC, 'views', 'CanvasView.tsx');
const canvasText = contents.get(CANVAS_VIEW);

const STUDIO_NODE = path.join(SRC, 'canvas', 'studio', 'StudioNode.tsx');
const studioNodeText = contents.get(STUDIO_NODE);
if (studioNodeText === undefined) {
  failures.push('找不到 canvas/studio/StudioNode.tsx（S5-C 的预览懒加载在这里）');
} else {
  for (const needle of ['loading="lazy"', 'decoding="async"']) {
    if (!studioNodeText.includes(needle)) {
      failures.push(`StudioNode 的图片预览缺 \`${needle}\`（S5-C：300 张图会同时解码）`);
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

// V2.29（A5 片 B 第二批 / B68）：固定与重试的**界面入口**也必须真的接上 ——
// 领域层有、界面没入口 = 功能不存在（而单测是全绿的：它测的是领域层）。
if (canvasText !== undefined && !canvasText.includes('pinPlanNode')) {
  failures.push('CanvasView 没有用 `pinPlanNode` —— 「📌 固定这条的产物」入口不见了（下游省钱的关键入口）');
}
if (canvasText !== undefined && !canvasText.includes('setPlanNodeRetry')) {
  failures.push('CanvasView 没有用 `setPlanNodeRetry` —— 节点级重试的入口不见了（B74 界面）');
}

// ── V2.35（A5 片 B 收口）：编排文件的导出 / 导入 —— 三条**类型与单测都看不见**的约定 ──
//
// ① **入口与结果位必须真的接在界面上**（同 ⑭ 第二批的理由：领域层有、界面没入口 = 功能不存在，
//    而单测是全绿的 —— 它测的是领域层；"导入失败但界面没动静"更是最糟的形态：用户会反复点）；
// ② 导入必须走 `readCanvasPlanFile`：自己 `JSON.parse` 会绕开**前向兼容**（未来版本明确拒绝）
//    与**图结构检查**（悬挂边 / 重复 id / 自环 / 重复边）—— 那是"坏文件不许装进画布"的唯一闸门；
// ③ 导出必须走 `buildCanvasPlanFile`：手拼文件对象会漏掉 `kind` / `version` / `notes`
//    （而"文件里写明了不含什么"正是这份格式的诚实落点）。
for (const marker of ['cv-export-plan', 'cv-import-plan', 'cv-import-plan-input', 'cv-plan-file-notice']) {
  if (canvasText !== undefined && !canvasText.includes(marker)) {
    failures.push(`CanvasView 缺少编排文件的 \`${marker}\`（V2.35：导出 / 导入的界面入口或结果位不见了）`);
  }
}
if (canvasText !== undefined && !canvasText.includes('readCanvasPlanFile')) {
  failures.push(
    'CanvasView 没有走 `readCanvasPlanFile` 导入 —— 自己解析 JSON 会绕开前向兼容与图结构检查（V2.35）',
  );
}
if (canvasText !== undefined && !canvasText.includes('buildCanvasPlanFile')) {
  failures.push(
    'CanvasView 没有用 `buildCanvasPlanFile` 导出 —— 手拼文件对象会漏掉 kind / version / notes（V2.35）',
  );
}

// ── V2.36（A1 · 后续）：**多台 ComfyUI 的引擎名单必须来自服务端**（不能写死一档）──
//
// 与 ⑭ 同一条理由：写死一档时"功能看起来完全正常"（一台能选、能跑），
// 而**配了三台却只显示一台**这种问题没有任何视觉 / 类型 / 测试症状 —— 只有真配了两台才会发现。
// 同理，自检结果若用「裸索引查表」显示具名实例（`host-comfyui:office`），会显示成**空白**。
const ENGINE_OPTIONS = path.join(SRC, 'lib', 'engineOptions.ts');
const LEFT_PANEL = path.join(SRC, 'components', 'LeftPanel.tsx');
const leftPanelText = contents.get(LEFT_PANEL);
const createViewText = contents.get(path.join(SRC, 'views', 'CreateView.tsx'));

if (contents.get(ENGINE_OPTIONS) === undefined) {
  failures.push(
    '找不到 lib/engineOptions.ts（V2.36 的引擎名单生成器不见了 —— 界面会退回"写死一档"）',
  );
}
for (const [name, text] of [
  ['LeftPanel.tsx', leftPanelText],
  ['CreateView.tsx', createViewText],
]) {
  if (text !== undefined && !text.includes('comfyUiEngineOptions(')) {
    failures.push(
      `${name} 没有用 \`comfyUiEngineOptions\` —— 引擎名单又变成写死的一档（配了多台也只显示一台）`,
    );
  }
}
if (leftPanelText !== undefined) {
  if (!leftPanelText.includes('providerLabel(')) {
    failures.push(
      'LeftPanel 没有用 `providerLabel` 显示自检结果 —— 具名实例（host-comfyui:xxx）会显示成空白',
    );
  }

  // ── V2.37（D56）：H3 那一档**已撤掉** —— 撤掉的东西最容易"悄悄回来" ──
  //
  // 盯的是"决策有没有落到底"：撤掉的是一个**永远不可用的按钮**（点了才知道不行），
  // 而它一旦被谁顺手加回来（比如合并旧分支），界面上不会有任何视觉回归 ——
  // 类型、单测、覆盖率**全绿**，只有真点一次才会发现。
  for (const [name, text, markers] of [
    ['LeftPanel.tsx', leftPanelText, ['PROVIDER_LOCAL', "'local-minimax-h3'"]],
    ['CreateView.tsx', createViewText, ['LOCAL_PROVIDER', "'local-minimax-h3'"]],
  ]) {
    if (text === undefined) continue;
    for (const marker of markers) {
      if (text.includes(marker)) {
        failures.push(
          `${name} 里还有 \`${marker}\` —— H3 那一档已在 V2.37 / D56 **撤掉**，不该再有可选入口`,
        );
      }
    }
  }
  /**
   * **断言点从死代码移到活路径**（语言迁移第十批）：这条原先查 `canvas/labels.ts` 的
   * `CANVAS_PROVIDER_LABELS`，但那张表**零引用**（真正在用的是 `lib/engineOptions.ts` 的
   * `providerLabel`，左栏自检结果走的是它），而且它的文案已经与活路径**漂移**
   * （`素材库（开发期）` vs `（未实现）`、`夹具（开发期）` vs `开发期夹具`）。
   * 迁移期间把死表删掉了，所以断言改查**活路径** —— 否则它守的是一张不渲染的表。
   *
   * ⚠️ 将来 `lib/engineOptions.ts` 也迁进字典时，这条要跟着改成查**字典值**
   * （那时的正确形态：断言 `common.provider.h3` 的中文里带「（已撤）」）。
   */
  const engineLabelsText = contents.get(path.join(SRC, 'lib', 'dict', 'common.ts'));
  if (engineLabelsText !== undefined && !engineLabelsText.includes('本地 MiniMax H3（已撤）')) {
    failures.push(
      '字典的 common.engine.h3Revoked 没把 H3 标成「（已撤）」—— 历史任务 / 旧编排里出现这个值时会显示成一个还在的档位（V2.37）',
    );
  }

  // ── V2.38（L1 · 语言迁移第一批）：**已迁到字典的文件里不得再有硬编码中文文案** ──
  //
  // 为什么这条必须有：迁移是**逐文件**推进的，而"漏了一个按钮的文案"不会有任何回归信号 ——
  // 切到英文时**那一处单独显示中文**，而类型、单测、覆盖率全绿（没人切过英文）。
  // 这条把"已迁完"变成**机器可查的清单**：迁完一个文件就加进 `I18N_MIGRATED`，
  // 之后谁再往里面写死中文，这里立刻红。
  //
  // 判据 = "这一行（去掉注释后）还含中文"：注释是中文写的（本仓文化），不算文案。
  const I18N_MIGRATED = [
    'App.tsx',
    'main.tsx',
    'components/Sidebar.tsx',
    'components/AssetDropZone.tsx',
    'components/ByokDrawer.tsx',
    'components/CenterPanel.tsx',
    'components/ErrorBoundary.tsx',
    'components/GalleryCard.tsx',
    'components/LeftPanel.tsx',
    'components/ProjectSwitcher.tsx',
    'components/RightPanel.tsx',
    'components/UncertainNotice.tsx',
    'views/registry.ts',
    'views/CreateView.tsx',
    'views/WorkbenchView.tsx',
    'lib/byok.ts',
    'lib/theme.ts',
    'lib/errorReport.ts',
    'lib/runtimeErrorNotice.ts',
    'canvas/NoteCard.tsx',
    'canvas/PlanNodeCard.tsx',
    'canvas/PlanInspector.tsx',
    'canvas/labels.ts',
    'lib/canvasPlan.ts',
    'lib/canvasPlanRunner.ts',
    'views/CanvasView.tsx',
    'canvas/NodeCard.tsx',
    'lib/format.ts',
    'lib/libraryFilter.ts',
    'views/LibraryView.tsx',
    'lib/costView.ts',
    'views/CostsView.tsx',
    'views/RecipesView.tsx',
    'views/LogsView.tsx',
    'views/OverviewView.tsx',
    'lib/api.ts',
    'lib/assets.ts',
    'lib/deliverablePackage.ts',
    'lib/engineOptions.ts',
    'lib/i18n.ts',
    'lib/lineage.ts',
    'lib/mentions.ts',
    'lib/overviewStats.ts',
    'lib/presetTranscode.ts',
    'lib/projects.ts',
    'lib/shell.ts',
    'lib/workerClient.ts',
    'lib/zipStore.ts',
    'lib/recipes.ts',
    'lib/canvasPlanFile.ts',
    'edit/model.ts',
    'edit/clipProperties.ts',
    'edit/draft.ts',
    'edit/DraftHistory.tsx',
    'edit/ExportPanel.tsx',
    'edit/InspectorPanel.tsx',
    'edit/mediaProbe.ts',
    'edit/PlayerStage.tsx',
    'edit/store.ts',
    'edit/Timeline.tsx',
    'edit/TimelineClip.tsx',
    'views/EditView.tsx',
    'views/UnknownView.tsx',
  ];
  const CJK_PATTERN = /[\u4e00-\u9fa5]/;
  for (const rel of I18N_MIGRATED) {
    const text = contents.get(path.join(SRC, rel));
    if (text === undefined) {
      failures.push(`i18n 迁移清单里的 ${rel} 不存在 —— 清单过期了（改完文件记得同步这里）`);
      continue;
    }
    // 状态机要覆盖**两种**块注释：JSX 注释 `{/* … */}` 与普通块注释 `/* … */`
    // （后者出现在 `return (` 之后 —— 那不是 JSX 注释，漏掉它会把注释续行误判成文案）
    let inComment = false;
    /** 上一行写了 `// i18n-exempt: <理由>` → 这一行被申请豁免（逐行、不扩散） */
    let exemptNext = false;
    text.split('\n').forEach((line, index) => {
      const carved = line.replace(/\r$/, '');
      const marked = /\/\/\s*i18n-exempt:\s*\S/.test(carved);
      const exempted = exemptNext;
      exemptNext = marked; // 只对**紧邻的下一行**生效；空行会自然把它清掉
      if (exempted) return;
      if (inComment) {
        if (line.includes('*/')) inComment = false;
        return;
      }
      if (/^\s*(\{\/\*|\/\*)/.test(line)) {
        if (!line.includes('*/')) inComment = true;
        return;
      }
      // 单行注释：`//`（行注释）与 `*`（JSDoc 续行）
      if (/^\s*(\/\/|\*)/.test(line)) return;
      /**
       * **开发者输出不是文案**：`console.*` 是写给开 DevTools 的人看的。
       *
       * 判据故意写成**"行首就是 `console.`"**，而不是"这一行含 console"：
       * 后者会给"把用户文案塞进一个变量名带 console 的调用里"开口子，
       * 那这条断言就等于没了。例外目前只有一个真实用例
       * （`lib/runtimeErrorNotice.ts` 的两条前缀：`[运行期错误]` / `[运行期噪声·已忽略，不提示]`）——
       * 它们**必须**保持中文：用户贴过来的控制台片段若随界面语言变成两种语言，
       * 报障时的比对与检索就没法做了。
       */
      if (/^\s*console\./.test(line)) return;
      /**
       * **逐行申请的第二类例外**（语言迁移第十批新增）：`// i18n-exempt: <理由>`。
       *
       * 与上面 `console.` 那种分工：`console.` 是"**整类**自动豁免"（那一类里不可能有界面文案）；
       * 这里处理的是**零散但合理**的中文 —— 目前只有两种，都不该进字典：
       * ① **判据字面量**：`canvasPlanRunner.ts` 的重试判据要认出上游回的"超时"，
       *    而该口径写在契约 §11-6 第 10 条（`Failed to fetch` / 超时 / ECONN 系列）——
       *    它不是文案，是**匹配模式**；
       * ② **数据默认值**：`createEmptyPlan` 的 `'未命名编排'` 会**落本机存储并被导出成文件**，
       *    属"内容 / 数据"，与配方名 / 模板名同一条口径（内容不进字典，见 `dict/index.ts`）。
       *
       * 判据（三条都是刻意的）：
       * 1. **行内必须有非空理由**（`\S`）—— 空的 `// i18n-exempt:` 不算数；
       * 2. **紧邻**才算：写在要豁免的那一行上（尾注释），或紧接它的**上一行**
       *    （写成"说明在前、标记在后"，别让中间再隔注释 —— 实测踩到：隔一行就失效，
       *    而那正是"标记写了却没生效"的形态）；
       * 3. 只对**紧邻的下一行**生效，不扩散（空行会自然清掉它）。
       *    → 由此推出：**多行数组 / 多行模板每条都要各标一次**（`lib/lineage.ts` 的 `notes` 就是），
       *      别指望一个标记覆盖一个块 —— 那正是"以为标了、其实没标上"的来源。
       *
       * 它比 `console.` 那类**更严**：逐行申请、必须写清为什么，而理由会出现在 diff 里 ——
       * **想拿它盖住一句真实界面文案，在 code review 里是显眼的**（这正是它优于"悄悄漏一条"的地方）。
       */
      if (/\/\/\s*i18n-exempt:\s*\S/.test(line)) return;
      /**
       * 去掉行尾 `// 注释` 再判（对 `https://` 这类字符串无害：我们只问"还含中文吗"）。
       *
       * ⚠️ 这里**不能写 `\/\/.*$`**（2026-10-16 真实踩到）：本仓检出是 **CRLF**，
       * 而 `.` 不匹配 `\r`、`$`（无 `m`）又只认字符串末尾 —— 于是 `// 中文注释` 剥不掉，
       * 一条**合法的行尾注释**被报成"硬编码中文文案"。
       * 更阴的是它**只在 Windows/CRLF 下失败**（Linux CI 上是 LF，会静默放过）：
       * 同一份代码"本地红、CI 绿"，正是本仓最想避免的那类"只有一处看得见"。
       * 去掉 `$` 锚点即可（`.*` 不吃 `\r`，但允许它留在后面）。
       */
      if (!CJK_PATTERN.test(line.replace(/\/\/.*/, ''))) return;
      failures.push(
        `${rel}:${index + 1} 还有硬编码中文文案（该文件已迁进字典，文案必须走 t()）—— ${line.trim().slice(0, 60)}`,
      );
    });
  }

  // 同一条线的另一头：**迁移未完成时不许跟随浏览器语言**。
  //
  // 防空的是"半中半英"：英文浏览器的访客没点过任何东西，若 detectLanguage 跟随
  // `navigator.language`，他会看到一个只翻译了一半的界面 —— 比只有中文更糟。
  // 这条静态断言盯住"开关真的接在判定链上"（去掉它不会有任何别的信号）。
  const i18nText = contents.get(path.join(SRC, 'lib', 'i18n.ts'));
  /**
   * 同一条线的第三头（V2.38 上线）：**切换入口必须存在且真的会切换**。
   *
   * 为什么要机器盯：`I18N_MIGRATION_COMPLETE` 一翻 true，"跟随浏览器语言"就生效了 ——
   * 若此时**没有任何入口**让用户改回来，英文浏览器用户会被永久锁在英文界面
   * （他能做的只有去 DevTools 清 localStorage）。所以这两件事必须同时成立：
   * 开关 true + 入口在（且调用 `setLanguage`）。
   */
  const sidebarText = contents.get(path.join(SRC, 'components', 'Sidebar.tsx'));
  if (sidebarText !== undefined && !sidebarText.includes('setLanguage(')) {
    failures.push(
      'Sidebar 没有语言切换入口（`setLanguage(`）—— 迁移已完成、会跟随浏览器语言，但用户改不回来（V2.38 上线）',
    );
  }

  if (i18nText !== undefined && !i18nText.includes('I18N_MIGRATION_COMPLETE')) {
    failures.push(
      'i18n.ts 没有用 `I18N_MIGRATION_COMPLETE` —— 「迁移未完成时忽略浏览器偏好」这条防线没了（V2.38）',
    );
  }
  for (const stale of ['PROVIDER_COMFY', 'CANVAS_PROVIDER_LABELS[']) {
    if (leftPanelText.includes(stale)) {
      failures.push(`LeftPanel 里仍有 \`${stale}\`（V2.36 起实例名单必须来自 /status，不能写死一档）`);
    }
  }
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
    `编排文件入口与失败纪律就位（V2.35：读走 readCanvasPlanFile / 写走 buildCanvasPlanFile + 结果位）、` +
    `多实例引擎名单就位（V2.36：名单来自 /status、两处入口共用一份、自检走 providerLabel）、` +
    `i18n 迁移清单就位（V2.38：已迁文件零硬编码中文 + 未完成时不跟随浏览器语言）、` +
    `window 层兜底就位且零上报（B61 片 B：两个事件 + D52 只本地提示）`,
);
