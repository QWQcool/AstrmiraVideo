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
  enhancePrompt,
  fetchHistory,
  fetchProviderStatus,
  submitGenerate,
  uploadAssets,
} from './lib/api';
import type { AssetSlotKey, AssetSlots } from './lib/assets';
import {
  assetsForMode,
  emptyAssetSlots,
  missingAssetHint,
  modeAfterSlotClear,
  modeAfterSlotUpload,
} from './lib/assets';
import type { ByokConfig } from './lib/byok';
import {
  clearByok,
  isPersistEnabled,
  readByok,
  resolveLlmConfig,
  resolveLlmKey,
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

/**
 * 扩写不可用时的提示（V2.0）。**只有一种原因**：没填文本轨 Key。
 * 文案必须同时说"为什么"与"去哪配"，否则置灰的按钮就是一个死胡同。
 */
const ENHANCE_NOTICE =
  '未配置扩写模型：请在「凭据设置（BYOK）」里填入文本轨 Key（本服务不提供文本侧兜底 Key）';

/** 三槽的固定顺序（清理预览 URL、回填快照都要按同一顺序遍历） */
const SLOT_KEYS = ['firstFrame', 'lastFrame', 'referenceVideo'] as const satisfies readonly AssetSlotKey[];

export default function App() {
  const storage = useMemo(() => browserStorage(), []);
  /**
   * 每个槽一份 object URL。换图 / 清空时必须 revoke，否则一张张泄漏到会话结束
   * （此前只有一个槽，所以是一个 `useRef<string|null>`；三槽后改成一个定长映射）。
   */
  const previewUrls = useRef<Partial<Record<AssetSlotKey, string>>>({});

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

  // ── 参考资产（三槽：首帧 / 尾帧 / 参考视频，见 CONTRACT §1 `assets`）──
  const [assets, setAssets] = useState<AssetSlots>(() => emptyAssetSlots());
  const [uploadingSlot, setUploadingSlot] = useState<AssetSlotKey | null>(null);
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

  // ── BYOK（视频轨 + 文本轨两套凭据，见 lib/byok）──
  const [byok, setByok] = useState<ByokConfig>(() => readByok(storage));
  const [byokPersist, setByokPersist] = useState(() => isPersistEnabled(storage));
  const [byokOpen, setByokOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

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

  /** 换掉某个槽的预览 URL（顺手 revoke 旧的），`null` 表示清空 */
  function replacePreview(slot: AssetSlotKey, url: string | null): void {
    const previous = previewUrls.current[slot];
    if (previous !== undefined) {
      URL.revokeObjectURL(previous);
      delete previewUrls.current[slot];
    }
    if (url !== null) previewUrls.current[slot] = url;
  }

  function setSlot(slot: AssetSlotKey, next: AssetSlots[AssetSlotKey]): void {
    setAssets((prev) => ({ ...prev, [slot]: next }));
  }

  function handleAssetSelect(slot: AssetSlotKey, file: File): void {
    setUploadError(null);
    setUploadingSlot(slot);

    // 先本地预览（上传中就能看到"服务端即将裁出的那一块"），拿到 assetId 后再补进状态
    const objectUrl = URL.createObjectURL(file);
    replacePreview(slot, objectUrl);
    setSlot(slot, { assetId: '', meta: null, previewUrl: objectUrl });

    void uploadAssets([file])
      .then((result) => {
        const first = result.assets[0];
        if (first === undefined) {
          setUploadError('上传未返回任何资产');
          replacePreview(slot, null);
          setSlot(slot, null);
          return;
        }
        setSlot(slot, { assetId: first.assetId, meta: first, previewUrl: objectUrl });
        // 上传即切模式（规则与边界集中在 lib/assets 的纯函数里，见其注释）
        setMode((prev) => modeAfterSlotUpload(prev, slot));
      })
      .catch((caught: unknown) => {
        setUploadError(describeError(caught));
        replacePreview(slot, null);
        setSlot(slot, null);
      })
      .finally(() => setUploadingSlot(null));
  }

  /**
   * 清空某个槽。**模式必须跟着回落** —— 否则会留下"首尾帧模式但没有尾帧"这种悬空状态，
   * 用户看到的是一排没有素材的槽和一个灰着的提交按钮。
   */
  function handleAssetClear(slot: AssetSlotKey): void {
    replacePreview(slot, null);
    setSlot(slot, null);
    setUploadError(null);
    setMode((prev) => modeAfterSlotClear(prev, slot));
  }

  /** 复用参数前清空全部槽（三份预览 URL 一并 revoke） */
  function clearAllSlots(): void {
    for (const slot of SLOT_KEYS) {
      replacePreview(slot, null);
    }
    setAssets(emptyAssetSlots());
    setUploadError(null);
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
      ...(referenceAssets === undefined ? {} : { assets: referenceAssets }),
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
   * 扩写（V2.0，纯 BYOK）。
   *
   * 三条口径：
   * 1. **Key 只走请求头** `X-LLM-Key`；没填就不发请求（按钮此时是灰的，这里再兜一层）；
   * 2. **区分三种失败**：没配（`LLM_NOT_CONFIGURED`）/ Key 被拒（`KEY_INVALID`）/
   *    上游故障（`UPSTREAM_ERROR`）—— 三句话不一样，不能让用户自己猜；
   * 3. **不覆盖用户的原文**：只在成功时替换提示词（用户随时可以 Ctrl+Z 改回来，
   *    但绝不把"扩写失败"变成"提示词被清空"）。
   */
  async function handleEnhance(): Promise<void> {
    const llmKey = resolveLlmKey(byok);
    if (llmKey === undefined) {
      setNotice(ENHANCE_NOTICE);
      return;
    }

    setSubmitError(null);
    setNotice(null);
    setEnhancing(true);

    try {
      const result = await enhancePrompt(
        {
          originalPrompt: prompt,
          style: 'cinematic',
          mode,
          llm: resolveLlmConfig(byok),
        },
        { llmKey },
      );

      setPrompt(result.enhancedPrompt);
      // `engine` 是必填字段：这里显式读一次，让"到底用的什么引擎"在界面上有据可查
      setNotice(
        `已用模型扩写（engine=${result.engine}）${
          result.cameraMovementSuggested === undefined ? '' : ` · 镜头建议：${result.cameraMovementSuggested}`
        }${result.lightingSuggested === undefined ? '' : ` · 光线建议：${result.lightingSuggested}`}${
          result.notice === undefined ? '' : `（${result.notice}）`
        }`,
      );
    } catch (caught) {
      setNotice(`扩写失败：${describeError(caught)}`);
    } finally {
      setEnhancing(false);
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

    // 三槽一起回填（旧任务快照里可能只有一个首帧字段，其余自然为空）
    clearAllSlots();
    const restored: Array<[AssetSlotKey, string | undefined]> = [
      ['firstFrame', snapshot.assets?.firstFrameImage],
      ['lastFrame', snapshot.assets?.lastFrameImage],
      ['referenceVideo', snapshot.assets?.referenceVideo],
    ];
    const broughtBack = new Set<AssetSlotKey>();
    for (const [slot, assetId] of restored) {
      if (assetId === undefined) continue;
      // 只带回资产编号、元数据留空：快照里没有 mime/size，硬造就是伪造数据（见 lib/assets）
      setSlot(slot, { assetId, meta: null, previewUrl: null });
      broughtBack.add(slot);
    }

    setNotice(
      broughtBack.size === 0
        ? '已复用该任务的参数（提示词 / 模式 / 画幅 / seed）。'
        : `已复用参数，并带回 ${broughtBack.size} 份参考资产编号；本地没有备份，因此不显示预览。`,
    );
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

  function handleSeedLockedChange(locked: boolean): void {
    setSeedLocked(locked);
    writeBool(storage, STORAGE_KEYS.seedLocked, locked);
  }

  function handleSeedChange(value: string): void {
    setSeed(value);
    writeLocal(storage, STORAGE_KEYS.lastSeed, value);
  }

  /**
   * 按模式组装 `assets`（V8.3 批次 3-⑤）。
   * 规则与边界（含"只发该模式用得到的槽"）集中在 `lib/assets.ts` 的纯函数里，那处有单测。
   */
  const referenceAssets = assetsForMode(mode, assets);

  const assetRequirementHint = missingAssetHint(mode, assets);

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
          onEnhance={() => void handleEnhance()}
          // 非 null = 不可用；这里是**唯一**的不可用原因（没填文本轨 Key）
          enhanceNotice={resolveLlmKey(byok) === undefined ? ENHANCE_NOTICE : null}
          enhancing={enhancing}
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
          assets={assets}
          uploadingSlot={uploadingSlot}
          uploadError={uploadError}
          onAssetSelect={handleAssetSelect}
          onAssetClear={handleAssetClear}
          assetRequirementHint={assetRequirementHint}
          seed={seed}
          onSeedChange={handleSeedChange}
          seedLocked={seedLocked}
          onSeedLockedChange={handleSeedLockedChange}
          byokSummary={byokSummary}
          onOpenByok={() => setByokOpen(true)}
          onSubmit={() => void handleSubmit()}
          submitDisabled={
            submitting ||
            cooling ||
            prompt.trim() === '' ||
            // 上传中禁止提交：那一刻 assetId 还是空串（乐观预览态），提交上去等于没带素材
            uploadingSlot !== null ||
            assetRequirementHint !== null
          }
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
