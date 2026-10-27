import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentPlan,
  AgentPlanUsage,
  AspectRatio,
  AssetListEntry,
  CanvasReferenceRole,
  GenerationMode,
  ProviderType,
  SkillManifest,
  SkillParams,
  TaskProgress,
  VideoGenerateRequest,
} from '@astrmira/shared';
import {
  AgentPlanSchema,
  BUILTIN_SKILLS,
  estimateCostFromRequest,
  formatYuan,
  taskOutput,
  validateAgentPlan,
} from '@astrmira/shared';
import {
  ApiError,
  fetchAssets,
  fetchHistory,
  fetchSelfCheck,
  fetchTask,
  planAgent,
  resolveMediaUrl,
  submitGenerate,
  uploadAssets,
} from '../lib/api';
import { resolveLlmConfig, resolveLlmKey, resolveProviderKey } from '../lib/byok';
import { setAgentCanvasHandoff } from '../lib/agentCanvasHandoff';
import { setCanvasResultHandoff } from '../lib/canvasHandoff';
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_RESOLUTION_TIER,
  clampDurationSec,
  resolveImageSize,
  resolveTargetSize,
  tierForSize,
  type ResolutionTier,
} from '../lib/format';
import { newIdempotencyKey } from '../lib/idempotency';
import {
  idempotencyKeyForSubmit,
  reuseAgentExecution,
  type AgentExecutionIntent,
} from '../lib/agentExecution';
import { appendSkeleton } from '../lib/recipeInsert';
import { findSkillInLibrary, loadSkillLibrary } from '../lib/skills';
import { useTranslate, type MessageKey } from '../lib/i18n';
import {
  assetsForRefs,
  canvasReferencesForMentionRefs,
  hasMissingRef,
  hasPendingRef,
  ignoredMentionHint,
  mentionRefsFromCanvasReferences,
  mentionRole,
  selectMentions,
  swapFirstLast,
  type MentionRef,
} from '../lib/mentions';
import {
  filterReferenceSources,
  referenceKindsForModes,
  referenceSourceLabelKey,
  referenceSourcesFromAssets,
  referenceSourcesFromTasks,
  type ReferenceSourceItem,
} from '../lib/referenceSources';
import {
  comfyUiEngineOptions,
  httpServiceEngineOptions,
  isHttpServiceEngine,
} from '../lib/engineOptions';
import { navigate, parseHash } from '../lib/router';
import { useShell } from '../lib/shell';
import { useTaskPolling } from '../hooks/useTaskPolling';
import { useCreationDraft } from '../hooks/useCreationDraft';
import { CreationTypeBar, type ComposerKind } from '../components/CreationTypeBar';
import { ComposerBar } from '../components/ComposerBar';
import {
  StructuredPromptInput,
  type InlinePromptToken,
  type StructuredPromptHandle,
} from '../components/StructuredPromptInput';
import { AgentPlanPanel } from '../components/AgentPlanPanel';
import { MediaLightbox } from '../components/MediaLightbox';

/**
 * 创作入口 `#/create`（Step 8 · P3 / 台账 B41；决策 = PLAN §6-D39）。
 *
 * 形态：一句话 + `@` 素材 → 一个「造梦盒」。三栏工作台（`#/workbench`）原样保留为专业模式。
 *
 * 四条口径（与 EXEC-STEP8 §一 逐条对应）：
 * 1. **chip 提交制**：输入框里的 `@` 只是唤起弹层的按键，真正的引用是结构化 chips（`lib/mentions`）——
 *    裸文本解析有截断/重名歧义，不做；
 * 2. **素材决定模式**：复用 `lib/mentions` 纯函数（与三槽路径同一纪律），界面用摘要行**说出**将按哪个模式生成；
 * 3. **不静默**：多余素材被忽略时显示原因；上传中禁用提交并说明是"上传中"而不是"缺素材"；
 * 4. **提交后不跳走**：内联出现任务卡（进度 → 成片播放器），保留"一句话入口"的沉浸感。
 */

const CLOUD_PROVIDER: ProviderType = 'cloud-volcano-seedance';
// ⚠️ V2.37（D56）：本地 H3 那一档的常量已随该档撤掉一起删除（与左栏同步）。
// V2.31（A1 片 C / D53）：用户自备的 ComfyUI —— V2.36 起**不再是常量**：
// 它可能有多台（`host-comfyui:<name>`），名单由 `/status` 的 `comfyui.servers` 给出（lib/engineOptions.ts）。

/**
 * 模式名 / 状态名 → **字典键**（V2.39：文案进 `dict/common.ts`）。
 *
 * 为什么是键表而不是文案表：这两组词在多个视图里出现（工作台 / 视频库 / 画布 / 成本台账），
 * 各写一份中文必然漂移。键表放在模块层（键是常量），渲染时 `t(MODE_KEYS[mode])`。
 */
const REF_ROLE_KEYS: Record<CanvasReferenceRole, MessageKey> = {
  'first-frame': 'create.chip.firstFrame',
  'last-frame': 'create.chip.lastFrame',
  'reference-image': 'create.chip.referenceImage',
  'reference-video': 'create.chip.referenceVideo',
  'reference-audio': 'create.chip.referenceAudio',
};

const MODE_KEYS: Record<GenerationMode, MessageKey> = {
  t2v: 'common.mode.t2v',
  i2v: 'common.mode.i2v',
  fl2v: 'common.mode.fl2v',
  v2v: 'common.mode.v2v',
  t2i: 'common.mode.t2i',
  upscale: 'common.mode.upscale',
};

const STATUS_KEYS: Record<TaskProgress['status'], MessageKey> = {
  queued: 'common.status.queued',
  running: 'common.status.running',
  succeeded: 'common.status.succeeded',
  failed: 'common.status.failed',
  cancelled: 'common.status.cancelled',
};

/** 配方 chips：横滚条只放前 12 张（全量在配方库），避免首页变成第二个配方库 */
function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

/** 成片/剪辑/图片产物 → chip 引用（`task:` 形态，V2.6；V2.40 起按真实产物类型） */
function refFromTask(task: TaskProgress): MentionRef {
  const output = taskOutput(task);
  const kind = output.kind === 'image' ? 'image' : 'video';
  return {
    id: newIdempotencyKey(),
    ref: `task:${task.taskId}`,
    kind,
    // 视频的 url 是 mp4，不能塞进 chip 的 <img>；没有封面就用类型字形
    previewUrl:
      task.thumbnailUrl ??
      (output.kind === 'image' ? resolveMediaUrl(output.url) : null),
    label: `${task.origin?.kind === 'edit' ? '✂ ' : ''}${task.requestSnapshot.prompt.slice(0, 14)}·${task.taskId.slice(0, 6)}`,
  };
}

/**
 * 可作为**生成参考**的资产（V2.10 边界）：图像 / 视频。
 *
 * 为什么要把音频挡在外面：音频（B57）不是生成参考 —— 云端与本地轨都没有"音频输入"这一档，
 * 放进来只会在提交时被上游拒（或更糟：被当成图片发出去）。音频素材的用途是**剪辑台的音效轨**。
 * 用类型谓词而不是 `as` 断言：这样"音频混进参考池"是**编译期错误**，不是运行期惊喜。
 */
type RefAsset = AssetListEntry & { kind: 'image' | 'video' };

function isRefAsset(asset: AssetListEntry): asset is RefAsset {
  return asset.kind === 'image' || asset.kind === 'video';
}

/** S5-Ab：统一来源条目 → chip 引用（上传/首页产物走同一条路） */
function refFromSource(source: ReferenceSourceItem): MentionRef {
  return {
    id: newIdempotencyKey(),
    ref: source.ref,
    kind: source.kind === 'video' ? 'video' : 'image',
    previewUrl: source.previewUrl ?? null,
    label: source.label,
  };
}

export function CreateView() {
  const { byok, providerStatus, refreshProviderStatus, openByok, projectId } = useShell();
  const t = useTranslate();

  // ── 意图与素材 ──
  // S2/S5-B1：创作类型驱动输入区。草稿在刷新后接上（类型 + 提示词 + 参数 + 稳定引用）；
  // 预览 URL 与上传中占位不进草稿，恢复时按 assetId/taskId 重新解析（见 useCreationDraft）。
  const {
    kind: draftKind,
    setKind,
    initial: draftInitial,
    persist: persistDraft,
    backup: backupDraft,
    readBackup: readDraftBackup,
    clearBackup: clearDraftBackup,
  } = useCreationDraft('video');
  // 类型只有**一个**数据源（hook 里的草稿）：本地再存一份会让"落盘的 kind"与"界面显示的 kind"分叉
  // —— S2 自测时确实出现过 kind=video 但 settings.mode=t2i 的脏草稿。
  const kind: ComposerKind = draftKind === 'image' ? 'image' : 'video';
  const [prompt, setPrompt] = useState(draftInitial.prompt);
  // S5-B1：草稿里的引用先按稳定 ID/用途/顺序恢复；预览等素材池回来后再解析
  const [refs, setRefs] = useState<MentionRef[]>(() =>
    mentionRefsFromCanvasReferences(draftInitial.references),
  );
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionActive, setMentionActive] = useState(0);
  const [backupAvailable, setBackupAvailable] = useState(false);
  /** 行内 token 的编辑器句柄（与外部 chips 双向同步） */
  const promptEditorRef = useRef<StructuredPromptHandle | null>(null);
  /** 引用目录：删除后原生撤销恢复 token 时，从这里找回引用 */
  const refCatalog = useRef<Map<string, MentionRef>>(new Map());
  /** S6-B2：Agent 计划只存在于当前页面；应用/拒绝后清空，不落 localStorage。 */
  const [agentPlan, setAgentPlan] = useState<{
    plan: AgentPlan;
    model: string;
    usage?: AgentPlanUsage;
  } | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentApplying, setAgentApplying] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentPlanIssues, setAgentPlanIssues] = useState<string[]>([]);
  /** 内置 + 自建；计划卡编辑后的能力校验必须用同一份目录。 */
  const agentSkills = useMemo(
    () => [...BUILTIN_SKILLS, ...loadSkillLibrary().library.custom],
    [],
  );
  /** S6-B3：最近一次 Agent 执行意图（方案 + 草稿指纹 + 幂等键），只在内存。 */
  const agentExecutionRef = useRef<AgentExecutionIntent | null>(null);

  // ── 素材池（`@` 弹层的候选：资产库 + 成片/剪辑产物）──
  // V2.10：池子里**只放可作为生成参考的资产**（音频素材挡在池外，见 `isRefAsset`）
  const [assetPool, setAssetPool] = useState<RefAsset[]>([]);
  const [taskPool, setTaskPool] = useState<TaskProgress[]>([]);
  const [poolError, setPoolError] = useState<string | null>(null);
  /** S5-Ab：上传素材 + 首页产物共用同一适配层；画布产物由服务端默认历史挡在外面 */
  const mentionSources = useMemo(
    () => [
      ...referenceSourcesFromTasks(taskPool, 'home'),
      ...referenceSourcesFromAssets(assetPool),
    ],
    [taskPool, assetPool],
  );
  /** 只有成功拉过素材池，才能判断草稿引用“确实不存在”；拉失败不误判 */
  const [poolsLoaded, setPoolsLoaded] = useState(false);

  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const objectUrls = useRef<string[]>([]);

  // ── 更多设置（默认收起；D39："控件分层"而不是删控件）──
  const [moreOpen, setMoreOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
    draftInitial.settings.aspectRatio ?? '16:9',
  );
  const [durationSec, setDurationSec] = useState<number>(
    draftInitial.settings.durationSec ?? DEFAULT_DURATION_SEC,
  );
  const [resolutionTier, setResolutionTier] = useState<ResolutionTier>(DEFAULT_RESOLUTION_TIER);
  const [provider, setProvider] = useState<ProviderType>(CLOUD_PROVIDER);
  const [seed, setSeed] = useState('');
  /** V2.36：本地 ComfyUI 可能是**多台**（§19-1）—— 名单来自 `/status`，前端不维护第二份 */
  const comfyEngines = useMemo(() => comfyUiEngineOptions(providerStatus), [providerStatus]);
  /** V2.47：配置型 HTTP 任务服务（§22）；没配时为空数组，不造假的“远程服务”档 */
  const httpEngines = useMemo(() => httpServiceEngineOptions(providerStatus), [providerStatus]);
  const engines = useMemo(() => [...comfyEngines, ...httpEngines], [comfyEngines, httpEngines]);
  /**
   * V2.51：同一条能力判定 —— `modes` 缺省 = 还没自检，不能据此禁用；
   * 有值时按真实声明过滤。ComfyUI 与 HTTP 用同一口径。
   */
  const engineSupportsT2i = (engine: { modes?: readonly string[] }): boolean =>
    engine.modes === undefined || engine.modes.includes('t2i');
  const engineSupportsVideo = (engine: { modes?: readonly string[] }): boolean =>
    engine.modes === undefined || engine.modes.some((mode) => mode !== 't2i');
  const imageEngines = useMemo(
    () => engines.filter((engine) => engineSupportsT2i(engine)),
    [engines],
  );
  const videoEngines = useMemo(
    () => engines.filter((engine) => engineSupportsVideo(engine)),
    [engines],
  );

  // 图片/视频切换：当前引擎不在目标能力列表里时，切到第一项可用引擎；
  // 云端在视频态始终合法（ComposerBar 固定保留它），不因列表里没有就切走。
  useEffect(() => {
    if (kind === 'image') {
      if (imageEngines.some((engine) => engine.id === provider)) return;
      const fallback = imageEngines.find((engine) => engine.configured) ?? imageEngines[0];
      if (fallback !== undefined) setProvider(fallback.id);
      return;
    }
    if (provider === CLOUD_PROVIDER) return;
    if (videoEngines.some((engine) => engine.id === provider)) return;
    const fallback = videoEngines.find((engine) => engine.configured) ?? videoEngines[0];
    if (fallback !== undefined) setProvider(fallback.id);
  }, [kind, provider, imageEngines, videoEngines]);

  // 草稿落盘：提示词 / 类型 / 参数（素材不进草稿，理由见 useCreationDraft）。
  useEffect(() => {
    persistDraft({
      prompt,
      settings: {
        aspectRatio,
        durationSec,
        resolution:
          kind === 'image'
            ? resolveImageSize(aspectRatio)
            : resolveTargetSize(aspectRatio, resolutionTier),
        ...(kind === 'image' ? { mode: 't2i' as const } : {}),
      },
      references: canvasReferencesForMentionRefs(refs),
    });
  }, [persistDraft, prompt, aspectRatio, durationSec, resolutionTier, kind, refs]);

  // ── 提交与内联任务卡 ──
  const [taskId, setTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** V2.51：显式自检才刷新本地模式；不在渲染路径上自动探测 */
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [lightbox, setLightbox] = useState<{
    kind: 'image' | 'video';
    url: string;
    title: string;
  } | null>(null);

  const reloadPools = useCallback(async (): Promise<void> => {
    try {
      // V2.11（B47）：素材池只装当前项目的资产与成片（切项目即重拉）
      const [assets, generated, edits] = await Promise.all([
        fetchAssets(projectId),
        fetchHistory({ project: projectId }),
        fetchHistory({ kind: 'edit', project: projectId }),
      ]);
      setAssetPool(assets.assets.filter(isRefAsset));
      setTaskPool(
        [...generated.items, ...edits.items]
          // V2.40：图片产物（t2i）也能当参考；S4 的「作为参考」不再只认视频
          .filter(
            (item) =>
              item.status === 'succeeded' &&
              (item.outputVideoUrl !== undefined || item.outputImageUrl !== undefined),
          )
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
      );
      setPoolError(null);
      setPoolsLoaded(true);
    } catch (caught) {
      setPoolError(describeError(caught));
    }
  }, [projectId]);

  useEffect(() => {
    void reloadPools();
  }, [reloadPools]);

  /**
   * S5-B1：草稿引用恢复预览。
   *
   * 只解析 `restored` 的 chip；不持久化 blob URL，也不把“素材池还没回来”误判成失效。
   * 池子成功加载后仍找不到 → `missing`，保留 chip 让用户移除/换素材，提交被挡住。
   */
  useEffect(() => {
    if (refs.length === 0) return;
    const assets = new Map(assetPool.map((item) => [item.assetId, item] as const));
    const tasks = new Map(taskPool.map((item) => [item.taskId, item] as const));
    setRefs((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.restored !== true || item.ref === '') return item;
        if (item.ref.startsWith('task:')) {
          const task = tasks.get(item.ref.slice('task:'.length));
          if (task === undefined) {
            if (!poolsLoaded) return item;
            changed = true;
            return { ...item, restored: false, missing: true };
          }
          const output = taskOutput(task);
          changed = true;
          return {
            ...item,
            restored: false,
            missing: false,
            kind: output.kind === 'video' ? ('video' as const) : ('image' as const),
            previewUrl:
              task.thumbnailUrl ??
              (output.kind === 'video' || output.kind === 'image'
                ? resolveMediaUrl(output.url)
                : null),
            label: task.requestSnapshot.prompt.slice(0, 18),
          };
        }
        const asset = assets.get(item.ref);
        if (asset === undefined) {
          if (!poolsLoaded) return item;
          changed = true;
          return { ...item, restored: false, missing: true };
        }
        changed = true;
        return {
          ...item,
          restored: false,
          missing: false,
          kind: asset.kind,
          previewUrl: asset.url,
          label: asset.name ?? asset.assetId.slice(0, 10),
        };
      });
      return changed ? next : prev;
    });
  }, [assetPool, taskPool, poolsLoaded]);

  // 目录只增不删：原生撤销恢复 token 时，引用可能已从当前 chips 移除
  useEffect(() => {
    for (const ref of refs) {
      if (ref.ref !== '') refCatalog.current.set(ref.id, ref);
    }
  }, [refs]);

  const inlineTokens = useMemo<InlinePromptToken[]>(
    () =>
      refs
        .filter((ref) => ref.ref !== '' && ref.missing !== true)
        .map((ref) => ({
          id: ref.id,
          label: ref.label ?? ref.ref.slice(0, 10),
          kind: ref.kind,
        })),
    [refs],
  );

  // 引用在解析后确认失效 → 行内 token 也要撤掉（外部 chip 保留供修正）
  useEffect(() => {
    for (const ref of refs) {
      if (ref.missing === true) promptEditorRef.current?.removeToken(ref.id);
    }
  }, [refs]);

  // 预览/标签解析完成后同步 token 文案（不改变正文）
  useEffect(() => {
    for (const token of inlineTokens) {
      promptEditorRef.current?.updateTokenLabel(token.id, token.label);
    }
  }, [inlineTokens]);

  // 预览用的 objectURL 在卸载时统一 revoke（与工作台同纪律：不泄漏到会话结束）
  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const { task, error: pollingError } = useTaskPolling(taskId, {
    onSettled: (settled) => {
      if (settled !== null) void reloadPools();
    },
  });

  const selection = useMemo(() => selectMentions(refs), [refs]);
  const ignoredHint = ignoredMentionHint(selection);
  const pending = hasPendingRef(refs) || uploadingCount > 0;

  const providerKey = resolveProviderKey(byok);
  const needsKey =
    provider === CLOUD_PROVIDER &&
    providerKey === undefined &&
    providerStatus !== null &&
    !providerStatus.cloud.available;

  /**
   * 图片态能不能用：只看 `/status` 的**配置事实**（ComfyUI 地址合规且本地轨已开放）。
   * 真正能不能出图（模板/节点齐不齐）由服务端在提交时判定并如实报错 —— 与 §19-2 同一口径，
   * 不在这里假装"已就绪"。
   */
  const selectedComfyStatus = providerStatus?.comfyui.servers.find(
    (server) => server.id === provider,
  );
  const imageReady =
    kind === 'image' &&
    (isHttpServiceEngine(provider)
      ? (httpEngines.find((engine) => engine.id === provider)?.configured === true &&
        httpEngines.find((engine) => engine.id === provider)?.modes?.includes('t2i') === true)
      : providerStatus?.comfyui.available === true &&
        (selectedComfyStatus?.modes === undefined ||
          selectedComfyStatus.modes.includes('t2i')));

  const selectedMode = kind === 'image' ? 't2i' : selection.mode;
  const selectedEngineModes = (kind === 'image' ? imageEngines : videoEngines).find(
    (engine) => engine.id === provider,
  )?.modes;
  const modeReady =
    provider === CLOUD_PROVIDER ||
    selectedEngineModes === undefined ||
    selectedEngineModes.includes(selectedMode);

  /** V2.51：图片不可用时给一个“真的去连一次”的入口；成功后会刷新 status 的 modes */
  const runLocalSelfCheck = useCallback(async (): Promise<void> => {
    if (checkingLocal) return;
    setCheckingLocal(true);
    setNotice(null);
    try {
      await fetchSelfCheck();
      refreshProviderStatus();
    } catch (caught) {
      setNotice(describeError(caught));
    } finally {
      setCheckingLocal(false);
    }
  }, [checkingLocal, refreshProviderStatus]);

  // 图片态：本地 ComfyUI 未配置时才禁用（配置了就走既有提交链路，失败由服务端如实报）
  const submitDisabled =
    submitting ||
    prompt.trim() === '' ||
    pending ||
    needsKey ||
    !modeReady ||
    hasMissingRef(refs) ||
    selection.ignored.length > 0 ||
    (kind === 'image' && !imageReady);

  /**
   * V2.12（台账 B48）：**提交前预估**（用户点"生成"之前就该看到要花多少钱 —— 这是 D44 改口的落点）。
   *
   * 与结算共用 `estimateCostFromRequest`（同一条路径，不会出现"预估一个价、结算另一个价"）。
   * 两条如实标注：
   * ① 汇率用 shared 的默认值（部署可用 `COST_USD_TO_CNY` 覆盖）→ 预估价与结算价**可能有小幅差异**，
   *    结算值（成本台账里那个）才是准的；
   * ② 自定义档（`ep-…`）不在单价表内 → 按 2.0 标准口径估算，并在文案里说出来。
   */
  const costEstimate = useMemo(
    () =>
      isHttpServiceEngine(provider)
        ? null // 远程 HTTP 服务没有本仓单价表：宁可不报价，也不写成 0 元
        : estimateCostFromRequest(
            {
              resolution:
                kind === 'image'
                  ? resolveImageSize(aspectRatio)
                  : resolveTargetSize(aspectRatio, resolutionTier),
              params: { durationSec },
              options: { model: byok.model },
            },
            { track: provider === 'cloud-volcano-seedance' ? 'cloud' : 'local' },
          ),
    [aspectRatio, resolutionTier, durationSec, byok.model, provider, kind],
  );

  /** 参数行右侧的价格文案；null = 不显示（没有可信报价时也不显示 0 元） */
  const priceLabel = useMemo(
    () =>
      costEstimate === null
        ? null
        : t('common.cost.estimated', { amount: formatYuan(costEstimate.yuan) }),
    [costEstimate, t],
  );

  // ── 素材动作 ──
  const addRef = (ref: MentionRef): void => {
    if (refs.some((item) => item.ref === ref.ref)) {
      setMentionOpen(false);
      setMentionFilter('');
      return;
    }
    setRefs((prev) => [...prev, ref]);
    if (ref.ref !== '' && ref.missing !== true) {
      promptEditorRef.current?.insertToken({
        id: ref.id,
        label: ref.label ?? ref.ref.slice(0, 10),
        kind: ref.kind,
      });
    }
    setMentionOpen(false);
    setMentionFilter('');
    setMentionActive(0);
  };

  /**
   * 从视频库点「作为参考」跳过来：`#/create?refTask=<taskId>`。
   *
   * ⚠️ 创作页是**常驻隐藏**的（App 的 keepalive），从别的视图切回来时**不会重新挂载** ——
   * 所以不能只在 mount 时读一次 hash，必须监听 `hashchange`（S4 实机踩到：
   * 直接打开链接有效，从视频库点按钮进来无效）。
   *
   * 用「上一次处理过的完整 hash」去重：同一个链接执行一次；成功后用 replaceState 把
   * query 抹掉（不触发 hashchange，也就不会自激）。
   */
  const lastHandledHash = useRef<string | null>(null);

  /** S5-B3c：从历史任务快照回填到创作页；只认真实快照，缺字段保留默认 */
  const applyReuse = useCallback(
    (target: TaskProgress): void => {
      const snapshot = target.requestSnapshot;
      const output = taskOutput(target);
      // S5-B3e：覆盖前留一份当前草稿（只保留最近一份）
      backupDraft({
        prompt,
        settings: {
          aspectRatio,
          ...(kind === 'image'
            ? { mode: 't2i' as const, resolution: resolveImageSize(aspectRatio) }
            : {
                durationSec,
                resolution: resolveTargetSize(aspectRatio, resolutionTier),
              }),
        },
        references: canvasReferencesForMentionRefs(refs),
      });
      setBackupAvailable(true);
      setKind(output.kind === 'image' ? 'image' : 'video');
      setPrompt(snapshot.prompt);
      promptEditorRef.current?.replaceText(snapshot.prompt);
      setAspectRatio(snapshot.aspectRatio);
      setDurationSec(
        clampDurationSec(snapshot.params?.durationSec ?? DEFAULT_DURATION_SEC),
      );
      if (snapshot.resolution !== undefined) {
        setResolutionTier(tierForSize(snapshot.resolution.width, snapshot.resolution.height));
      }
      setProvider(snapshot.provider);
      setSeed(snapshot.params?.seed === undefined ? '' : String(snapshot.params.seed));
      setSubmitError(null);
      setNotice(t('common.paramsReused'));
    },
    [
      aspectRatio,
      backupDraft,
      durationSec,
      kind,
      prompt,
      refs,
      resolutionTier,
      setKind,
      t,
    ],
  );

  /** S6-A3：把技能填入当前创作草稿；只填提示词/参数，不提交。 */
  const applySkill = useCallback(
    (skill: SkillManifest): void => {
      const supportedModes = new Set(['t2i', 't2v', 'i2v']);
      if (!skill.modes.some((mode) => supportedModes.has(mode))) {
        setNotice(
          t('skills.apply.unsupported', {
            modes: skill.modes.join(' / '),
          }),
        );
        return;
      }

      // 覆盖前留一份当前草稿；技能应用与“复用参数”同一纪律，不能吃掉用户刚写的内容。
      backupDraft({
        prompt,
        settings: {
          aspectRatio,
          ...(kind === 'image'
            ? { mode: 't2i' as const, resolution: resolveImageSize(aspectRatio) }
            : {
                durationSec,
                resolution: resolveTargetSize(aspectRatio, resolutionTier),
              }),
        },
        references: canvasReferencesForMentionRefs(refs),
      });
      setBackupAvailable(true);

      const supportsImage = skill.modes.includes('t2i');
      const supportsVideo = skill.modes.some((mode) => mode !== 't2i');
      const nextKind: typeof kind =
        supportsImage && !supportsVideo ? 'image' : supportsVideo && !supportsImage ? 'video' : kind;
      if (nextKind !== kind) setKind(nextKind);

      const nextPrompt = appendSkeleton(prompt, skill.prompt);
      setPrompt(nextPrompt);
      promptEditorRef.current?.replaceText(nextPrompt);
      if (skill.params.aspectRatio !== undefined) setAspectRatio(skill.params.aspectRatio);
      if (skill.params.resolutionTier !== undefined) {
        setResolutionTier(skill.params.resolutionTier);
      }
      if (skill.params.durationSec !== undefined) {
        setDurationSec(clampDurationSec(skill.params.durationSec));
      }
      setSubmitError(null);

      const needsImage =
        skill.requiresImage &&
        !refs.some(
          (item) => item.kind === 'image' && item.missing !== true && item.failed !== true,
        );
      setNotice(
        t(needsImage ? 'skills.appliedNeedsImage' : 'skills.applied', {
          name: skill.name,
        }),
      );
    },
    [
      aspectRatio,
      backupDraft,
      durationSec,
      kind,
      prompt,
      promptEditorRef,
      refs,
      resolutionTier,
      setKind,
      t,
    ],
  );

  /** S6-B2：请求 Agent 计划；只填计划卡，不动草稿。 */
  const requestAgentPlan = async (): Promise<void> => {
    const apiKey = resolveLlmKey(byok);
    if (apiKey === undefined) {
      setAgentError(t('agent.plan.noKey'));
      openByok();
      return;
    }
    const intent = prompt.trim();
    if (intent === '') {
      setAgentError(t('agent.plan.emptyIntent'));
      return;
    }

    setAgentLoading(true);
    setAgentError(null);
    setAgentPlan(null);
    setAgentPlanIssues([]);
    try {
      const result = await planAgent(
        {
          intent,
          skills: loadSkillLibrary().library.custom,
          llm: resolveLlmConfig(byok),
        },
        { llmKey: apiKey },
      );
      setAgentPlan({
        plan: result.plan,
        model: result.model,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      });
    } catch (caught) {
      setAgentError(describeError(caught));
    } finally {
      setAgentLoading(false);
    }
  };

  /** S7-C：计划卡的结构编辑只改步骤顺序/增删；应用前重新做 schema + 能力校验。 */
  const updateAgentPlan = (next: AgentPlan): void => {
    const parsed = AgentPlanSchema.safeParse(next);
    if (!parsed.success) {
      setAgentError(
        t('agent.plan.invalid', {
          issues: parsed.error.issues
            .map((issue) => `${issue.path.join('.')} ${issue.message}`)
            .join('；'),
        }),
      );
      return;
    }
    setAgentPlan((previous) =>
      previous === null ? previous : { ...previous, plan: parsed.data },
    );
    const validation = validateAgentPlan(parsed.data, agentSkills);
    setAgentPlanIssues(validation.ok ? [] : validation.issues);
    setAgentError(null);
  };

  /** S7-C2：把计划交给画布建草稿节点；不在此页提交生成。 */
  const createCanvasFromAgent = (): void => {
    if (agentPlan === null) return;
    const validation = validateAgentPlan(agentPlan.plan, agentSkills);
    if (!validation.ok) {
      setAgentPlanIssues(validation.issues);
      setAgentError(t('agent.plan.invalid', { issues: validation.issues.join('；') }));
      return;
    }
    if (!setAgentCanvasHandoff(agentPlan.plan)) {
      setAgentError(t('agent.plan.canvasFailed'));
      return;
    }
    setAgentError(null);
    navigate('#/canvas');
  };

  /** S6-B2：应用计划 = 落草稿；**不调用 submitGenerate**。 */
  const applyAgentPlan = async (): Promise<void> => {
    if (agentPlan === null || agentApplying) return;
    const validation = validateAgentPlan(agentPlan.plan, agentSkills);
    if (!validation.ok) {
      setAgentPlanIssues(validation.issues);
      setAgentError(t('agent.plan.invalid', { issues: validation.issues.join('；') }));
      return;
    }
    setAgentApplying(true);
    setAgentError(null);

    try {
      const library = loadSkillLibrary().library;
      const resolvedRefs: MentionRef[] = [];
      const seenRefs = new Set<string>();

      // 先把全部引用解析出来：任何一个失败都不备份/不改草稿，避免“半份方案”落盘。
      for (const step of agentPlan.plan.steps) {
        if (step.kind !== 'add-reference') continue;
        let nextRef: MentionRef;
        if (step.ref.startsWith('asset:')) {
          const asset = assetPool.find((item) => item.assetId === step.ref.slice('asset:'.length));
          const source = asset === undefined ? undefined : referenceSourcesFromAssets([asset])[0];
          if (source === undefined) {
            throw new Error(t('agent.plan.missingRef', { ref: step.ref }));
          }
          nextRef = refFromSource(source);
        } else {
          const task = await fetchTask(step.ref.slice('task:'.length));
          if (task.status !== 'succeeded' || taskOutput(task).kind === 'none') {
            throw new Error(t('agent.plan.taskNotReady', { ref: step.ref }));
          }
          nextRef = refFromTask(task);
        }
        if (!seenRefs.has(nextRef.ref)) {
          seenRefs.add(nextRef.ref);
          resolvedRefs.push(nextRef);
        }
      }

      const skillSteps = agentPlan.plan.steps.filter(
        (step): step is Extract<typeof step, { kind: 'apply-skill' }> =>
          step.kind === 'apply-skill',
      );
      const plannedSkills = skillSteps.map((step) => {
        const skill = findSkillInLibrary(library, step.skillId);
        if (skill === undefined) {
          throw new Error(t('agent.plan.missingSkill', { id: step.skillId }));
        }
        return { step, skill };
      });

      let nextPrompt = prompt;
      let nextAspect = aspectRatio;
      let nextResolution = resolutionTier;
      let nextDuration = durationSec;
      let nextKind: ComposerKind = kind;
      const applyParams = (params: SkillParams | undefined): void => {
        if (params === undefined) return;
        if (params.aspectRatio !== undefined) nextAspect = params.aspectRatio;
        if (params.resolutionTier !== undefined) nextResolution = params.resolutionTier;
        if (params.durationSec !== undefined) nextDuration = clampDurationSec(params.durationSec);
      };

      for (const { step, skill } of plannedSkills) {
        nextPrompt = appendSkeleton(nextPrompt, skill.prompt);
        if (step.prompt !== undefined) nextPrompt = appendSkeleton(nextPrompt, step.prompt);
        applyParams(skill.params);
        applyParams(step.params);
        const image = skill.modes.includes('t2i');
        const video = skill.modes.some((mode) => mode !== 't2i');
        if (image && !video) nextKind = 'image';
        else if (video && !image) nextKind = 'video';
      }
      for (const step of agentPlan.plan.steps) {
        if (step.kind === 'set-params') applyParams(step.params);
      }

      // S6-B3：同一方案 + 同一草稿 → 复用幂等键；改方案/改草稿 → 新键。
      const nextRefs = [...refs];
      for (const ref of resolvedRefs) {
        if (!nextRefs.some((item) => item.ref === ref.ref)) nextRefs.push(ref);
      }
      agentExecutionRef.current = reuseAgentExecution(
        agentExecutionRef.current,
        agentPlan.plan,
        {
          prompt: nextPrompt,
          kind: nextKind,
          aspectRatio: nextAspect,
          resolutionTier: nextResolution,
          durationSec: nextDuration,
          seed,
          provider,
          model: byok.model,
          refs: nextRefs.map((item) => ({ ref: item.ref, kind: item.kind })),
        },
      );

      // 覆盖前只备份一次（与“复用参数”同一纪律）；用户可用“恢复上一草稿”回退。
      backupDraft({
        prompt,
        settings: {
          aspectRatio,
          ...(kind === 'image'
            ? { mode: 't2i' as const, resolution: resolveImageSize(aspectRatio) }
            : {
                durationSec,
                resolution: resolveTargetSize(aspectRatio, resolutionTier),
              }),
        },
        references: canvasReferencesForMentionRefs(refs),
      });
      setBackupAvailable(true);

      setKind(nextKind);
      setPrompt(nextPrompt);
      promptEditorRef.current?.replaceText(nextPrompt);
      setAspectRatio(nextAspect);
      setResolutionTier(nextResolution);
      setDurationSec(nextDuration);
      for (const ref of resolvedRefs) addRef(ref);
      setSubmitError(null);
      setNotice(t('agent.plan.applied'));
      setAgentPlan(null);
      setAgentPlanIssues([]);
    } catch (caught) {
      setAgentError(t('agent.plan.failed', { reason: describeError(caught) }));
    } finally {
      setAgentApplying(false);
    }
  };

  /** S5-B3e：恢复覆盖前的草稿（prompt/参数/引用；token 正文按引用重建） */
  const restoreDraft = useCallback((): void => {
    const draft = readDraftBackup();
    if (draft === null) {
      setNotice(t('common.restoreDraftMissing'));
      setBackupAvailable(false);
      return;
    }
    setKind(draft.kind === 'image' ? 'image' : 'video');
    setPrompt(draft.prompt);
    promptEditorRef.current?.clearTokens();
    promptEditorRef.current?.replaceText(draft.prompt);
    setAspectRatio(draft.settings.aspectRatio ?? '16:9');
    setDurationSec(
      clampDurationSec(draft.settings.durationSec ?? DEFAULT_DURATION_SEC),
    );
    if (draft.settings.resolution !== undefined) {
      setResolutionTier(
        tierForSize(draft.settings.resolution.width, draft.settings.resolution.height),
      );
    }
    if (draft.settings.provider !== undefined) setProvider(draft.settings.provider);
    const restoredRefs = mentionRefsFromCanvasReferences(draft.references);
    setRefs(restoredRefs);
    for (const ref of restoredRefs) {
      if (ref.ref === '' || ref.missing === true) continue;
      promptEditorRef.current?.insertToken({
        id: ref.id,
        label: ref.label ?? ref.ref.slice(0, 10),
        kind: ref.kind,
      });
    }
    clearDraftBackup();
    setBackupAvailable(false);
    setNotice(t('common.draftRestored'));
  }, [clearDraftBackup, readDraftBackup, setKind, t]);

  useEffect(() => {
    const consume = (): void => {
      const hash = window.location.hash;
      if (hash === lastHandledHash.current) return;
      const query = parseHash(hash).query;
      const refTask = query.get('refTask');
      const reuseTask = query.get('reuse');
      const skillId = query.get('skill');
      if (refTask === null && reuseTask === null && skillId === null) return;
      lastHandledHash.current = hash;
      void (async () => {
        try {
          if (reuseTask !== null) {
            const fetched = await fetchTask(reuseTask);
            applyReuse(fetched);
          } else if (refTask !== null) {
            const fetched = await fetchTask(refTask);
            if (fetched.status !== 'succeeded' || taskOutput(fetched).kind === 'none') {
              setNotice(t('common.resultNotReady'));
              return;
            }
            addRef(refFromTask(fetched));
            setNotice(t('common.refAdded'));
          } else if (skillId !== null) {
            const skill = findSkillInLibrary(loadSkillLibrary().library, skillId);
            if (skill === undefined) {
              setNotice(t('skills.apply.missing'));
            } else {
              applySkill(skill);
            }
          }
          window.history.replaceState(
            null,
            '',
            `${window.location.pathname}${window.location.search}#/create`,
          );
        } catch (caught) {
          setNotice(describeError(caught));
        }
      })();
    };
    window.addEventListener('hashchange', consume);
    consume();
    return () => window.removeEventListener('hashchange', consume);
  }, [applyReuse, applySkill, t]);

  const removeRef = (id: string): void => {
    setRefs((prev) => prev.filter((item) => item.id !== id));
    // 外部 chip 的 × 同步删 token；token 自己删除时这里是无操作
    promptEditorRef.current?.removeToken(id);
  };

  /** 原生撤销恢复了 token：从目录找回引用（不重新插 token，DOM 已经在了） */
  const restoreRef = (id: string): void => {
    const restored = refCatalog.current.get(id);
    if (restored === undefined) return;
    setRefs((prev) =>
      prev.some((item) => item.id === id) ? prev : [...prev, { ...restored, missing: false }],
    );
  };

  /** 单条上传（首次与失败重试共用）；失败保留 chip + 原文件，不再直接删掉 */
  const uploadRef = useCallback(
    (id: string, file: File): void => {
      setUploadingCount((count) => count + 1);
      uploadAssets([file], projectId)
        .then((result) => {
          const asset = result.assets[0];
          if (asset === undefined) throw new Error(t('create.upload.noAsset'));
          // V2.10：拖进来的"视频"其实是纯音频容器（服务端 ffprobe 复核的结论）→ 如实报错，
          // 不把它伪装成可用的画面参考；chip 保留供重试/移除。
          if (asset.kind === 'audio') {
            throw new Error(t('create.upload.noVisual'));
          }
          const kind = asset.kind;
          setRefs((prev) =>
            prev.map((item) =>
              item.id === id
                ? {
                    ...item,
                    ref: asset.assetId,
                    kind,
                    failed: false,
                    failure: undefined,
                    file: undefined,
                    missing: false,
                  }
                : item,
            ),
          );
          setUploadError(null);
          promptEditorRef.current?.insertToken({
            id,
            label: file.name,
            kind,
          });
          void reloadPools();
        })
        .catch((caught: unknown) => {
          const message = describeError(caught);
          setUploadError(message);
          setRefs((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, failed: true, failure: message, file } : item,
            ),
          );
        })
        .finally(() => setUploadingCount((count) => count - 1));
    },
    [projectId, reloadPools, t],
  );

  /** 拖入 / 粘贴 / 选择文件 → 逐个上传为资产，chip 先以"上传中"占位（ref = ''） */
  const handleFiles = useCallback(
    (files: File[]): void => {
      // V2.10（B57）：音频是**合法上传**（服务端收，剪辑台音效轨用），但它不是生成参考 ——
      // 明确说出"去哪用"，而不是静默丢弃（不静默降级）
      const audioCount = files.filter((file) => file.type.startsWith('audio/')).length;
      if (audioCount > 0) {
        setUploadError(t('create.upload.audioNotRef'));
      } else {
        setUploadError(null);
      }

      const eligible = files
        .filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
        .slice(0, 4);
      if (eligible.length === 0) return;

      for (const file of eligible) {
        const id = newIdempotencyKey();
        const kind = file.type.startsWith('video/') ? ('video' as const) : ('image' as const);
        const objectUrl = URL.createObjectURL(file);
        objectUrls.current.push(objectUrl);
        setRefs((prev) => [
          ...prev,
          { id, ref: '', kind, previewUrl: objectUrl, label: file.name, file },
        ]);
        uploadRef(id, file);
      }
    },
    [t, uploadRef],
  );

  const retryRef = useCallback(
    (id: string): void => {
      const item = refs.find((ref) => ref.id === id);
      if (item?.file === undefined) return;
      setRefs((prev) =>
        prev.map((ref) =>
          ref.id === id ? { ...ref, failed: false, failure: undefined } : ref,
        ),
      );
      uploadRef(id, item.file);
    },
    [refs, uploadRef],
  );

  /** 打开提及弹层（顺手刷新素材池：刚生成/刚剪完的成片应当立刻可 @ —— 常驻视图不重挂载） */
  const openMentions = (): void => {
    setMentionOpen(true);
    setMentionFilter('');
    void reloadPools();
  };

  // S5-Ab/Ab：上传素材 + 首页产物同一条搜索/渲染路径；来源由条目自己携带。
  // S5-Ac：按当前引擎声明的参考能力过滤；未知（未自检）不隐藏，明确只支持 t2v/t2i 时给空态。
  const filteredSources = useMemo(
    () =>
      filterReferenceSources(
        mentionSources,
        mentionFilter,
        kind === 'image' ? [] : referenceKindsForModes(selectedEngineModes),
      ),
    [mentionSources, mentionFilter, kind, selectedEngineModes],
  );

  // ── 提交 ──
  const handleSubmit = async (): Promise<void> => {
    // `submitDisabled` 已包含"图片态不可提交"（S4 才接图片链路）：这里不再重复判断，
    // 否则 TS 5.5 的别名收窄会把 kind 断定成 'video'，让后面的守卫变成死代码。
    if (submitDisabled) return;
    setSubmitting(true);
    setSubmitError(null);
    setNotice(null);

    const assets = assetsForRefs(refs);
    // 图片态：`t2i` 不接任何素材（模板自行出图），引擎已由上面的 effect 切到本地 ComfyUI。
    const request: VideoGenerateRequest =
      kind === 'image'
        ? {
            prompt: prompt.trim(),
            mode: 't2i',
            aspectRatio,
            resolution: resolveImageSize(aspectRatio),
            provider,
            options: { baseUrl: byok.baseUrl, model: byok.model },
            projectId,
          }
        : {
            prompt: prompt.trim(),
            mode: selection.mode,
            aspectRatio,
            resolution: resolveTargetSize(aspectRatio, resolutionTier),
            provider,
            options: { baseUrl: byok.baseUrl, model: byok.model },
            // V2.11（B47）：出到当前项目（它同时进幂等指纹 —— 见 CONTRACT §1）
            projectId,
            ...(assets === undefined ? {} : { assets }),
            params: {
              durationSec,
              ...(seed.trim() === '' ? {} : { seed: Number.parseInt(seed, 10) }),
            },
          };

    try {
      const idempotencyKey = idempotencyKeyForSubmit(agentExecutionRef.current, {
        prompt: prompt.trim(),
        kind,
        aspectRatio,
        resolutionTier,
        durationSec,
        seed,
        provider,
        model: byok.model,
        refs: refs.map((item) => ({ ref: item.ref, kind: item.kind })),
      });
      const result = await submitGenerate(request, {
        idempotencyKey,
        ...(providerKey === undefined ? {} : { providerKey }),
      });
      setTaskId(result.taskId);
      if (ignoredHint !== null) setNotice(ignoredHint);
    } catch (caught) {
      setSubmitError(describeError(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const mentionCandidateCount = filteredSources.length;
  const mentionIndex = Math.min(mentionActive, Math.max(0, mentionCandidateCount - 1));

  const pickMentionAt = (index: number): void => {
    const candidate = filteredSources[index];
    if (candidate !== undefined) addRef(refFromSource(candidate));
  };

  const pickFirstMatch = (): void => pickMentionAt(mentionIndex);

  // V2.40：产物可能是视频或图片（`t2i`）—— 用 shared 的 `taskOutput()` 收口
  const output = task === null ? { kind: 'none' as const } : taskOutput(task);
  const outputUrl =
    output.kind === 'video' || output.kind === 'image' ? resolveMediaUrl(output.url) : null;
  const outputKind: 'video' | 'image' | 'none' = output.kind;

  return (
    /* 单列页面容器 `wb-page`，**不是** `wb-main`：后者是工作台三栏栅格
       （`minmax(320px,380px) 1fr minmax(300px,360px)`），造梦盒塞进第一栏会只剩 380px 宽 */
    <section className="wb-page">
      <div
        className={dragActive ? 'cr-wrap cr-wrap-drag' : 'cr-wrap'}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          handleFiles(Array.from(event.dataTransfer.files));
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length > 0) {
            event.preventDefault();
            handleFiles(files);
          }
        }}
      >
        <header className="cr-hero">
          <p className="cr-eyebrow">{t('create.hero.eyebrow')}</p>
          <h2 className="cr-title">{t('create.hero.title')}</h2>
          <p className="cr-sub">
            {t('create.hero.sub.before')}
            <code>@</code>
            {t('create.hero.sub.after')}
          </p>
        </header>

        <div className="cr-panel">
          <CreationTypeBar
            kind={kind}
            onChange={setKind}
            // 由 `/status` 的配置事实驱动：没配 ComfyUI 时角标"待接入"，配了就正常可选
            imageReady={imageReady}
          />
          <StructuredPromptInput
            ref={promptEditorRef}
            initialText={prompt}
            text={prompt}
            initialTokens={inlineTokens}
            placeholder={t('create.input.placeholder')}
            ariaLabel={t('create.input.placeholder')}
            onChange={setPrompt}
            onRemoveToken={removeRef}
            onRestoreToken={restoreRef}
            onOpenMentions={openMentions}
            onPasteFiles={handleFiles}
            onSubmit={() => void handleSubmit()}
          />

          <div className="cr-hint-row">
            <button type="button" className="cr-recipe" onClick={openMentions}>
              {t('create.hint.mention')}
            </button>
            <span className="wb-note">{t('create.hint.mentionNote')}</span>
            <button
              type="button"
              className="cr-agent-trigger"
              data-testid="agent-plan-button"
              disabled={agentLoading || agentApplying}
              onClick={() => void requestAgentPlan()}
            >
              {agentLoading ? t('agent.plan.loading') : t('agent.plan.button')}
            </button>
            <span className="wb-note cr-shortcut">{t('create.hint.submit')}</span>
            {backupAvailable ? (
              <button type="button" className="cr-link" onClick={restoreDraft}>
                {t('common.restoreDraft')}
              </button>
            ) : null}
          </div>

          {agentError === null ? null : (
            <p className="wb-alert" role="alert">
              {agentError}
            </p>
          )}

          {agentPlan === null ? null : (
            <AgentPlanPanel
              plan={agentPlan.plan}
              model={agentPlan.model}
              {...(agentPlan.usage === undefined ? {} : { usage: agentPlan.usage })}
              skills={agentSkills}
              applying={agentApplying}
              issues={agentPlanIssues}
              onPlanChange={updateAgentPlan}
              onCreateCanvas={createCanvasFromAgent}
              onApply={() => void applyAgentPlan()}
              onReject={() => {
                setAgentPlan(null);
                setAgentPlanIssues([]);
                setAgentError(null);
                setNotice(t('agent.plan.rejected'));
              }}
              onModify={() => {
                setAgentPlan(null);
                setAgentPlanIssues([]);
                setAgentError(null);
                promptEditorRef.current?.focus();
              }}
            />
          )}

          {refs.length > 0 ? (
            <div className="cr-chips">
              {refs.map((item) => {
                const role = mentionRole(item, refs);
                return (
                  <span
                    key={item.id}
                    className={`cr-chip${item.missing ? ' is-missing' : ''}${
                      item.failed ? ' is-failed' : ''
                    }`}
                  >
                    {item.previewUrl ? (
                      <img className="cr-chip-thumb" src={item.previewUrl} alt="" />
                    ) : (
                      <span className="cr-chip-glyph">{item.kind === 'video' ? '🎬' : '🖼'}</span>
                    )}
                    <span className="cr-chip-label">
                      {item.ref === ''
                        ? item.failed
                          ? t('create.chip.uploadFailed')
                          : t('common.uploading')
                        : (item.label ?? item.ref.slice(0, 10))}
                    </span>
                    {role === null ? null : (
                      <span className="cr-chip-role">{t(REF_ROLE_KEYS[role])}</span>
                    )}
                    {item.missing === true ? (
                      <span className="cr-chip-role cr-chip-role--missing">
                        {t('create.chip.missing')}
                      </span>
                    ) : null}
                    {item.failed === true ? (
                      <button
                        type="button"
                        className="cr-chip-retry"
                        disabled={item.file === undefined}
                        onClick={() => retryRef(item.id)}
                      >
                        {t('create.chip.retry')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="cr-chip-remove"
                      aria-label={t('create.chip.remove')}
                      onClick={() => removeRef(item.id)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              {selection.mode === 'fl2v' ? (
                <button
                  type="button"
                  className="cr-chip-swap"
                  onClick={() => setRefs((prev) => swapFirstLast(prev))}
                >
                  {t('create.chip.swap')}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* B32（Step 10 · P1）：真人素材的**前置提示** —— 只做文案引导（本项目无本地人脸检测能力，
              不假装检测、不阻断选择）；上游隐私检测拒绝时后端会给出可执行文案（seedanceProtocol） */}
          {refs.some((item) => item.kind === 'image') ? (
            <p className="wb-note cr-realperson-note">{t('create.realperson')}</p>
          ) : null}

          {mentionOpen ? (
            <div
              className="cr-mention"
              role="listbox"
              aria-label={t('create.mention.select')}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMentionOpen(false);
                }
              }}
            >
              <input
                className="wb-input cr-mention-search"
                placeholder={t('create.mention.search')}
                value={mentionFilter}
                autoFocus
                onChange={(event) => {
                  setMentionFilter(event.target.value);
                  setMentionActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMentionOpen(false);
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    if (mentionCandidateCount > 0) {
                      setMentionActive((index) => Math.min(index + 1, mentionCandidateCount - 1));
                    }
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setMentionActive((index) => Math.max(index - 1, 0));
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    pickFirstMatch();
                  }
                }}
              />
              <div className="cr-mention-list">
                {filteredSources.length === 0 ? (
                  <p className="wb-note cr-mention-empty">{t('create.mention.empty')}</p>
                ) : null}
                {filteredSources.map((source, index) => (
                  <button
                    key={source.key}
                    type="button"
                    role="option"
                    aria-selected={index === mentionIndex}
                    className={
                      index === mentionIndex ? 'cr-mention-item is-active' : 'cr-mention-item'
                    }
                    onMouseEnter={() => setMentionActive(index)}
                    onFocus={() => setMentionActive(index)}
                    onClick={() => addRef(refFromSource(source))}
                  >
                    {source.kind === 'image' && source.previewUrl !== undefined ? (
                      <img className="cr-mention-thumb" src={source.previewUrl} alt="" />
                    ) : (
                      <span className="cr-mention-glyph">
                        {source.kind === 'video' ? '🎬' : source.kind === 'audio' ? '♪' : '🖼'}
                      </span>
                    )}
                    <span className="cr-mention-label">
                      <span className="cr-mention-source">
                        {t(referenceSourceLabelKey(source.source))}
                      </span>
                      {source.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}


          {moreOpen ? (
            <div className="cr-advanced">
              <label className="cr-bar-field">
                <span className="wb-label">{t('create.more.seed')}</span>
                <input
                  className="wb-input"
                  inputMode="numeric"
                  placeholder={t('create.more.seedPlaceholder')}
                  value={seed}
                  onChange={(event) => setSeed(event.target.value.replace(/[^\d-]/g, ''))}
                />
              </label>
            </div>
          ) : null}

          <ComposerBar
            kind={kind}
            allowCloud={kind === 'video'}
            aspectRatio={aspectRatio}
            resolutionTier={resolutionTier}
            durationSec={durationSec}
            engines={kind === 'image' ? imageEngines : videoEngines}
            provider={provider}
            modelLabel={byok.model === '' ? undefined : byok.model}
            priceText={
              kind === 'image'
                ? null
                : isHttpServiceEngine(provider)
                  ? t('canvas.studio.pricePending')
                  : priceLabel
            }
            submitDisabled={submitDisabled}
            submitting={submitting}
            onAspectChange={setAspectRatio}
            onResolutionChange={setResolutionTier}
            onDurationChange={setDurationSec}
            onProviderChange={(next) => setProvider(next as ProviderType)}
            onOpenMentions={openMentions}
            onSubmit={() => void handleSubmit()}
            advancedOpen={moreOpen}
            onToggleAdvanced={() => setMoreOpen((open) => !open)}
          />
        </div>

        {/* 图片态没有"模式推断"这回事（t2i 是固定的），不显示视频的模式行免得误导 */}
        {kind === 'image' ? null : (
          <div className="cr-mode-line">
            <span className="cr-mode-tag">
              {t('create.modeLine', { mode: t(MODE_KEYS[selection.mode]) })}
            </span>
            {ignoredHint === null ? null : <span className="wb-note">{ignoredHint}</span>}
            {pending ? <span className="wb-note">{t('create.modeLine.pending')}</span> : null}
            {modeReady ? null : <span className="wb-note">{t('create.modeUnsupported')}</span>}
          </div>
        )}

        {kind === 'image' ? (
          imageReady ? null : (
            <p className="wb-note">
              {t('create.type.imagePendingHint')}{' '}
              <button
                type="button"
                className="cr-link"
                disabled={checkingLocal}
                onClick={() => void runLocalSelfCheck()}
              >
                {checkingLocal ? t('workbench.selfcheck.checking') : t('workbench.selfcheck.run')}
              </button>
            </p>
          )
        ) : needsKey ? (
          <p className="wb-note">
            {t('create.needsKey')}{' '}
            <button type="button" className="cr-link" onClick={openByok}>
              {t('create.needsKey.action')}
            </button>
          </p>
        ) : null}

        {uploadError === null ? null : (
          <div className="wb-uncertain cr-alert" role="alert">
            <span className="wb-uncertain-title">{t('create.alert.uploadFailed')}</span>
            <span className="wb-uncertain-body">{uploadError}</span>
          </div>
        )}
        {poolError === null ? null : (
          <div className="wb-uncertain cr-alert" role="alert">
            <span className="wb-uncertain-title">{t('create.alert.poolFailed')}</span>
            <span className="wb-uncertain-body">{poolError}</span>
            <button type="button" className="wb-btn" onClick={() => void reloadPools()}>
              {t('common.retry')}
            </button>
          </div>
        )}
        {submitError === null ? null : (
          <div className="wb-uncertain cr-alert" role="alert">
            <span className="wb-uncertain-title">{t('create.alert.submitFailed')}</span>
            <span className="wb-uncertain-body">{submitError}</span>
          </div>
        )}
        {notice === null ? null : (
          <div className="wb-queue-item cr-alert">
            <span className="wb-dot" />
            <span className="wb-note">{notice}</span>
          </div>
        )}
        {pollingError === null ? null : (
          <div className="wb-uncertain cr-alert" role="alert">
            <span className="wb-uncertain-title">{t('create.alert.pollFailed')}</span>
            <span className="wb-uncertain-body">{pollingError.failure.message}</span>
          </div>
        )}

        {task === null ? null : (
          <div className="cr-task">
            <div className="cr-task-head">
              <span
                className={
                  task.status === 'succeeded'
                    ? 'wb-badge wb-badge-ok'
                    : task.status === 'failed'
                      ? 'wb-badge wb-badge-bad'
                      : 'wb-badge'
                }
                role="status"
                aria-live="polite"
              >
                <span className="wb-dot" />
                {t(STATUS_KEYS[task.status])}
              </span>
              <span className="wb-note">
                {t('create.task.idLine', {
                  id: task.taskId.slice(0, 8),
                  prompt: task.requestSnapshot.prompt.slice(0, 24),
                })}
              </span>
              <button
                type="button"
                className="cr-link"
                onClick={() => navigate(`#/library?task=${encodeURIComponent(task.taskId)}`)}
              >
                {t('create.task.viewInLibrary')}
              </button>
            </div>

            {task.status === 'failed' ? (
              <p className="wb-note cr-task-error">
                {task.error === undefined
                  ? t('create.task.failedFallback')
                  : `${task.error.code}：${task.error.message}`}
              </p>
            ) : null}

            {task.status === 'queued' || task.status === 'running' ? (
              <div className="cr-bar" role="progressbar" aria-valuenow={task.progressPercent}>
                <div className="cr-bar-fill" style={{ width: `${task.progressPercent}%` }} />
              </div>
            ) : null}

            {task.status === 'succeeded' && outputUrl !== null ? (
              <>
                {outputKind === 'image' ? (
                  <img className="cr-player" src={outputUrl} alt={t('create.task.imageAlt')} />
                ) : (
                  <video className="cr-player" src={outputUrl} controls playsInline />
                )}
                <div className="cr-task-actions">
                  <a className="cr-link" href={outputUrl} download>
                    {t('create.task.download')}
                  </a>
                  <button
                    type="button"
                    className="cr-link"
                    onClick={() =>
                      setLightbox({
                        kind: outputKind === 'image' ? 'image' : 'video',
                        url: outputUrl,
                        title: task.requestSnapshot.prompt,
                      })
                    }
                  >
                    {t('common.fullscreen')}
                  </button>
                  <button
                    type="button"
                    className="cr-link"
                    onClick={() => {
                      addRef(refFromTask(task));
                      setNotice(t('common.refAdded'));
                    }}
                  >
                    {t('common.asReference')}
                  </button>
                  <button
                    type="button"
                    className="cr-link"
                    onClick={() => applyReuse(task)}
                  >
                    {t('common.reuseParams')}
                  </button>
                  <button
                    type="button"
                    className="cr-link"
                    onClick={() => {
                      const output = taskOutput(task);
                      if (output.kind === 'none') {
                        setNotice(t('common.resultNotReady'));
                        return;
                      }
                      if (
                        !setCanvasResultHandoff({
                          taskId: task.taskId,
                          kind: output.kind,
                          url: output.url,
                          title: task.requestSnapshot.prompt.slice(0, 40),
                        })
                      ) {
                        setNotice(t('common.resultStorageOff'));
                        return;
                      }
                      navigate('#/canvas');
                    }}
                  >
                    {t('common.toCanvas')}
                  </button>
                  {/* V2.40：图片产物**送不了剪辑台**（剪辑台要视频源片）—— 不摆一个点了会报错的按钮 */}
                  {outputKind === 'video' ? (
                    <button
                      type="button"
                      className="cr-link"
                      onClick={() => navigate(`#/edit?task=${encodeURIComponent(task.taskId)}`)}
                    >
                      {t('create.task.toEditor')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="cr-link"
                    onClick={() => {
                      // 显式“再来一次”= 新执行：不能复用上一方案的幂等键。
                      agentExecutionRef.current = null;
                      setTaskId(null);
                      setPrompt('');
                      setRefs([]);
                    }}
                  >
                    {t('create.task.again')}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

      {lightbox === null ? null : (
        <MediaLightbox
          open
          kind={lightbox.kind}
          url={lightbox.url}
          title={lightbox.title}
          downloadName={`${task?.taskId ?? 'result'}.${lightbox.kind === 'image' ? 'png' : 'mp4'}`}
          onClose={() => setLightbox(null)}
        />
      )}
    </section>
  );
}
