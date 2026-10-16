import { getLanguage, translate, type Language, type MessageKey } from './i18n';

/**
 * 崩溃报告的**纯函数**部分（台账 B61 · 片 A + 片 B）。
 *
 * ## 为什么把它从组件里抽出来
 * 本仓前端**没有 jsdom / @testing-library**（全部前端测试都是纯逻辑，一个 `.test.tsx` 都没有）——
 * 把"拼报告"这段逻辑与 JSX 分开，就能用**现有工具链**覆盖它，组件本身只剩 state + JSX 这点薄壳。
 * 要不要引入 jsdom（从而能写组件渲染测试）是个**决策项**：**用户 2026-10-13 拍板"不引入"**
 * （决策 D52）—— 所以这条纪律继续有效，而且片 B 更彻底：连"通知条"都是**原生 DOM**（见
 * `runtimeErrorNotice.ts`），照样只测纯函数那半。
 *
 * ## 语言迁移第七批：文案全部走字典
 * 本文件是**"非 React 上下文取文案"的第三处**（前两处：`lib/format.ts` 的 `statusLabel`、
 * `components/ErrorBoundary.tsx`）：调用方一个是 class 组件（React 只有 class 能做 error boundary）、
 * 一个是原生 DOM 薄壳，两者都用不了 `useTranslate()`。
 *
 * **语言做成可注入参数**（`language?`，缺省 `getLanguage()`）—— 这不是为了好看：
 * 本文件的纪律一直是"**纯函数不该读全局**"（`now` / `userAgent` 早就是注入的），
 * 而语言同样是全局状态。注入之后，那份在盯措辞的单测可以**直接钉住中英两边**，
 * 不需要去动运行期缓存、也不会因为用例顺序不同而变红。
 *
 * **代价如实登记**：报告在**拼装那一刻**的语言下生成（崩溃面板在 `componentDidCatch` 里拼、
 * 通知条在事件里拼），此后切语言不会让它重新生成 —— 可接受：它们本来就是"事后快照"。
 */

/** 栈只留前 N 行：完整栈几百行，而报障的人只需要"顶层几帧" */
const STACK_HEAD_LINES = 8;

export interface CrashReport {
  /** 兜底面板标题，如「画布出错了」 */
  title: string;
  /** 一句话说明：坏在哪、什么还能用、以及"不是你的数据坏了" */
  summary: string;
  /** 报障用的一段纯文本（位置 / 视图 / 时间 / 消息 / 栈）—— 用户复制这一段即可 */
  details: string;
}

/** 抛出来的可能根本不是 `Error`（`throw '字符串'` / Promise 拒绝一个对象都会发生）——都要能变成一句人话 */
export function describeThrown(thrown: unknown, language: Language = getLanguage()): string {
  if (thrown instanceof Error) {
    return thrown.message === '' ? thrown.name : thrown.message;
  }
  if (typeof thrown === 'string') {
    return thrown === '' ? translate(language, 'error.report.emptyString') : thrown;
  }
  try {
    const json = JSON.stringify(thrown);
    // `undefined` 有三个来源：值本身是 undefined、函数、Symbol（JSON 会静默丢弃它们）
    return json === undefined ? String(thrown) : json;
  } catch {
    // 循环引用 / BigInt 会让 stringify 抛错 —— 退回 String()，绝不让"拼报告"这一步自己炸掉
    return String(thrown);
  }
}

/** 取栈的前 N 行；没有栈就返回空数组（**别在面板上渲染出 "undefined"**） */
export function stackOf(
  thrown: unknown,
  headLines: number = STACK_HEAD_LINES,
  language: Language = getLanguage(),
): string[] {
  const raw = thrown instanceof Error ? thrown.stack : undefined;
  if (raw === undefined || raw === '') return [];
  const lines = raw.split('\n').map((line) => line.trim());
  const head = lines.slice(0, Math.max(1, headLines));
  if (lines.length > head.length) {
    head.push(translate(language, 'error.report.stackTruncated', { total: lines.length }));
  }
  return head;
}

/** 报告里"视图"那一行的取值：hash 为空时得写清楚，否则看起来像被截断了 */
function hashLine(language: Language, key: MessageKey, hash: string): string {
  return translate(language, key, {
    hash: hash === '' ? translate(language, 'error.report.noHash') : hash,
  });
}

/**
 * 拼一份崩溃报告。
 *
 * `now` / `userAgent` / `language` 可注入**只为了可测**（纯函数不该读全局）—— 运行时留空即取真实值。
 */
export function buildCrashReport(input: {
  /** 出错区域的人话名（"画布" / "剪辑台预览" / "界面"） */
  label: string;
  error: unknown;
  /** 出错时的 hash：看一眼就知道是哪个视图崩的 */
  hash: string;
  now?: number;
  userAgent?: string;
  language?: Language;
}): CrashReport {
  const language = input.language ?? getLanguage();
  const message = describeThrown(input.error, language);
  const stack = stackOf(input.error, STACK_HEAD_LINES, language);
  const at = new Date(input.now ?? Date.now()).toLocaleString();
  const ua = input.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);

  const lines = [
    translate(language, 'error.report.line.location', { label: input.label }),
    hashLine(language, 'error.report.line.hash', input.hash),
    translate(language, 'error.report.line.at', { at }),
    translate(language, 'error.report.line.message', { message }),
  ];
  if (stack.length > 0) lines.push(translate(language, 'error.report.line.stack'), ...stack);
  if (ua !== '') lines.push(translate(language, 'error.report.line.userAgent', { ua }));

  return {
    title: translate(language, 'error.report.title', { label: input.label }),
    summary: translate(language, 'error.report.summary'),
    details: lines.join('\n'),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 片 B：window 层的"运行期出错"通知（同一份拼装纪律，但**不是**崩溃面板）
//
// 为什么不复用 buildCrashReport 而另写一个：两者的**读者与后果**不同。
// 崩溃面板说"这一块没渲染出来，你可以切走"（有明确的坏区，且已经降级渲染）；
// 而 window 层的错误**没有坏区可言** —— 出错的那段代码可能已经把某个交互弄哑了，
// 但界面看起来是好的。所以它的三句话必须换：**可能有一块不动了**、**刷新一次**、
// 以及最要紧的**"这条提示只在你本机"**（N2 拍板 = 只本地提示，不上报）。
// 硬把两种语义塞进一个函数，会让片 A 那层已经写清的承诺变模糊。
// ────────────────────────────────────────────────────────────────────────────

/** 运行期错误的两条来路（浏览器给的是两个不同事件） */
export type RuntimeErrorSource = 'script' | 'rejection';

/**
 * 来源 → 文案键（`details` 里用，报障时能一眼看出是哪一类）。
 *
 * V8.51 之前这里是一个 `Record<RuntimeErrorSource, string>` 的**中文常量表**；
 * 迁移时换成键表 —— 常量表在双语下没法用（它只能是一种语言）。
 * 它**只在本文件内使用**，所以顺带撤掉了那个 `export`（无人引用的导出是负债）。
 */
const RUNTIME_ERROR_SOURCE_KEYS: Record<RuntimeErrorSource, MessageKey> = {
  script: 'error.runtime.source.script',
  rejection: 'error.runtime.source.rejection',
};

export interface RuntimeErrorNotice {
  /** 通知条标题 —— 说"出事了"，但不冒充"你这块坏了" */
  title: string;
  /** 一句话：可能哪里哑了、该怎么办、以及**只在你这台机器上** */
  summary: string;
  /** 报障用的一段纯文本 */
  details: string;
  /**
   * 去重签名：同一条错误反复抛（例如在 `requestAnimationFrame` 里）**只提示一次**，
   * 否则通知条会自己变成一场灾难 —— 用户本来就已经遇到一个问题了。
   */
  signature: string;
  /**
   * 是否属于**浏览器的良性噪声** —— 仅用于"照旧留控制台记录，但**不弹给用户看**"。
   *
   * ## 为什么必须有这个字段（这是上线当天就撞上的真实问题）
   * 兜底层第一次跑起来，就在冒烟里抓到了
   * `ResizeObserver loop completed with undelivered notifications.` —— 一条**浏览器自己**的
   * 通知丢失（规范允许、对功能无害，主流错误监控 SDK 都把它列进默认忽略名单）。
   * 但它是以 `error` 事件抛出来的，也就是会被我们接住 —— 若不区分：
   * **一个什么也没做错的用户会看到"界面里有一处代码出错了"**。那比静默更糟：
   * 提示条一旦开始误报，真出事时用户就不看了（狼来了）。
   */
  benign: boolean;
}

/**
 * 浏览器的**良性噪声**（不该拿去惊动用户；仍留在控制台）。
 *
 * 判定用"包含"而不是"等于"：`ErrorEvent.message` 常带前缀（`Uncaught Error: …`），
 * 而这两种写法（新老 Chromium）指的是同一件事。
 *
 * ⚠️ 这两条是**浏览器给的字面量**（英文原文），**不是我们的文案** ——
 * 所以它们**永远不进字典**（翻译它等于把判据改坏；注释里也不写中文，免得被自检扫成文案）。
 */
const BENIGN_RUNTIME_NOISE: readonly string[] = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
];

export function isBenignRuntimeNoise(message: string): boolean {
  return BENIGN_RUNTIME_NOISE.some((needle) => message.includes(needle));
}

/**
 * 拼一条"运行期出错"通知。
 *
 * `source` 必须由调用方给：`window.onerror` 拿不到"这是不是一个未处理的 Promise 拒绝"，
 * 而这两类对报障的人意义不同（前者通常是渲染外的同步代码，后者多半是某条 `fetch().then()` 链）。
 */
export function buildRuntimeErrorNotice(input: {
  source: RuntimeErrorSource;
  error: unknown;
  hash: string;
  now?: number;
  userAgent?: string;
  language?: Language;
}): RuntimeErrorNotice {
  const language = input.language ?? getLanguage();
  const message = describeThrown(input.error, language);
  const stack = stackOf(input.error, STACK_HEAD_LINES, language);
  const at = new Date(input.now ?? Date.now()).toLocaleString();
  const ua = input.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);

  const lines = [
    translate(language, 'error.runtime.line.source', {
      source: translate(language, RUNTIME_ERROR_SOURCE_KEYS[input.source]),
    }),
    hashLine(language, 'error.report.line.hash', input.hash),
    translate(language, 'error.report.line.at', { at }),
    translate(language, 'error.report.line.message', { message }),
  ];
  if (stack.length > 0) lines.push(translate(language, 'error.report.line.stack'), ...stack);
  if (ua !== '') lines.push(translate(language, 'error.report.line.userAgent', { ua }));
  lines.push(translate(language, 'error.runtime.localOnly'));

  return {
    title: translate(language, 'error.runtime.title'),
    summary: translate(language, 'error.runtime.summary'),
    details: lines.join('\n'),
    // 签名只看"来源 + 消息"，**不含栈** —— 这是刻意的取舍：
    // 去重的目的是别刷屏，而"同一条消息在循环里抛 200 次"正是最需要去重的场合
    // （那些次的栈各自都略有不同，一旦把栈写进签名就一条也去不掉）。
    // 代价：两个位置不同但消息相同的错误会合成一条（"另有 N 次同类"那行会说明次数）——
    // 宁可少弹，不可刷屏。
    signature: `${input.source}|${message}`,
    benign: isBenignRuntimeNoise(message),
  };
}

/**
 * 去重时那一行"另有 N 次同类"的文案（`runtimeErrorNotice.ts` 用它原地更新计数）。
 *
 * 为什么单独抽出来：它是**用户可见文案**，而生成它的地方是原生 DOM 薄壳（不可测）。
 * 抽成纯函数后，中英两边与插值都能被钉住 —— 与"报告正文放这里、DOM 只做壳"是同一条纪律。
 */
export function buildRepeatCountLine(count: number, language: Language = getLanguage()): string {
  return translate(language, 'error.runtime.moreCount', { count });
}
