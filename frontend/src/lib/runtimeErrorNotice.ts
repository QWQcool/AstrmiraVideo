import { buildRuntimeErrorNotice, type RuntimeErrorNotice, type RuntimeErrorSource } from './errorReport';

/**
 * window 层的**运行期出错通知**（台账 B61 · 片 B；决策 D52 = **只本地提示，不上报**）。
 *
 * ## 它补的是哪个洞
 * 片 A 的 `ErrorBoundary` 兜得住**渲染期**抛错，兜不住**事件回调与 Promise**里的抛错
 * （React 不把它们交给 boundary）—— B67 那次整页白屏正是这一类（便签让 `MiniMap` 的
 * `onNodeClick` 抛错）。那时用户看到的是**白屏或某块静默失效，且没有任何提示**：
 * 错误只躺在 DevTools 里。这一层把它变成"一条能关掉的提示"。
 *
 * ## 三条设计纪律（为什么这么写）
 * 1. **原生 DOM，不用 React**：它要兜的正是"React 树可能已经坏了"的场合 ——
 *    用一个可能已经挂掉的渲染器去显示"渲染器出错了"是自相矛盾的。
 *    （也因此它不需要 jsdom：DOM 这半是薄壳，逻辑那半是 `errorReport.ts` 的纯函数。）
 * 2. **不拼 HTML 字符串**：错误消息来自运行时（可能是上游返回的文本），按本仓红线
 *    （B15：数据路径一律 `textContent`，不用字符串拼 DOM）—— 视觉自检会扫这两个词，
 *    连注释里的字面写法都算（所以这里只能绕着说）。
 * 3. **自己绝不抛**：兜底层在"别人已经出事"的时刻执行；它要是再抛，用户看到的就是
 *    "白屏换成了另一个白屏"。整个处理链包在 try/catch 里，失败就只留 `console.error`。
 *
 * ## 只监听冒泡阶段的 `error`（这不是随手写的）
 * `img` / `script` 加载失败会以 `error` 事件出现在**捕获阶段**；本仓到处是缩略图与视频，
 * 一两个资源 404 就弹"界面出错了"会立刻变成狼来了。只挂冒泡阶段（等价于 `window.onerror`
 * 的语义）就天然排除了资源加载失败 —— 那类问题该由各自的加载态文案负责。
 * 另外接上 `unhandledrejection`：**未处理的 Promise 拒绝根本不会触发 `error` 事件**，
 * 而本仓的异步几乎全是"请求 → `.then()`"链 —— 只做 `window.onerror` 会漏掉最多的一类
 * （如实登记：这一条略超 N2 字面范围，理由是"同一个洞的另一半"，一句话即可撤）。
 *
 * ## 它上线后撞到的第一件事：兜底会把"噪声"也变成提示（所以还得会筛）
 * 冒烟接上这一层的那次运行，[8] 段立刻多出一条以前**静默**的错误：
 * `ResizeObserver loop completed with undelivered notifications.` —— 这是**浏览器自己**的
 * 通知丢失（规范允许、对功能无害；主流错误监控 SDK 默认忽略同一类）。
 * 它是以 `error` 事件抛出来的，所以会被我们接住；若不筛掉，
 * **一个什么也没做错的用户会看到"界面里有一处代码出错了"**。
 * 那比静默更糟：提示条一旦开始误报，真出事时用户就不看了（狼来了）。
 * 所以：这类**只留控制台、不弹提示**（判定见 `errorReport.ts` 的 `BENIGN_RUNTIME_NOISE`）。
 */

/** 冒烟用它点关闭按钮（`data-testid`） */
export const RUNTIME_ERROR_NOTICE_TESTID = 'runtime-error-notice';
export const RUNTIME_ERROR_DISMISS_TESTID = 'runtime-error-dismiss';
export const RUNTIME_ERROR_COUNT_TESTID = 'runtime-error-count';

export interface RuntimeErrorNoticeHandle {
  /** 卸掉两个监听（壳卸载 / 测试清理用） */
  dispose(): void;
  /** 已提示过的条数（去重后） */
  shown(): number;
  /** 手动触发一次 —— 冒烟与自检用；真实路径由浏览器事件驱动 */
  report(source: RuntimeErrorSource, error: unknown): void;
}

/** 无浏览器环境（Node 单测 / 预渲染）时的空实现：调用方不必判空 */
const INERT: RuntimeErrorNoticeHandle = {
  dispose: () => {},
  shown: () => 0,
  report: () => {},
};

export function installRuntimeErrorNotice(): RuntimeErrorNoticeHandle {
  if (typeof window === 'undefined' || typeof document === 'undefined') return INERT;

  /** 已提示过的签名（同一条错误只弹一次 —— 循环里的抛错否则会刷屏） */
  const seen = new Set<string>();
  /** 每条签名被忽略过多少次（只用于"另有 N 次同类"那一行） */
  const ignored = new Map<string, number>();
  /** 当前正在显示的是哪一条（用来原地更新计数行） */
  let current: RuntimeErrorNotice | null = null;
  let host: HTMLElement | null = null;
  let shown = 0;

  const dismiss = (): void => {
    try {
      host?.remove();
    } catch {
      // 忽略：它本来就是要消失的东西
    }
    host = null;
    current = null;
  };

  const render = (notice: RuntimeErrorNotice): void => {
    if (host === null) {
      host = document.createElement('div');
      host.className = 'wb-runtime-error';
      host.setAttribute('role', 'alert');
      host.dataset.testid = RUNTIME_ERROR_NOTICE_TESTID;
      document.body.append(host);
    }

    const title = document.createElement('div');
    title.className = 'wb-uncertain-title';
    title.textContent = notice.title;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wb-btn';
    close.textContent = '知道了';
    close.dataset.testid = RUNTIME_ERROR_DISMISS_TESTID;
    close.addEventListener('click', dismiss);

    const head = document.createElement('div');
    head.className = 'wb-runtime-error-head';
    head.append(title, close);

    const body = document.createElement('p');
    body.className = 'wb-uncertain-body';
    body.textContent = notice.summary;

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.className = 'wb-note';
    summary.textContent = '技术细节（报障时复制这一段）';
    const pre = document.createElement('pre');
    pre.className = 'wb-crash-pre';
    pre.textContent = notice.details; // 纯文本写入（红线 B15，见文件头纪律 2）
    details.append(summary, pre);

    host.replaceChildren(head, body, details);

    const extra = ignored.get(notice.signature) ?? 0;
    if (extra > 0) {
      const count = document.createElement('div');
      count.className = 'wb-note';
      count.dataset.testid = RUNTIME_ERROR_COUNT_TESTID;
      count.textContent = `另有 ${extra} 次同类错误（同样只在本机提示）`;
      host.append(count);
    }
  };

  const report = (source: RuntimeErrorSource, error: unknown): void => {
    try {
      const notice = buildRuntimeErrorNotice({ source, error, hash: window.location.hash });

      // 良性噪声（如 `ResizeObserver loop …`，见 `errorReport.ts` 的 BENIGN_RUNTIME_NOISE）：
      // 照旧留一条控制台记录（**不丢信息**），但**不弹给用户** ——
      // 提示条一旦开始误报，真出事时用户就不看了。
      if (notice.benign) {
        console.error(`[运行期噪声·已忽略，不提示] ${source}:`, error);
        return;
      }

      // 原始错误**始终**留在 DevTools 控制台（去重只作用于提示条 —— 不该连控制台也丢信息）
      console.error(`[运行期错误] ${source}:`, error);

      if (seen.has(notice.signature)) {
        const extra = (ignored.get(notice.signature) ?? 0) + 1;
        ignored.set(notice.signature, extra);
        // 正在显示的就是它 → 原地更新"另有 N 次"那一行（不重复弹）
        // 已经被用户关掉的（host === null）不再弹：他刚说过"知道了"
        if (current?.signature === notice.signature && host !== null) render(notice);
        return;
      }
      seen.add(notice.signature);
      shown += 1;
      current = notice;
      render(notice);
    } catch {
      // 兜底层自己绝不抛（见文件头纪律 3）
    }
  };

  // 冒泡阶段（非捕获）：天然不含资源加载失败，见文件头说明
  const onError = (event: ErrorEvent): void => {
    // 跨域脚本的 `error` 是 null（浏览器只给 "Script error."）—— message 仍是有效线索
    report('script', event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    report('rejection', event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return {
    dispose: () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      dismiss();
    },
    shown: () => shown,
    report,
  };
}
