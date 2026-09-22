import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AspectRatio,
  GenerationMode,
  ProviderStatus,
  ProviderType,
  TaskProgress,
  VideoGenerateRequest,
} from '@astrmira/shared';
import { ByokDrawer } from './components/ByokDrawer';
import { CenterPanel } from './components/CenterPanel';
import { Eyebrow } from './components/Eyebrow';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { useTaskPolling } from './hooks/useTaskPolling';
import {
  ApiError,
  cancelTask,
  deleteHistory,
  fetchHistory,
  fetchProviderStatus,
  submitGenerate,
  uploadAssets,
} from './lib/api';
import type { AssetState } from './lib/assets';
import type { ByokConfig } from './lib/byok';
import {
  clearByok,
  isPersistEnabled,
  readByok,
  resolveProviderKey,
  writeByok,
} from './lib/byok';
import {
  STORAGE_KEYS,
  browserStorage,
  readBool,
  readLocal,
  removeLocal,
  writeBool,
  writeLocal,
} from './lib/storage';
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_RESOLUTION_TIER,
  clampDurationSec,
  formatClock,
  resolveTargetSize,
  tierForSize,
  type ResolutionTier,
} from './lib/format';
import {
  THEME_LABELS,
  THEME_PREFS,
  applyTheme,
  readThemePref,
  resolveTheme,
  systemPrefersDark,
  watchSystemTheme,
  writeThemePref,
  type ThemePref,
} from './lib/theme';

/** AC4：提交后 60s 内生成按钮置灰（与后端防线 5 的冷却窗口对齐） */
const COOLDOWN_MS = 60_000;

/** demo 版：扩写未实现（服务端 501）。按钮保持可点并把原因讲清楚，不做静默置灰。 */
const ENHANCE_NOTICE = '未配置扩写模型：本版本未实现 LLM 扩写（见 PLAN §9 台账 B3）';

export default function App() {
  const storage = useMemo(() => browserStorage(), []);
  const previewRef = useRef<string | null>(null);

  // ── 主题（默认跟随系统；`applyTheme` 只往 <html> 上打 data-theme，颜色全在 tokens.css） ──
  const [themePref, setThemePref] = useState<ThemePref>(() => readThemePref(storage));

  // ── 服务状态 ──
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);

  // ── 创作输入 ──
  const [prompt, setPrompt] = useState(
    '竖屏短剧，女孩站在雨夜街头微笑着说：“我们终于成功了！”，电影感光影',
  );
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  // 时长与清晰度：两者都会进入请求（`params.durationSec` / `resolution`），上游按 `--duration` / `--resolution` 使用
  const [durationSec, setDurationSec] = useState<number>(DEFAULT_DURATION_SEC);
  const [resolutionTier, setResolutionTier] = useState<ResolutionTier>(DEFAULT_RESOLUTION_TIER);
  const [mode, setMode] = useState<GenerationMode>('t2v');
  const [provider, setProvider] = useState<ProviderType>('cloud-volcano-seedance');
  const [seed, setSeed] = useState(() => readLocal(storage, STORAGE_KEYS.lastSeed) ?? '');
  const [seedLocked, setSeedLocked] = useState(() => readBool(storage, STORAGE_KEYS.seedLocked));

  // ── 参考资产 ──
  const [asset, setAsset] = useState<AssetState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── 任务（taskId 持久化：刷新后向服务端重挂载，AC2） ──
  const [taskId, setTaskId] = useState<string | null>(() =>
    readLocal(storage, STORAGE_KEYS.activeTaskId),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── 画廊 ──
  const [history, setHistory] = useState<TaskProgress[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── BYOK ──
  const [byok, setByok] = useState<ByokConfig>(() => readByok(storage));
  const [byokPersist, setByokPersist] = useState(() => isPersistEnabled(storage));
  const [byokOpen, setByokOpen] = useState(false);

  // ── 冷却与计时（冷却时间戳持久化，刷新后仍置灰） ──
  const [cooldownUntil, setCooldownUntil] = useState(() =>
    Number(readLocal(storage, STORAGE_KEYS.cooldownUntil) ?? '0'),
  );
  const [now, setNow] = useState(() => Date.now());

  // 主题：偏好变化（或系统主题变化、且当前跟随系统时）同步到 <html data-theme>
  useEffect(() => {
    const sync = (): void => applyTheme(resolveTheme(themePref, systemPrefersDark()));
    sync();

    // 手动档自己说了算，不必订阅系统
    if (themePref !== 'system') return () => {};
    return watchSystemTheme(sync);
  }, [themePref]);

  const handleThemeChange = useCallback((next: ThemePref): void => {
    setThemePref(next);
    writeThemePref(storage, next);
  }, [storage]);

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

  const refreshHistory = useCallback(async (): Promise<void> => {
    setLoadingHistory(true);
    try {
      const data = await fetchHistory();
      setHistory(data.items);
      setHistoryError(null);
    } catch (caught) {
      setHistoryError(describeError(caught));
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  // 轮询当前任务；拿到终态就刷新画廊
  const { task, error: pollingError } = useTaskPolling(taskId, {
    onSettled: (settled) => {
      if (settled !== null) {
        writeLocal(storage, STORAGE_KEYS.lastTaskId, settled.taskId);
      }
      void refreshHistory();
    },
  });

  // 冷却倒计时：只在冷却期内跑定时器
  const cooldownRemaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const cooling = cooldownRemaining > 0;

  useEffect(() => {
    if (!cooling) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooling]);

  // 观察时长：用 taskId 作 key，切任务自然归零（避免在 effect 里同步 setState）
  const taskActive = task !== null && (task.status === 'running' || task.status === 'queued');
  const elapsedKey = task?.taskId ?? '';
  const [elapsed, setElapsed] = useState<{ key: string; seconds: number }>({
    key: '',
    seconds: 0,
  });

  useEffect(() => {
    if (!taskActive) return undefined;

    const timer = setInterval(() => {
      setElapsed((prev) =>
        prev.key === elapsedKey
          ? { key: prev.key, seconds: prev.seconds + 1 }
          : { key: elapsedKey, seconds: 1 },
      );
    }, 1000);

    return () => clearInterval(timer);
  }, [taskActive, elapsedKey]);

  function startCooldown(): void {
    const until = Date.now() + COOLDOWN_MS;
    setCooldownUntil(until);
    setNow(Date.now());
    writeLocal(storage, STORAGE_KEYS.cooldownUntil, String(until));
  }

  function handleAssetSelect(file: File): void {
    setUploadError(null);
    setUploading(true);

    const objectUrl = URL.createObjectURL(file);
    if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    previewRef.current = objectUrl;
    setAsset({ assetId: '', meta: null, previewUrl: objectUrl });

    void uploadAssets([file])
      .then((result) => {
        const first = result.assets[0];
        if (first === undefined) {
          setUploadError('上传未返回任何资产');
          setAsset(null);
          return;
        }
        setAsset({ assetId: first.assetId, meta: first, previewUrl: objectUrl });
        setMode('i2v');
      })
      .catch((caught: unknown) => {
        setUploadError(describeError(caught));
        setAsset(null);
      })
      .finally(() => setUploading(false));
  }

  function handleAssetClear(): void {
    if (previewRef.current !== null) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setAsset(null);
    setUploadError(null);
    setMode('t2v');
  }

  async function handleSubmit(): Promise<void> {
    if (cooling || submitting) return;

    setSubmitError(null);
    setNotice(null);
    setSubmitting(true);

    // 幂等键：一次点击一个键（重试须由用户重新点击，届时是新键 → 新任务）
    const idempotencyKey = newIdempotencyKey();
    const providerKey = resolveProviderKey(byok);

    const request: VideoGenerateRequest = {
      prompt,
      mode,
      aspectRatio,
      // 目标尺寸 = 画幅 × 清晰度档（都是 32 的倍数）；上游据此落到 `--resolution 480p|720p|1080p`
      resolution: resolveTargetSize(aspectRatio, resolutionTier),
      provider,
      // provider 私有参数：BYOK 的服务端地址与模型名（未识别键由服务端忽略）
      options: { baseUrl: byok.baseUrl, model: byok.model },
      ...(asset === null ? {} : { assets: { firstFrameImage: asset.assetId } }),
      params: {
        durationSec,
        ...(seedLocked && seed.trim() !== ''
          ? { seed: Number.parseInt(seed, 10), seedLocked: true }
          : {}),
      },
    };

    try {
      const created = await submitGenerate(request, {
        idempotencyKey,
        ...(providerKey === undefined ? {} : { providerKey }),
      });

      writeLocal(storage, STORAGE_KEYS.activeTaskId, created.taskId);
      setTaskId(created.taskId);
      setElapsed({ key: created.taskId, seconds: 0 });
      startCooldown();
      await refreshHistory();
    } catch (caught) {
      setSubmitError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 取消任务（V8.3 批次 3）：**真的调接口**，不再是只弹一句提示。
   *
   * 文案必须诚实：取消只保证"本地不再推进 + 通知上游停止"，
   * 上游是否真的停止、是否已计费，服务端无法代上游保证 —— 所以照实说，并指向后台核对。
   */
  async function handleCancel(): Promise<void> {
    if (taskId === null) return;

    setNotice(null);
    try {
      await cancelTask(taskId);
      setNotice('已请求取消，并会通知上游停止；若上游已受理，仍可能产生费用，请到服务商后台核对。');
    } catch (caught) {
      setNotice(`取消失败：${describeError(caught)}`);
    }
  }

  function handleReuse(target: TaskProgress): void {
    const snapshot = target.requestSnapshot;

    setPrompt(snapshot.prompt);
    setMode(snapshot.mode);
    setAspectRatio(snapshot.aspectRatio);
    setProvider(snapshot.provider);
    setSubmitError(null);

    // 时长与清晰度也要回填（快照里存的是像素尺寸，档位由短边反推）
    if (snapshot.params?.durationSec !== undefined) {
      setDurationSec(clampDurationSec(snapshot.params.durationSec));
    }
    if (snapshot.resolution !== undefined) {
      setResolutionTier(tierForSize(snapshot.resolution.width, snapshot.resolution.height));
    }

    if (snapshot.params?.seed === undefined) {
      setSeedLocked(false);
    } else {
      setSeed(String(snapshot.params.seed));
      setSeedLocked(true);
    }

    if (snapshot.assets?.firstFrameImage === undefined) {
      handleAssetClear();
      setNotice('已复用该任务的参数（提示词 / 模式 / 画幅 / seed）。');
      return;
    }

    if (previewRef.current !== null) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setAsset({ assetId: snapshot.assets.firstFrameImage, meta: null, previewUrl: null });
    setNotice('已复用参数，并带回参考资产编号；该图本地没有备份，因此不显示预览。');
  }

  async function handleDelete(targetId: string): Promise<void> {
    setDeletingId(targetId);
    try {
      await deleteHistory(targetId);
      if (targetId === taskId) {
        removeLocal(storage, STORAGE_KEYS.activeTaskId);
        setTaskId(null);
      }
      await refreshHistory();
    } catch (caught) {
      setHistoryError(describeError(caught));
    } finally {
      setDeletingId(null);
    }
  }

  function handleSaveByok(next: ByokConfig, persist: boolean): void {
    writeByok(storage, next, persist);
    setByok(next);
    setByokPersist(persist);
    setByokOpen(false);
    setNotice(persist ? '凭据已明文保存在本机（仅限信任设备）。' : '凭据仅保存在本次会话。');
  }

  function handleClearByok(): void {
    clearByok(storage);
    setByok(readByok(storage));
    setByokPersist(false);
    setNotice('已清除本地凭据；服务端不保存任何 Key。');
  }

  function handleSeedLockedChange(locked: boolean): void {
    setSeedLocked(locked);
    writeBool(storage, STORAGE_KEYS.seedLocked, locked);
  }

  function handleSeedChange(value: string): void {
    setSeed(value);
    writeLocal(storage, STORAGE_KEYS.lastSeed, value);
  }

  const submitLabel = submitting
    ? '提交中…'
    : cooling
      ? `冷却中 ${cooldownRemaining}s`
      : '立即生成视频';

  const byokSummary =
    resolveProviderKey(byok) === undefined
      ? '未填写 Key：服务端将回落到其自身配置的兜底 Key（若未配置会返回 KEY_MISSING）。'
      : byokPersist
        ? '已填写 Key · 明文保存在本机（仅限信任设备）'
        : '已填写 Key · 仅本次会话有效';

  return (
    <div className="wb-shell">
      <header className="wb-header">
        <div className="wb-brand">
          <span className="wb-brand-mark">✧</span>
          <span className="wb-brand-title">AstrmiraVideo</span>
          <Eyebrow tone="gold">workbench</Eyebrow>
        </div>

        <div className="wb-header-right">
          {/* 主题切换（默认跟随系统；覆盖后存本机） */}
          <div className="wb-segmented wb-segmented-compact" role="group" aria-label="主题">
            {THEME_PREFS.map((pref) => (
              <button
                key={pref}
                type="button"
                className="wb-segment"
                aria-pressed={themePref === pref}
                onClick={() => handleThemeChange(pref)}
              >
                {THEME_LABELS[pref]}
              </button>
            ))}
          </div>

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

      <main className="wb-main">
        <LeftPanel
          prompt={prompt}
          onPromptChange={setPrompt}
          onEnhance={() => setNotice(ENHANCE_NOTICE)}
          enhanceNotice={ENHANCE_NOTICE}
          enhancing={false}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          durationSec={durationSec}
          onDurationChange={setDurationSec}
          resolutionTier={resolutionTier}
          onResolutionTierChange={setResolutionTier}
          mode={mode}
          onModeChange={setMode}
          provider={provider}
          onProviderChange={setProvider}
          providerStatus={providerStatus}
          asset={asset}
          uploading={uploading}
          uploadError={uploadError}
          onAssetSelect={handleAssetSelect}
          onAssetClear={handleAssetClear}
          seed={seed}
          onSeedChange={handleSeedChange}
          seedLocked={seedLocked}
          onSeedLockedChange={handleSeedLockedChange}
          byokSummary={byokSummary}
          onOpenByok={() => setByokOpen(true)}
          onSubmit={() => void handleSubmit()}
          submitDisabled={submitting || cooling || prompt.trim() === ''}
          submitLabel={submitLabel}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {submitError === null ? null : (
            <div className="wb-uncertain">
              <span className="wb-uncertain-title">提交未成功</span>
              <span className="wb-uncertain-body">{submitError}</span>
            </div>
          )}

          {notice === null ? null : (
            <div className="wb-queue-item">
              <span className="wb-dot" />
              <span className="wb-note">{notice}</span>
            </div>
          )}

          <CenterPanel
            task={task}
            pollingError={pollingError}
            aspectRatio={aspectRatio}
            resolutionTier={resolutionTier}
            elapsedSeconds={elapsed.key === elapsedKey ? elapsed.seconds : 0}
            uncertainAcknowledged={false}
            onAcknowledgeUncertain={() => setNotice('已标记核对：请到服务商后台确认是否产生费用。')}
            onAbandonUncertain={() => {
              removeLocal(storage, STORAGE_KEYS.activeTaskId);
              setTaskId(null);
              setNotice('已放弃该任务：本服务不会自动重试，也不会再次向上游提交。');
            }}
            onCancel={() => void handleCancel()}
            onRequestReuse={() => {
              if (task !== null) handleReuse(task);
            }}
          />
        </div>

        <RightPanel
          current={task}
          history={history}
          historyError={historyError}
          loadingHistory={loadingHistory}
          deletingId={deletingId}
          onReuse={handleReuse}
          onDelete={(targetId) => void handleDelete(targetId)}
          onRefresh={() => void refreshHistory()}
        />
      </main>

      <footer className="wb-footer">
        <span className="wb-watermark">Astrmira · video workbench</span>
        <span>
          本地演示版本 ·
          {task === null
            ? ' 等待任务'
            : ` 最近任务 ${task.taskId.slice(0, 8)} · 观察 ${formatClock(elapsed.seconds * 1000)}`}
        </span>
      </footer>

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
        />
      ) : null}
    </div>
  );
}

/** 幂等键：非安全上下文下 `crypto.randomUUID` 不可用，需降级 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}
