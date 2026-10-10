import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectEntry, ProviderStatus } from '@astrmira/shared';
import { ByokDrawer } from './components/ByokDrawer';
import { Eyebrow } from './components/Eyebrow';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { Sidebar } from './components/Sidebar';
import {
  ApiError,
  fetchLogs,
  fetchProjects,
  fetchProviderStatus,
  verifyTrackKey,
} from './lib/api';
import {
  readActiveProjectId,
  resolveActiveProjectId,
  writeActiveProjectId,
} from './lib/projects';
import type { ByokConfig } from './lib/byok';
import {
  clearByok,
  isPersistEnabled,
  readByok,
  resolveLlmKey,
  resolveProviderKey,
  writeByok,
} from './lib/byok';
import { DEFAULT_VIEW, matchView } from './views/registry';
import { useHashRoute } from './lib/router';
import { ShellProvider } from './lib/shell';
import { STORAGE_KEYS, browserStorage, readBool, writeBool } from './lib/storage';
import {
  applyTheme,
  readThemePref,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
  writeThemePref,
  type ThemePref,
} from './lib/theme';
import { CreateView } from './views/CreateView';
import { UnknownView } from './views/UnknownView';
import { WorkbenchView } from './views/WorkbenchView';

/**
 * 应用壳（V9 · B2）：顶栏（品牌 + 服务状态）+ 侧栏 + 内容区按 hash 路由渲染。
 *
 * 三条结构约定：
 * 1. **工作台常驻隐藏**（`hidden` 切换）：提示词 / 参数 / 资产 / 进度在切视图后不丢，
 *    任务轮询也继续跑（进度本就该实时更新，与用户是否盯着无关）。其余视图按需挂载。
 * 2. **未知 hash 落兜底**（`UnknownView`），不静默重定向（B2 破坏性验证钉住）。
 * 3. 跨视图依赖（凭据 / 服务状态 / 开抽屉）经 `ShellProvider` 下发，视图注册表保持数据化。
 */
export default function App() {
  const storage = useMemo(() => browserStorage(), []);
  const route = useHashRoute();

  // ── 主题（默认跟随系统；`applyTheme` 只往 <html> 上打 data-theme，颜色全在 tokens.css） ──
  const [themePref, setThemePref] = useState<ThemePref>(() => readThemePref(storage));

  // ── 服务状态（顶栏右侧的唯一健康信号，D33：收进抽屉就失去"一眼可见"的意义） ──
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);

  // ── BYOK 凭据（壳持有：抽屉由侧栏底部唤出，工作台经 ShellContext 消费） ──
  const [byok, setByok] = useState<ByokConfig>(() => readByok(storage));
  const [byokPersist, setByokPersist] = useState(() => isPersistEnabled(storage));
  const [byokOpen, setByokOpen] = useState(false);

  // ── 侧栏收起态（localStorage 持久化；用户手动改过就不再被视图切换覆盖） ──
  const [rail, setRail] = useState(() => readBool(storage, STORAGE_KEYS.sidebarRail));
  const railTouched = useRef(false);

  /**
   * 移动端（≤768px）的导航抽屉（V9 · B7）。
   *
   * 桌面端用不上它（汉堡按钮在宽屏是 `display: none`），所以这个状态不影响桌面行为；
   * 而"切视图后自动收起"由 route 变化驱动 —— 移动端点导航后抽屉必须让位给内容。
   */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // ── 壳级通知（保存凭据这类壳动作的反馈；工作台自己的提示仍在中栏上方） ──
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 侧栏「操作日志」的红点（V9 · B5）：错误条数。
   *
   * 只在壳挂载时统计一次（`errorCode` 非空 = 失败请求），**刻意不轮询**：
   * 红点是"提醒你去看看"而不是实时指标；而为它每分钟拉一次日志，与"日志噪声纪律"的精神相悖。
   * 拉不到就静默（不显示红点）——红点消失不是用户需要被通知的事件。
   */
  const [errorLogCount, setErrorLogCount] = useState(0);

  // ── 项目维度（V2.11 / 台账 B47）：当前项目 + 清单 + 就地错误 ──
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [projectId, setProjectId] = useState<string>(() => readActiveProjectId(storage));
  const [projectError, setProjectError] = useState<string | null>(null);
  /** 清单刷新信号：ProjectSwitcher 在新建 / 改名 / 删除后自增（避免把 refresh 函数穿进 Context 太深） */
  const [projectRefreshTick, setProjectRefreshTick] = useState(0);

  const handleSetActiveProject = useCallback(
    (nextProjectId: string): void => {
      setProjectId(nextProjectId);
      writeActiveProjectId(storage, nextProjectId);
    },
    [storage],
  );

  const handleRefreshProjects = useCallback((): void => {
    setProjectRefreshTick((tick) => tick + 1);
  }, []);

  // 主题：偏好变化（或系统主题变化、且当前跟随系统时）同步到 <html data-theme>
  useEffect(() => {
    const sync = (): void => applyTheme(resolveTheme(themePref, systemPrefersDark()));
    sync();

    // 手动档自己说了算，不必订阅系统
    if (themePref !== 'system') return () => {};
    return watchSystemTheme(sync);
  }, [themePref]);

  const handleThemeChange = useCallback(
    (next: ThemePref): void => {
      setThemePref(next);
      writeThemePref(storage, next);
    },
    [storage],
  );

  // 服务状态探针
  useEffect(() => {
    const controller = new AbortController();

    fetchProviderStatus(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        setProviderStatus(status);
        setServiceError(null);
      })
      .catch((caught: unknown) => {
        // StrictMode 双挂载 / 组件卸载都会 abort，那不是"后端挂了"——
        // 早期版本没判这一条，界面会稳定显示"后端未连通"而后端其实是好的。
        if (controller.signal.aborted) return;
        setServiceError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => controller.abort();
  }, []);

  // 首次落地无 hash → 落到默认视图（replace 不产生"无 hash → workbench"的历史条目）
  useEffect(() => {
    if (window.location.hash === '') window.location.replace(DEFAULT_VIEW);
  }, []);

  /**
   * 项目清单（V2.11 / B47）：挂载时拉一次，`projectRefreshTick` 变化时再拉
   * （ProjectSwitcher 在新建 / 改名 / 删除后调 `refreshProjects()`）。
   *
   * 两条口径：
   * ① 拉到清单后**把"记住的项目"收敛成真实存在的那个**（项目被删 / 换了部署 / 存储脏值
   *    → 回落默认项目），与后端"省略 = 默认项目"同口径；
   * ② 清单拉不到（接口失败）**不动** `projectId` —— 不能因为一次网络抖动改用户的项目。
   */
  useEffect(() => {
    const controller = new AbortController();
    fetchProjects()
      .then((data) => {
        if (controller.signal.aborted) return;
        setProjects(data.projects);
        setProjectId((prev) => {
          const next = resolveActiveProjectId(data.projects, prev);
          if (next !== prev) writeActiveProjectId(storage, next);
          return next;
        });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setProjectError(describeError(caught));
      });
    return () => controller.abort();
  }, [projectRefreshTick, storage]);

  // 侧栏红点：挂载时统计一次最近的失败请求数（见 errorLogCount 的注释）
  useEffect(() => {
    fetchLogs({ limit: 100 })
      .then((data) => {
        setErrorLogCount(data.items.filter((item) => item.errorCode !== undefined).length);
      })
      .catch(() => undefined);
  }, []);

  const view = matchView(route.path);

  // "要空间"的视图（工作台 / 剪辑台）进入时默认收起侧栏；用户手动改过就不再干预
  useEffect(() => {
    if (railTouched.current) return;
    setRail(view?.preferRail === true);
  }, [view]);

  // 切视图后收起移动端抽屉（点了导航项就该看到内容，而不是继续被抽屉挡着）
  useEffect(() => {
    setMobileNavOpen(false);
  }, [route.path]);

  const handleToggleRail = useCallback((): void => {
    railTouched.current = true;
    setRail((prev) => {
      writeBool(storage, STORAGE_KEYS.sidebarRail, !prev);
      return !prev;
    });
  }, [storage]);

  function handleSaveByok(next: ByokConfig, persist: boolean): void {
    writeByok(storage, next, persist);
    setByok(next);
    setByokPersist(persist);
    setByokOpen(false);

    // 保存后把"现在能做什么"讲清楚：两条轨各自是否可用，避免"填了文本 Key 却以为视频轨也通了"
    const videoReady = resolveProviderKey(next) !== undefined;
    const textReady = resolveLlmKey(next) !== undefined;
    const storageText = persist ? '明文保存在本机（仅限信任设备）' : '仅本次会话有效';
    setNotice(
      `凭据已${storageText}：视频轨${videoReady ? '已填' : '未填'} · 文本扩写${textReady ? '已填' : '未填'}。`,
    );
  }

  function handleClearByok(): void {
    clearByok(storage);
    setByok(readByok(storage));
    setByokPersist(false);
    setNotice('已清除本地凭据；服务端不保存任何 Key。');
  }

  /**
   * 「测试连接」（V2.1，CONTRACT §9）：提交**之前**零费用核对凭据与模型。
   * 返回值是"给人看的一句话"，出错也不抛（抽屉里就地显示，不打断填写）。
   */
  async function handleVerify(track: 'video' | 'text', draft: ByokConfig): Promise<string> {
    const videoKey = resolveProviderKey(draft);
    const textKey = resolveLlmKey(draft);

    if (track === 'video' && videoKey === undefined) return '未填写视频轨 Key：无法校验';
    if (track === 'text' && textKey === undefined) return '未填写文本轨 Key：无法校验';

    try {
      const result = await verifyTrackKey(
        {
          track,
          ...(track === 'video'
            ? {
                ...(draft.model.trim() === '' ? {} : { model: draft.model.trim() }),
                ...(draft.baseUrl.trim() === '' ? {} : { baseUrl: draft.baseUrl.trim() }),
              }
            : {
                preset: draft.llmPreset,
                ...(draft.llmModel.trim() === '' ? {} : { model: draft.llmModel.trim() }),
                ...(draft.llmBaseUrl.trim() === '' ? {} : { llmBaseUrl: draft.llmBaseUrl.trim() }),
              }),
        },
        track === 'video' ? { providerKey: videoKey } : { llmKey: textKey },
      );
      return result.message;
    } catch (caught) {
      return `校验失败：${describeError(caught)}`;
    }
  }

  const shellServices = useMemo(
    () => ({
      byok,
      byokPersist,
      providerStatus,
      openByok: () => setByokOpen(true),
      // V2.11（B47）：项目上下文 —— 视图只读这一个值（不再各自记一份）
      projectId,
      projects,
      setActiveProject: handleSetActiveProject,
      refreshProjects: handleRefreshProjects,
      projectError,
      reportProjectError: setProjectError,
    }),
    [
      byok,
      byokPersist,
      providerStatus,
      projectId,
      projects,
      handleSetActiveProject,
      handleRefreshProjects,
      projectError,
    ],
  );

  const ActiveView = view?.component;

  return (
    <ShellProvider value={shellServices}>
      <div className="wb-shell app">
        <header className="wb-header">
          {/* 移动端导航抽屉的开关（宽屏由 CSS 隐藏；见 workbench.css 的 ≤768px 段） */}
          <button
            type="button"
            className="wb-burger"
            aria-label="打开导航"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            ☰
          </button>

          <div className="wb-brand">
            <span className="wb-brand-mark">✧</span>
            <span className="wb-brand-title">AstrmiraVideo</span>
            <Eyebrow tone="gold">workbench</Eyebrow>
          </div>

          <div className="wb-header-right">
            {/* 项目切换器（V2.11 / B47）：全局上下文，与"服务在线"同排 */}
            <ProjectSwitcher />
            {serviceError !== null ? (
              <span className="wb-badge wb-badge-bad" title={serviceError}>
                <span className="wb-dot wb-dot-bad" />
                后端未连通
              </span>
            ) : providerStatus === null ? (
              <span className="wb-badge">
                <span className="wb-dot" />
                探测中
              </span>
            ) : (
              <span className="wb-badge wb-badge-ok">
                <span className="wb-dot wb-dot-ok" />
                服务在线
              </span>
            )}
          </div>
        </header>

        <Sidebar
          currentPath={route.path}
          rail={rail}
          onToggleRail={handleToggleRail}
          themePref={themePref}
          onThemeChange={handleThemeChange}
          errorLogCount={errorLogCount}
          mobileOpen={mobileNavOpen}
          onNavigate={() => setMobileNavOpen(false)}
        />

        {mobileNavOpen ? (
          <div
            className="sidebar-scrim"
            role="presentation"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        <main className="app-content">
          {notice === null ? null : (
            <div className="app-notice" role="status">
              <span className="wb-dot" />
              <span className="wb-note">{notice}</span>
              <button type="button" className="app-notice-close" onClick={() => setNotice(null)} aria-label="关闭提示">
                ✕
              </button>
            </div>
          )}

          {/* 工作台常驻隐藏（hidden 切换）：提示词/参数/资产/进度在切视图后不丢，轮询继续跑 */}
          <div className="wb-keepalive" hidden={view?.path !== '#/workbench'}>
            <WorkbenchView />
          </div>

          {/* 创作入口常驻（同一条纪律，V2.7 / B41）：输入、素材 chips、内联任务卡在切视图后不丢 */}
          <div className="wb-keepalive" hidden={view?.path !== '#/create'}>
            <CreateView />
          </div>

          {view !== undefined &&
          view.path !== '#/workbench' &&
          view.path !== '#/create' &&
          ActiveView !== undefined ? (
            <ActiveView />
          ) : null}
          {view === undefined ? <UnknownView hash={route.hash} /> : null}
        </main>

        {byokOpen ? (
          <ByokDrawer
            config={byok}
            persist={byokPersist}
            pageLocation={{
              protocol: window.location.protocol,
              hostname: window.location.hostname,
            }}
            onSave={handleSaveByok}
            onClear={handleClearByok}
            onClose={() => setByokOpen(false)}
            onVerify={handleVerify}
          />
        ) : null}
      </div>
    </ShellProvider>
  );
}

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}
