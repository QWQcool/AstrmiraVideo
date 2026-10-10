import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
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
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="界面">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
