/**
 * 崩溃报告的**纯函数**部分（V2.24 / 台账 B61 · 片 A）。
 *
 * ## 为什么把它从组件里抽出来
 * 本仓前端**没有 jsdom / @testing-library**（全部前端测试都是纯逻辑，一个 `.test.tsx` 都没有）——
 * 把"拼报告"这段逻辑与 JSX 分开，就能用**现有工具链**覆盖它，组件本身只剩 state + JSX 这点薄壳。
 * 要不要引入 jsdom（从而能写组件渲染测试）是个**决策项**（见 PENDING-DECISIONS）；
 * 在它被拍板前，不为一个组件往依赖里加两个包 —— 这是本仓一贯的做法（能用断言就用断言，不说"测不了"）。
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
export function describeThrown(thrown: unknown): string {
  if (thrown instanceof Error) {
    return thrown.message === '' ? thrown.name : thrown.message;
  }
  if (typeof thrown === 'string') {
    return thrown === '' ? '(空的字符串)' : thrown;
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
export function stackOf(thrown: unknown, headLines: number = STACK_HEAD_LINES): string[] {
  const raw = thrown instanceof Error ? thrown.stack : undefined;
  if (raw === undefined || raw === '') return [];
  const lines = raw.split('\n').map((line) => line.trim());
  const head = lines.slice(0, Math.max(1, headLines));
  if (lines.length > head.length) {
    head.push(`…（共 ${lines.length} 行，已截断）`);
  }
  return head;
}

/**
 * 拼一份崩溃报告。
 *
 * `now` / `userAgent` 可注入**只为了可测**（纯函数不该读全局）——运行时留空即取真实值。
 */
export function buildCrashReport(input: {
  /** 出错区域的人话名（"画布" / "剪辑台预览" / "界面"） */
  label: string;
  error: unknown;
  /** 出错时的 hash：看一眼就知道是哪个视图崩的 */
  hash: string;
  now?: number;
  userAgent?: string;
}): CrashReport {
  const message = describeThrown(input.error);
  const stack = stackOf(input.error);
  const at = new Date(input.now ?? Date.now()).toLocaleString();
  const ua = input.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);

  const lines = [
    `位置：${input.label}`,
    `视图：${input.hash === '' ? '(无 hash)' : input.hash}`,
    `时间：${at}`,
    `消息：${message}`,
  ];
  if (stack.length > 0) lines.push('栈（前几帧）：', ...stack);
  if (ua !== '') lines.push(`浏览器：${ua}`);

  return {
    title: `${input.label}出错了`,
    summary:
      '这一块没有渲染出来，其余界面仍可用（左侧导航可以切到别的视图）。' +
      '这是前端兜底层，不代表你的数据出了问题 —— 已完成的成片与任务记录都不受影响。',
    details: lines.join('\n'),
  };
}
