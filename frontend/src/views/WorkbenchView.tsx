import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AspectRatio,
  GenerationMode,
  ProviderType,
  TaskProgress,
  VideoGenerateRequest,
} from '@astrmira/shared';
import { findRecipe, TASK_REF_PREFIX } from '@astrmira/shared';
import { CenterPanel } from '../components/CenterPanel';
import { LeftPanel } from '../components/LeftPanel';
import { RightPanel } from '../components/RightPanel';
import { useTaskPolling } from '../hooks/useTaskPolling';
import {
  ApiError,
  cancelTask,
  deleteHistory,
  enhancePrompt,
  fetchHistory,
  submitGenerate,
  uploadAssets,
} from '../lib/api';
import type { AssetSlotKey, AssetSlots } from '../lib/assets';
import {
  assetsForMode,
  emptyAssetSlots,
  missingAssetHint,
  modeAfterSlotClear,
  modeAfterSlotUpload,
} from '../lib/assets';
import { resolveLlmConfig, resolveLlmKey, resolveProviderKey } from '../lib/byok';
import { newIdempotencyKey } from '../lib/idempotency';
import { appendSkeleton } from '../lib/recipeInsert';
import { useHashRoute } from '../lib/router';
import { useShell } from '../lib/shell';
import {
  STORAGE_KEYS,
  browserStorage,
  readBool,
  readLocal,
  removeLocal,
  writeBool,
  writeLocal,
} from '../lib/storage';
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_RESOLUTION_TIER,
  clampDurationSec,
  formatClock,
  resolveTargetSize,
  tierForSize,
  type ResolutionTier,
} from '../lib/format';

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

/**
 * 生成工作台（V9 · B2）：现有三栏**原样**从 `App.tsx` 搬入，行为零变化。
 *
 * 搬移边界：跨视图的依赖（凭据、服务状态、打开抽屉）改从 `useShell()` 读（壳持有）；
 * 其余（创作输入 / 资产三槽 / 任务 / 画廊 / 冷却与计时）都是本视图自有状态，原样保留。
 * 顶栏与凭据抽屉、日志弹层是**壳**的职责，不在这里。
 */
export function WorkbenchView() {
  const { byok, byokPersist, providerStatus, openByok } = useShell();
  const storage = useMemo(() => browserStorage(), []);
  /**
   * 每个槽一份 object URL。换图 / 清空时必须 revoke，否则一张张泄漏到会话结束
   * （此前只有一个槽，所以是一个 `useRef<string|null>`；三槽后改成一个定长映射）。
   */
  const previewUrls = useRef<Partial<Record<AssetSlotKey, string>>>({});

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
  // B37：剪辑产物（不进画廊，只进"参考视频候选"——V2.6 `task:` 引用的素材池）
  const [editProducts, setEditProducts] = useState<TaskProgress[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── 扩写 ──
  const [enhancing, setEnhancing] = useState(false);
  /**
   * 当前选用的配方（V9 · B8）：由配方库的跳转带入；✨ 扩写时随请求带上 `recipeId`。
   * 为空 = 普通扩写（不带风格约束）。
   */
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);

  // ── 冷却与计时（冷却时间戳持久化，刷新后仍置灰） ──
  const [cooldownUntil, setCooldownUntil] = useState(() =>
    Number(readLocal(storage, STORAGE_KEYS.cooldownUntil) ?? '0'),
  );
  const [now, setNow] = useState(() => Date.now());

  const refreshHistory = useCallback(async (): Promise<void> => {
    setLoadingHistory(true);
    try {
      // B37：剪辑产物一并拉取（V2.6 `?kind=edit` 全量）——只喂给"参考视频候选"，
      // 画廊仍只展示生成产物（V2.4 口径不动）
      const [main, edits] = await Promise.all([fetchHistory(), fetchHistory({ kind: 'edit' })]);
      setHistory(main.items);
      setEditProducts(edits.items);
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

  /**
   * 「复用参数」的跨视图入口（V9 · B4 / Step 6-AC4）：
   * 视频库点 ⟲ 后跳 `#/workbench?reuse=<taskId>`，在这里读出来并回填。
   *
   * 三个细节：
   * 1. 用 **hash 参数**而不是共享 React 状态：两个视图之间零耦合，刷新/前进后退都成立；
   * 2. `handledReuse` 保证同一次跳转只回填一次（否则 history 每次刷新都会重新覆盖用户的手改）；
   * 3. 离开工作台就**重置**标记 —— 这样"再点一次同一条"仍然有效（hash 相同也要能触发）。
   */
  const route = useHashRoute();
  const handledReuse = useRef<string | null>(null);

  useEffect(() => {
    if (route.path !== '#/workbench') {
      handledReuse.current = null;
      return;
    }

    const target = route.query.get('reuse');
    if (target === null || handledReuse.current === target) return;

    // history 可能还没到位（首屏竞态）：等它更新后本 effect 会再跑一次
    const item = history.find((entry) => entry.taskId === target);
    if (item === undefined) return;

    handledReuse.current = target;
    handleReuse(item);
  }, [route, history]);

  /**
   * 「剪辑台 → 工作台」抽帧闭环（B34 · P4；PLAN §6-D38）：
   * `#/workbench?frameAsset=<assetId>&frameExt=<png|jpg>` —— 剪辑台抽帧并上传后跳过来，
   * 这里把它填进**首帧槽**并切到 I2V（与"上传即切模式"同一套规则）。
   *
   * 两个参数都**严格校验**后再拼 URL：assetId 必须是服务端 UUID 形状、ext 只接受 png/jpg ——
   * 否则 hash 就成了路径注入点（预览 URL 会直接进 `<img src>`）。
   */
  const handledFrameAsset = useRef<string | null>(null);

  useEffect(() => {
    if (route.path !== '#/workbench') {
      handledFrameAsset.current = null;
      return;
    }

    const assetId = route.query.get('frameAsset');
    if (assetId === null || handledFrameAsset.current === assetId) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) return;

    const ext = route.query.get('frameExt') === 'png' ? 'png' : 'jpg';
    handledFrameAsset.current = assetId;
    clearAllSlots();
    setSlot('firstFrame', { assetId, meta: null, previewUrl: `/media/assets/${assetId}.${ext}` });
    setMode('i2v');
    setNotice('已把剪辑台抽出的那一帧放进首帧（I2V）：补一句运动描述就能生成。');
  }, [route]);

  /**
   * 「配方库 → 工作台」的两个入口（V9 · B8；CONTRACT §11-1）：
   * - `#/workbench?recipe=<id>`：把该卡的 `skeleton` **逐字追加**到提示词框，并记下它；
   * - `#/workbench?recipe=<id>&insert=no`：**不动**提示词，只让 ✨ 扩写带上这个配方。
   *
   * 未知 id（例如别人分享了一条已被改名的配方链接）**不静默**：什么都不做，
   * 服务端侧同样会对未知 `recipeId` 返回 400（见 routes/enhance.ts）。
   */
  const handledRecipe = useRef<string | null>(null);

  useEffect(() => {
    if (route.path !== '#/workbench') {
      handledRecipe.current = null;
      return;
    }

    const recipeId = route.query.get('recipe');
    if (recipeId === null || handledRecipe.current === recipeId) return;

    const card = findRecipe(recipeId);
    if (card === undefined) return;

    handledRecipe.current = recipeId;
    setActiveRecipeId(card.id);

    if (route.query.get('insert') === 'no') {
      setNotice(`已选用配方「${card.title}」作为扩写上下文（提示词未改动）。`);
      return;
    }

    setPrompt((prev) => appendSkeleton(prev, card.skeleton));
    setNotice(`已把配方「${card.title}」的骨架插入提示词末尾；扩写时也会带上它。`);
  }, [route]);

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
   * B37：可直接当 V2V 参考的候选 —— 生成产物 + 剪辑产物（都已出片），新的在前。
   */
  const videoRefCandidates = useMemo(
    () =>
      [...history, ...editProducts]
        .filter((item) => item.status === 'succeeded' && item.outputVideoUrl !== undefined)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
    [history, editProducts],
  );

  /**
   * 把一条已出片任务（含剪辑产物）直接放进参考视频槽（V2.6 `task:` 引用）。
   * 与「上传即切模式」同一条纪律（`lib/assets` 纯函数）：选成片即切 V2V；
   * 预览用既有 `/media/*` 同源直链，不占 objectURL（无需 revoke）。
   */
  function handleVideoRefTaskSelect(selectedTaskId: string): void {
    const selected = videoRefCandidates.find((item) => item.taskId === selectedTaskId);
    if (selected === undefined || selected.outputVideoUrl === undefined) return;
    replacePreview('referenceVideo', null);
    setSlot('referenceVideo', {
      assetId: `${TASK_REF_PREFIX}${selected.taskId}`,
      meta: null,
      previewUrl: selected.outputVideoUrl,
    });
    setUploadError(null);
    setMode((prev) => modeAfterSlotUpload(prev, 'referenceVideo'));
    setNotice(
      `已把${selected.origin?.kind === 'edit' ? '剪辑产物' : '成片'} ${selected.taskId.slice(0, 8)} 设为参考视频（V2V）；` +
        '线上部署（已配 PUBLIC_BASE_URL）可直接提交。',
    );
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
          // V9 · B8：带了配方就把它作为风格上下文（服务端注入骨架 + 已知坑）
          ...(activeRecipeId === null ? {} : { recipeId: activeRecipeId }),
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

  /**
   * 把画廊里的一条任务载入中栏播放（V8.3 批次 7，台账 B26）。
   *
   * 实现上**只是换一个 taskId**：`useTaskPolling` 拿到的是终态任务 → 立即停止轮询
   * （它本来就在终态即停），因此**不会产生任何额外的上游请求**，也不会重新生成。
   * 副作用要清干净：清掉提交错误与上一条任务的提示，避免"看着新片、读着旧错"。
   */
  function handlePreview(target: TaskProgress): void {
    if (target.status !== 'succeeded' || target.outputVideoUrl === undefined) {
      setNotice('该任务没有可播放的成片（未成功，或成片已被清理）。');
      return;
    }

    writeLocal(storage, STORAGE_KEYS.activeTaskId, target.taskId);
    setTaskId(target.taskId);
    setSubmitError(null);
    setNotice(null);
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
    <>
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
          videoRefCandidates={videoRefCandidates}
          onVideoRefTaskSelect={handleVideoRefTaskSelect}
          assetRequirementHint={assetRequirementHint}
          seed={seed}
          onSeedChange={handleSeedChange}
          seedLocked={seedLocked}
          onSeedLockedChange={handleSeedLockedChange}
          byokSummary={byokSummary}
          onOpenByok={openByok}
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
          onPreview={handlePreview}
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
    </>
  );
}

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}
