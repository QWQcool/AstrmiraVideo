import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AspectRatio,
  AssetListEntry,
  GenerationMode,
  ProviderType,
  TaskProgress,
  VideoGenerateRequest,
} from '@astrmira/shared';
import {
  INDUSTRY_TEMPLATES,
  RECIPE_CARDS,
  estimateCostFromRequest,
  formatYuan,
} from '@astrmira/shared';
import {
  ApiError,
  fetchAssets,
  fetchHistory,
  resolveMediaUrl,
  submitGenerate,
  uploadAssets,
} from '../lib/api';
import { resolveProviderKey } from '../lib/byok';
import {
  DEFAULT_DURATION_SEC,
  DEFAULT_RESOLUTION_TIER,
  DURATION_OPTIONS,
  RESOLUTION_TIERS,
  resolveTargetSize,
  type ResolutionTier,
} from '../lib/format';
import { newIdempotencyKey } from '../lib/idempotency';
import { useTranslate, type MessageKey, type Translate } from '../lib/i18n';
import {
  assetsForRefs,
  filterAssetCandidates,
  filterTaskCandidates,
  hasPendingRef,
  ignoredMentionHint,
  selectMentions,
  type MentionRef,
} from '../lib/mentions';
import { comfyUiEngineOptions } from '../lib/engineOptions';
import { appendSkeleton } from '../lib/recipeInsert';
import { navigate } from '../lib/router';
import { useShell } from '../lib/shell';
import { useTaskPolling } from '../hooks/useTaskPolling';

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
const MODE_KEYS: Record<GenerationMode, MessageKey> = {
  t2v: 'common.mode.t2v',
  i2v: 'common.mode.i2v',
  fl2v: 'common.mode.fl2v',
  v2v: 'common.mode.v2v',
};

const STATUS_KEYS: Record<TaskProgress['status'], MessageKey> = {
  queued: 'common.status.queued',
  running: 'common.status.running',
  succeeded: 'common.status.succeeded',
  failed: 'common.status.failed',
  cancelled: 'common.status.cancelled',
};

/** 配方 chips：横滚条只放前 12 张（全量在配方库），避免首页变成第二个配方库 */
const STRIP_RECIPES = RECIPE_CARDS.slice(0, 12);

function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

/** 成片/剪辑产物 → chip 引用（`task:` 形态，V2.6） */
function refFromTask(task: TaskProgress): MentionRef {
  return {
    id: newIdempotencyKey(),
    ref: `task:${task.taskId}`,
    kind: 'video',
    previewUrl: task.thumbnailUrl ?? null,
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

/**
 * 资产 → chip 引用（只接受 RefAsset；音频在池入口就被过滤掉）。
 *
 * `t` 当参数传进来而不是在函数里取：这是**纯函数**，不该 import React 去要 hook。
 */
function refFromAsset(asset: RefAsset, t: Translate): MentionRef {
  // V2.9（B43）：有原始文件名就用它当 chip 标签（人认得名字，认不出编号）；
  // 没有（抽帧产物 / 老资产）就退回"图/视频·编号"，**不编造名字**
  const label =
    asset.name === undefined
      ? `${t(asset.kind === 'image' ? 'create.chip.imageShort' : 'common.kind.video')}·${asset.assetId.slice(0, 6)}`
      : asset.name.length > 16
        ? `${asset.name.slice(0, 16)}…`
        : asset.name;

  return {
    id: newIdempotencyKey(),
    ref: asset.assetId,
    kind: asset.kind,
    previewUrl: asset.kind === 'image' ? asset.url : null,
    label,
  };
}

export function CreateView() {
  const { byok, providerStatus, openByok, projectId } = useShell();
  const t = useTranslate();

  // ── 意图与素材 ──
  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState<MentionRef[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');

  // ── 素材池（`@` 弹层的候选：资产库 + 成片/剪辑产物）──
  // V2.10：池子里**只放可作为生成参考的资产**（音频素材挡在池外，见 `isRefAsset`）
  const [assetPool, setAssetPool] = useState<RefAsset[]>([]);
  const [taskPool, setTaskPool] = useState<TaskProgress[]>([]);
  const [poolError, setPoolError] = useState<string | null>(null);

  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const objectUrls = useRef<string[]>([]);

  // ── 更多设置（默认收起；D39："控件分层"而不是删控件）──
  const [moreOpen, setMoreOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [durationSec, setDurationSec] = useState<number>(DEFAULT_DURATION_SEC);
  const [resolutionTier, setResolutionTier] = useState<ResolutionTier>(DEFAULT_RESOLUTION_TIER);
  const [provider, setProvider] = useState<ProviderType>(CLOUD_PROVIDER);
  const [seed, setSeed] = useState('');
  /** V2.36：本地 ComfyUI 可能是**多台**（§19-1）—— 名单来自 `/status`，前端不维护第二份 */
  const comfyEngines = comfyUiEngineOptions(providerStatus);

  // ── 提交与内联任务卡 ──
  const [taskId, setTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
          .filter((item) => item.status === 'succeeded' && item.outputVideoUrl !== undefined)
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
      );
      setPoolError(null);
    } catch (caught) {
      setPoolError(describeError(caught));
    }
  }, [projectId]);

  useEffect(() => {
    void reloadPools();
  }, [reloadPools]);

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

  const submitDisabled = submitting || prompt.trim() === '' || pending || needsKey;

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
      estimateCostFromRequest(
        {
          resolution: resolveTargetSize(aspectRatio, resolutionTier),
          params: { durationSec },
          options: { model: byok.model },
        },
        { track: provider === 'cloud-volcano-seedance' ? 'cloud' : 'local' },
      ),
    [aspectRatio, resolutionTier, durationSec, byok.model, provider],
  );

  // ── 素材动作 ──
  const addRef = (ref: MentionRef): void => {
    setRefs((prev) => (prev.some((item) => item.ref === ref.ref) ? prev : [...prev, ref]));
    setMentionOpen(false);
    setMentionFilter('');
  };

  const removeRef = (id: string): void => {
    setRefs((prev) => prev.filter((item) => item.id !== id));
  };

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
        setRefs((prev) => [...prev, { id, ref: '', kind, previewUrl: objectUrl, label: file.name }]);
        setUploadingCount((count) => count + 1);

        uploadAssets([file], projectId)
          .then((result) => {
            const asset = result.assets[0];
            if (asset === undefined) throw new Error(t('create.upload.noAsset'));
            // V2.10：拖进来的"视频"其实是纯音频容器（服务端 ffprobe 复核的结论）→ 如实报错，
            // 不把它伪装成可用的画面参考（catch 分支会把占位 chip 撤掉）
            if (asset.kind === 'audio') {
              throw new Error(t('create.upload.noVisual'));
            }
            const kind = asset.kind;
            setRefs((prev) =>
              prev.map((item) => (item.id === id ? { ...item, ref: asset.assetId, kind } : item)),
            );
            void reloadPools();
          })
          .catch((caught: unknown) => {
            setUploadError(describeError(caught));
            setRefs((prev) => prev.filter((item) => item.id !== id));
          })
          .finally(() => setUploadingCount((count) => count - 1));
      }
    },
    [reloadPools, projectId],
  );

  /** 打开提及弹层（顺手刷新素材池：刚生成/刚剪完的成片应当立刻可 @ —— 常驻视图不重挂载） */
  const openMentions = (): void => {
    setMentionOpen(true);
    setMentionFilter('');
    void reloadPools();
  };

  /** `@` 唤起的输入检测：输入 `@` 打开弹层并从文本里去掉它（chip 才是真相，文本不留 `@`） */
  const handlePromptChange = (value: string, previous: string): void => {
    if (value.endsWith('@') && !previous.endsWith('@')) {
      setPrompt(value.slice(0, -1));
      openMentions();
      return;
    }
    setPrompt(value);
  };

  const filteredTasks = useMemo(
    () => filterTaskCandidates(taskPool, mentionFilter),
    [taskPool, mentionFilter],
  );

  // V2.9（B43）：按**名字**过滤（有名字时），assetId 仍可搜（老习惯与老资产兜底）——纯函数在 lib/mentions
  const filteredAssets = useMemo(
    () => filterAssetCandidates(assetPool, mentionFilter),
    [assetPool, mentionFilter],
  );

  // ── 提交 ──
  const handleSubmit = async (): Promise<void> => {
    if (submitDisabled) return;
    setSubmitting(true);
    setSubmitError(null);
    setNotice(null);

    const assets = assetsForRefs(refs);
    const request: VideoGenerateRequest = {
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
      const result = await submitGenerate(request, {
        idempotencyKey: newIdempotencyKey(),
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

  const pickFirstMatch = (): void => {
    const firstTask = filteredTasks[0];
    if (firstTask !== undefined) {
      addRef(refFromTask(firstTask));
      return;
    }
    const firstAsset = filteredAssets[0];
    if (firstAsset !== undefined) addRef(refFromAsset(firstAsset, t));
  };

  const outputUrl = task === null ? null : resolveMediaUrl(task.outputVideoUrl);

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
          <textarea
            className="cr-input"
            rows={3}
            placeholder={t('create.input.placeholder')}
            value={prompt}
            onChange={(event) => handlePromptChange(event.target.value, prompt)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMentionOpen(false);
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
          />

          <div className="cr-hint-row">
            <button type="button" className="cr-recipe" onClick={openMentions}>
              {t('create.hint.mention')}
            </button>
            <span className="wb-note">{t('create.hint.mentionNote')}</span>
          </div>

          {refs.length > 0 ? (
            <div className="cr-chips">
              {refs.map((item) => (
                <span key={item.id} className="cr-chip">
                  {item.previewUrl ? (
                    <img className="cr-chip-thumb" src={item.previewUrl} alt="" />
                  ) : (
                    <span className="cr-chip-glyph">{item.kind === 'video' ? '🎬' : '🖼'}</span>
                  )}
                  <span className="cr-chip-label">
                    {item.ref === '' ? t('common.uploading') : (item.label ?? item.ref.slice(0, 10))}
                  </span>
                  <button
                    type="button"
                    className="cr-chip-remove"
                    aria-label={t('create.chip.remove')}
                    onClick={() => removeRef(item.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {/* B32（Step 10 · P1）：真人素材的**前置提示** —— 只做文案引导（本项目无本地人脸检测能力，
              不假装检测、不阻断选择）；上游隐私检测拒绝时后端会给出可执行文案（seedanceProtocol） */}
          {refs.some((item) => item.kind === 'image') ? (
            <p className="wb-note cr-realperson-note">{t('create.realperson')}</p>
          ) : null}

          {mentionOpen ? (
            <div className="cr-mention" role="listbox" aria-label={t('create.mention.select')}>
              <input
                className="wb-input cr-mention-search"
                placeholder={t('create.mention.search')}
                value={mentionFilter}
                autoFocus
                onChange={(event) => setMentionFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setMentionOpen(false);
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    pickFirstMatch();
                  }
                }}
              />
              <div className="cr-mention-list">
                {filteredTasks.length === 0 && filteredAssets.length === 0 ? (
                  <p className="wb-note cr-mention-empty">{t('create.mention.empty')}</p>
                ) : null}
                {filteredTasks.map((item) => (
                  <button
                    key={item.taskId}
                    type="button"
                    className="cr-mention-item"
                    onClick={() => addRef(refFromTask(item))}
                  >
                    {item.thumbnailUrl === undefined ? (
                      <span className="cr-mention-glyph">🎬</span>
                    ) : (
                      <img className="cr-mention-thumb" src={item.thumbnailUrl} alt="" />
                    )}
                    <span className="cr-mention-label">
                      {item.origin?.kind === 'edit'
                        ? t('common.origin.editBadge')
                        : t('common.origin.renderBadge')}
                      {item.requestSnapshot.prompt.slice(0, 18)}
                    </span>
                  </button>
                ))}
                {filteredAssets.map((item) => (
                  <button
                    key={item.assetId}
                    type="button"
                    className="cr-mention-item"
                    onClick={() => addRef(refFromAsset(item, t))}
                  >
                    {item.kind === 'image' ? (
                      <img className="cr-mention-thumb" src={item.url} alt="" />
                    ) : (
                      <span className="cr-mention-glyph">🎬</span>
                    )}
                    <span className="cr-mention-label">
                      {/* V2.9（B43）：有原始文件名就显示名字（人认名字，不认编号） */}
                      {t('create.mention.assetLine', {
                        kind: t(item.kind === 'image' ? 'common.kind.image' : 'common.kind.video'),
                        name: item.name ?? item.assetId.slice(0, 8),
                      })}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="cr-recipes" aria-label={t('create.recipes.aria')}>
            {STRIP_RECIPES.map((card) => (
              <button
                key={card.id}
                type="button"
                className="cr-recipe"
                title={card.pitfalls?.[0] ?? card.title}
                onClick={() => setPrompt((prev) => appendSkeleton(prev, card.skeleton))}
              >
                {card.title}
              </button>
            ))}
            <button
              type="button"
              className="cr-recipe cr-recipe-more"
              onClick={() => navigate('#/recipes')}
            >
              {t('create.recipes.all')}
            </button>
          </div>

          {/* V2.23（台账 B71）：行业模板 —— 客户第一次打开时，"你能做什么"不该由他自己想。
              点一下 = 填入**起手式**（提示词骨架 + 画幅/时长/清晰度）；**模式仍由素材与提示词推断**，
              所以这里的措辞是"推荐"，不假装"已切换"。 */}
          <div className="cr-recipes cr-templates" aria-label={t('create.templates.aria')}>
            <span className="cr-tpl-label">{t('create.templates.label')}</span>
            {INDUSTRY_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="cr-recipe cr-recipe-tpl"
                data-testid={`cr-template-${template.id}`}
                title={t('create.templates.title', {
                  summary: template.summary,
                  mode: t(MODE_KEYS[template.recommendedMode]),
                  ratio: template.aspectRatio,
                  duration: template.durationSec,
                  needImage: template.requiresImage ? t('create.templates.needImage') : '',
                })}
                onClick={() => {
                  setPrompt(template.skeleton);
                  setAspectRatio(template.aspectRatio);
                  setDurationSec(template.durationSec);
                  setResolutionTier(template.resolutionTier);
                  setNotice(
                    t('create.templates.applied', {
                      industry: template.industry,
                      title: template.title,
                      mode: t(MODE_KEYS[template.recommendedMode]),
                      ratio: template.aspectRatio,
                      duration: template.durationSec,
                      tier: template.resolutionTier,
                    }),
                  );
                }}
              >
                {template.industry} · {template.title}
              </button>
            ))}
          </div>

          {moreOpen ? (
            <div className="cr-more">
              <div className="cr-more-grid">
                <div className="wb-field">
                  <span className="wb-label">{t('create.more.aspect')}</span>
                  <div className="wb-segmented">
                    {(['16:9', '9:16'] as const).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        className="wb-segment"
                        aria-pressed={aspectRatio === ratio}
                        onClick={() => setAspectRatio(ratio)}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="wb-field">
                  <span className="wb-label">{t('create.more.duration')}</span>
                  <div className="wb-segmented">
                    {DURATION_OPTIONS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="wb-segment"
                        aria-pressed={durationSec === value}
                        onClick={() => setDurationSec(value)}
                      >
                        {value}s
                      </button>
                    ))}
                  </div>
                </div>
                <div className="wb-field">
                  <span className="wb-label">{t('create.more.resolution')}</span>
                  <div className="wb-segmented">
                    {RESOLUTION_TIERS.map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        className="wb-segment"
                        aria-pressed={resolutionTier === tier}
                        onClick={() => setResolutionTier(tier)}
                      >
                        {tier}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="wb-field">
                  <span className="wb-label">{t('create.more.engine')}</span>
                  <div className="wb-segmented">
                    <button
                      type="button"
                      className="wb-segment"
                      aria-pressed={provider === CLOUD_PROVIDER}
                      onClick={() => setProvider(CLOUD_PROVIDER)}
                    >
                      {t('common.engine.cloud')}
                    </button>
                    {/* ⚠️ V2.37（D56）：「本地 H3」这一档已撤掉（与左栏同步）——
                        以前这里摆着一个永远不可用的选项；现在本地轨只有 ComfyUI。 */}
                    {/* V2.31（A1 片 C / D53）：自备 ComfyUI —— 与左栏同一档语义，
                        能不能跑（模型/节点）由服务端在提交时判定并如实报错（§19-2）。
                        V2.36：可能有多台（§19-1）—— 单台时就在这一行，多台时另起一行。 */}
                    {comfyEngines.length === 1 && comfyEngines[0] !== undefined ? (
                      <button
                        type="button"
                        className="wb-segment"
                        data-testid={`cr-engine-${comfyEngines[0].id}`}
                        aria-pressed={provider === comfyEngines[0].id}
                        onClick={() => setProvider(comfyEngines[0].id)}
                        title={comfyEngines[0].hint}
                      >
                        {comfyEngines[0].label}
                      </button>
                    ) : null}
                  </div>
                  {comfyEngines.length > 1 ? (
                    <div
                      className="wb-segmented wb-segmented-engines"
                      role="group"
                      aria-label={t('create.more.enginesAria')}
                    >
                      {comfyEngines.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className="wb-segment"
                          data-testid={`cr-engine-${option.id}`}
                          aria-pressed={provider === option.id}
                          onClick={() => setProvider(option.id)}
                          title={option.hint}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="wb-field">
                  <span className="wb-label">{t('create.more.seed')}</span>
                  <input
                    className="wb-input"
                    inputMode="numeric"
                    placeholder={t('create.more.seedPlaceholder')}
                    value={seed}
                    onChange={(event) => setSeed(event.target.value.replace(/[^\d-]/g, ''))}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="cr-more-head">
            <button
              type="button"
              className="cr-more-toggle"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              {moreOpen ? t('create.more.collapse') : t('create.more.expand')}
            </button>
            <span className="wb-note">
              {aspectRatio} · {durationSec}s · {resolutionTier} ·{' '}
              {provider === CLOUD_PROVIDER ? t('common.scope.cloud') : t('common.scope.local')}
            </span>
          </div>
        </div>

        <div className="cr-mode-line">
          <span className="cr-mode-tag">
            {t('create.modeLine', { mode: t(MODE_KEYS[selection.mode]) })}
          </span>
          {ignoredHint === null ? null : <span className="wb-note">{ignoredHint}</span>}
          {pending ? <span className="wb-note">{t('create.modeLine.pending')}</span> : null}
        </div>

        <div className="cr-actions">
          <div className="wb-note">
            {needsKey ? (
              <>
                {t('create.needsKey')}{' '}
                <button type="button" className="cr-link" onClick={openByok}>
                  {t('create.needsKey.action')}
                </button>
              </>
            ) : (
              <>
                {costEstimate === null ? null : (
                  <span className="cr-cost" title={t('common.cost.title')}>
                    {t('create.cost.estimated', { amount: formatYuan(costEstimate.yuan) })}
                    {costEstimate.source === 'local-free'
                      ? t('common.cost.localFree')
                      : t('common.cost.estimateOnly')}
                    {costEstimate.fromPriceTable ? '' : t('common.cost.customTier')}
                    {' · '}
                  </span>
                )}
                {t('create.actions.note')}
              </>
            )}
          </div>
          <button
            type="button"
            className="wb-btn wb-btn-primary cr-submit"
            disabled={submitDisabled}
            onClick={() => void handleSubmit()}
          >
            {submitting ? t('create.submit.pending') : t('create.submit')}
          </button>
        </div>

        {uploadError === null ? null : (
          <div className="wb-uncertain cr-alert">
            <span className="wb-uncertain-title">{t('create.alert.uploadFailed')}</span>
            <span className="wb-uncertain-body">{uploadError}</span>
          </div>
        )}
        {poolError === null ? null : (
          <div className="wb-uncertain cr-alert">
            <span className="wb-uncertain-title">{t('create.alert.poolFailed')}</span>
            <span className="wb-uncertain-body">{poolError}</span>
          </div>
        )}
        {submitError === null ? null : (
          <div className="wb-uncertain cr-alert">
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
          <div className="wb-uncertain cr-alert">
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
                onClick={() => navigate('#/workbench')}
              >
                {t('create.task.toWorkbench')}
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
                <video className="cr-player" src={outputUrl} controls playsInline />
                <div className="cr-task-actions">
                  <a className="cr-link" href={outputUrl} download>
                    {t('create.task.download')}
                  </a>
                  <button
                    type="button"
                    className="cr-link"
                    onClick={() => navigate(`#/edit?task=${encodeURIComponent(task.taskId)}`)}
                  >
                    {t('create.task.toEditor')}
                  </button>
                  <button
                    type="button"
                    className="cr-link"
                    onClick={() => {
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
    </section>
  );
}
