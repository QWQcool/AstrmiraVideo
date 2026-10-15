import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { getLanguage, translate } from './lib/i18n';
import { installRuntimeErrorNotice } from './lib/runtimeErrorNotice';
import './styles/tokens.css';
import './styles/index.css';
import './styles/workbench.css';
import './styles/edit.css';
import './styles/create.css';
import './styles/canvas.css';

/**
 * 顶层兜底（台账 B61）。
 *
 * 这是**最后一道**：App 里的每一个视图已经各包了一层（`App.tsx`），
 * 而这一层兜的是"**壳自身**渲染抛错"（顶栏 / 侧栏 / 路由解析 / Provider）。
 * 它比视图更不容易出错，但一旦出错，那时连"切到别的视图"这条退路都不存在了 ——
 * 那正是"白屏"最彻底的一种形态（用户只能刷新，还可能以为是断网）。
 *
 * ⚠️ 它**不替代**视图级兜底：这一层的代价是整个界面被替换成面板，
 * 而视图级那层保住侧栏与导航。**两层都要有**，不是二选一。
 *
 * ## 第三层：window 层的运行期提示（B61 片 B）
 * 上面两层都兜不住**事件回调与 Promise**里的抛错（React 不交给 boundary）。
 * `installRuntimeErrorNotice` 在**挂载之前**装上 —— 越早越好：它要覆盖的正是
 * "React 已经出错但还没渲染出任何东西"的那段时间。它**只本地提示、不上报**（D52）。
 *
 * ## 为什么这里的 label 不是写死的中文（语言迁移第七批）
 * 它是崩溃面板标题的一半（`{label}出错了`）。若写死中文，英文界面下整屏崩掉时
 * 用户看到的是"**界面 failed to render**"这种半中半英 —— 比整屏中文更糟。
 * 这里在 React 之外（`render()` 的参数里，用不了 hook），所以按当前语言现取
 * （与 `lib/format.ts` 的 `statusLabel` / `ErrorBoundary` 同一手法）。
 * **代价如实**：顶层这一层的 label 在**首次渲染时**定格（它本来也只渲染一次）。
 */
installRuntimeErrorNotice();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label={translate(getLanguage(), 'shell.region.app')}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
