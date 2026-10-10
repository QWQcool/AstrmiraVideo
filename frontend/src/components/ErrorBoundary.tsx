import { Component, type ErrorInfo, type ReactNode } from 'react';
import { buildCrashReport, type CrashReport } from '../lib/errorReport';

/**
 * 视图级兜底（V2.24 / 台账 B61 · 片 A）。
 *
 * ## ⚠️ 为什么必须是 class 组件
 * React **至今只有 class 组件能做 error boundary**（`getDerivedStateFromError` / `componentDidCatch`，
 * 函数组件没有等价 API）。**不要把它"现代化"成函数组件** —— 那样会静默地失去全部兜底能力，
 * 而且不会有任何测试或类型错误提醒你（只会表现为"白屏又回来了"）。
 *
 * ## 它兜得住什么、兜不住什么（如实登记，别高估它）
 * - ✅ **渲染期**抛错：子组件渲染、生命周期、`useMemo`/`useState` 初始化、`lazy` 加载失败
 * - ❌ **事件回调**里的抛错（`onClick` / `onNodeClick` / `setTimeout` / Promise）—— React 不把它们交给 boundary。
 *   本仓有过**真实实例**：B67 的便签让 `MiniMap` 的 `onNodeClick` 抛错，那一刻整页白屏，
 *   而**包了 boundary 也照样白屏**。事件回调的纪律是**就地 try/catch**
 *   （见 `views/CanvasView.tsx` 里那条注释）。"window 层兜底 + 上报"属后续片（它需要一条前端上报通道）。
 * - ❌ **异步数据错误**（fetch 失败）：那是业务状态，走各视图自己的错误文案，不该由它兜。
 *
 * ## 兜底面板要说什么（三句话，缺一不可）
 * ① 坏在哪（哪个视图）；② **什么还能用**（否则用户以为整个系统挂了）；③ **不是你的数据坏了**
 * —— 崩溃发生在渲染层，成片与任务记录都在服务端的库里。第 ③ 句是"要不要打电话给运维"的分界线。
 */
export interface ErrorBoundaryProps {
  /** 出错区域的人话名（"画布" / "剪辑台预览" / "界面"），会出现在标题与报告里 */
  label: string;
  children: ReactNode;
  /** 紧凑场景（如剪辑台的一个面板）用它替换默认面板 */
  fallback?: (error: unknown, reset: () => void) => ReactNode;
  /** 崩溃时的额外动作（壳可用它弹一条提示；默认什么都不做） */
  onError?: (error: unknown, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: unknown;
  /** 在 `componentDidCatch` 里算好（含崩溃时刻与 hash），避免每帧重算 */
  report: CrashReport | null;
}

/** 出错时的 hash：报告里最有用的一行（"哪个视图崩的"） */
function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, report: null };

  /** 必须是静态纯函数：只允许写 state（React 会在 render 阶段调用它） */
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, report: null };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.setState({
      report: buildCrashReport({ label: this.props.label, error, hash: currentHash() }),
    });
    this.props.onError?.(error, info);
  }

  private readonly reset = (): void => {
    // 只是把边界复位：数据没变，所以**确定性的错误会立刻再抛一次**（这是诚实的行为 ——
    // 一个"重试就好了"的假象比直接告诉用户"这块坏了"更糟）
    this.setState({ error: null, report: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    if (this.props.fallback !== undefined) return this.props.fallback(error, this.reset);

    // `report` 在 `componentDidCatch` 之后才有（首帧 render 时还是 null）——那时就地拼一份
    const report =
      this.state.report ??
      buildCrashReport({ label: this.props.label, error, hash: currentHash() });

    return (
      <div className="wb-crash" role="alert">
        <div className="wb-uncertain-title">{report.title}</div>
        <p className="wb-uncertain-body">{report.summary}</p>
        <div className="wb-crash-actions">
          <button type="button" className="wb-btn" onClick={this.reset}>
            重试渲染
          </button>
          <a className="wb-btn" href="#/">
            回到创作入口
          </a>
        </div>
        <details className="wb-crash-details">
          <summary className="wb-note">技术细节（报障时复制这一段）</summary>
          <pre className="wb-crash-pre">{report.details}</pre>
        </details>
      </div>
    );
  }
}
