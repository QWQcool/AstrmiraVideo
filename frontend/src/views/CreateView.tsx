import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AspectRatio,
  AssetListEntry,
  GenerationMode,
  ProviderType,
  TaskProgress,
  VideoGenerateRequest,
} from '@astrmira/shared';
import { RECIPE_CARDS } from '@astrmira/shared';
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
import {
  assetsForRefs,
  hasPendingRef,
  ignoredMentionHint,
  selectMentions,
  type MentionRef,
} from '../lib/mentions';
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
const LOCAL_PROVIDER: ProviderType = 'local-minimax-h3';

const MODE_LABELS: Record<GenerationMode, string> = {
  t2v: '文生视频',
  i2v: '图生视频',
  fl2v: '首尾帧',
  v2v: '视频参考',
};

const STATUS_TEXT: Record<TaskProgress['status'], string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
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

/** 资产 → chip 引用 */
function refFromAsset(asset: AssetListEntry): MentionRef {
  return {
    id: newIdempotencyKey(),
    ref: asset.assetId,
    kind: asset.kind,
    previewUrl: asset.kind === 'image' ? asset.url : null,
    label: `${asset.kind === 'image' ? '图' : '视频'}·${asset.assetId.slice(0, 6)}`,
  };
}

export function CreateView() {
  const { byok, providerStatus, openByok } = useShell();

  // ── 意图与素材 ──
  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState<MentionRef[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');

  // ── 素材池（`@` 弹层的候选：资产库 + 成片/剪辑产物）──
  const [assetPool, setAssetPool] = useState<AssetListEntry[]>([]);
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

  // ── 提交与内联任务卡 ──
  const [taskId, setTaskId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reloadPools = useCallback(async (): Promise<void> => {
    try {
      const [assets, generated, edits] = await Promise.all([
        fetchAssets(),
        fetchHistory(),
        fetchHistory({ kind: 'edit' }),
      ]);
      setAssetPool(assets.assets);
      setTaskPool(
        [...generated.items, ...edits.items]
          .filter((item) => item.status === 'succeeded' && item.outputVideoUrl !== undefined)
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)),
      );
      setPoolError(null);
    } catch (caught) {
      setPoolError(describeError(caught));
    }
  }, []);

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
      const eligible = files
        .filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
        .slice(0, 4);
      if (eligible.length === 0) return;
      setUploadError(null);

      for (const file of eligible) {
        const id = newIdempotencyKey();
        const kind = file.type.startsWith('video/') ? ('video' as const) : ('image' as const);
        const objectUrl = URL.createObjectURL(file);
        objectUrls.current.push(objectUrl);
        setRefs((prev) => [...prev, { id, ref: '', kind, previewUrl: objectUrl, label: file.name }]);
        setUploadingCount((count) => count + 1);

        uploadAssets([file])
          .then((result) => {
            const asset = result.assets[0];
            if (asset === undefined) throw new Error('上传未返回任何资产');
            setRefs((prev) =>
              prev.map((item) =>
                item.id === id ? { ...item, ref: asset.assetId, kind: asset.kind } : item,
              ),
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
    [reloadPools],
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

  const filteredTasks = useMemo(() => {
    const keyword = mentionFilter.trim().toLowerCase();
    if (keyword === '') return taskPool.slice(0, 8);
    return taskPool
      .filter(
        (item) =>
          item.requestSnapshot.prompt.toLowerCase().includes(keyword) ||
          item.taskId.toLowerCase().includes(keyword),
      )
      .slice(0, 8);
  }, [taskPool, mentionFilter]);

  const filteredAssets = useMemo(() => {
    const keyword = mentionFilter.trim().toLowerCase();
    if (keyword === '') return assetPool.slice(0, 8);
    return assetPool.filter((item) => item.assetId.toLowerCase().includes(keyword)).slice(0, 8);
  }, [assetPool, mentionFilter]);

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
    if (firstAsset !== undefined) addRef(refFromAsset(firstAsset));
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
          <p className="cr-eyebrow">创作 · 一句话开场</p>
          <h2 className="cr-title">描述你想要的画面</h2>
          <p className="cr-sub">
            写一句话，或拖入一张图 / 一段视频；用 <code>@</code> 引用历史成片（含剪辑产物）当参考。
          </p>
        </header>

        <div className="cr-panel">
          <textarea
            className="cr-input"
            rows={3}
            placeholder="例如：雨夜街头，女孩撑伞回头微笑着说：我们终于成功了。电影感光影"
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
              ＠ 引用素材 / 成片
            </button>
            <span className="wb-note">或在框里直接输入 @；也可以把图 / 视频拖进来、直接粘贴</span>
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
                    {item.ref === '' ? '上传中…' : (item.label ?? item.ref.slice(0, 10))}
                  </span>
                  <button
                    type="button"
                    className="cr-chip-remove"
                    aria-label="移除素材"
                    onClick={() => removeRef(item.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {mentionOpen ? (
            <div className="cr-mention" role="listbox" aria-label="选择素材">
              <input
                className="wb-input cr-mention-search"
                placeholder="搜素材 / 成片…（Enter 选第一条，Esc 关闭）"
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
                  <p className="wb-note cr-mention-empty">
                    没有匹配的素材。可以把图/视频直接拖进来上传，或先去工作台生成一条成片。
                  </p>
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
                      {item.origin?.kind === 'edit' ? '✂ 剪辑产物 · ' : '成片 · '}
                      {item.requestSnapshot.prompt.slice(0, 18)}
                    </span>
                  </button>
                ))}
                {filteredAssets.map((item) => (
                  <button
                    key={item.assetId}
                    type="button"
                    className="cr-mention-item"
                    onClick={() => addRef(refFromAsset(item))}
                  >
                    {item.kind === 'image' ? (
                      <img className="cr-mention-thumb" src={item.url} alt="" />
                    ) : (
                      <span className="cr-mention-glyph">🎬</span>
                    )}
                    <span className="cr-mention-label">
                      资产 · {item.kind === 'image' ? '图片' : '视频'} · {item.assetId.slice(0, 8)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="cr-recipes" aria-label="配方快捷">
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
              全部配方 →
            </button>
          </div>

          {moreOpen ? (
            <div className="cr-more">
              <div className="cr-more-grid">
                <div className="wb-field">
                  <span className="wb-label">画幅</span>
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
                  <span className="wb-label">时长</span>
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
                  <span className="wb-label">清晰度</span>
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
                  <span className="wb-label">引擎</span>
                  <div className="wb-segmented">
                    <button
                      type="button"
                      className="wb-segment"
                      aria-pressed={provider === CLOUD_PROVIDER}
                      onClick={() => setProvider(CLOUD_PROVIDER)}
                    >
                      云端 Seedance
                    </button>
                    <button
                      type="button"
                      className="wb-segment"
                      aria-pressed={provider === LOCAL_PROVIDER}
                      onClick={() => setProvider(LOCAL_PROVIDER)}
                    >
                      本地 H3
                    </button>
                  </div>
                </div>
                <div className="wb-field">
                  <span className="wb-label">seed（留空随机）</span>
                  <input
                    className="wb-input"
                    inputMode="numeric"
                    placeholder="如 42"
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
              {moreOpen ? '收起设置 ▲' : '更多设置 ▼'}
            </button>
            <span className="wb-note">
              {aspectRatio} · {durationSec}s · {resolutionTier} ·{' '}
              {provider === CLOUD_PROVIDER ? '云端' : '本地'}
            </span>
          </div>
        </div>

        <div className="cr-mode-line">
          <span className="cr-mode-tag">将按「{MODE_LABELS[selection.mode]}」生成</span>
          {ignoredHint === null ? null : <span className="wb-note">{ignoredHint}</span>}
          {pending ? <span className="wb-note">素材上传中，完成后即可提交。</span> : null}
        </div>

        <div className="cr-actions">
          <div className="wb-note">
            {needsKey ? (
              <>
                未配置 Key 且服务端无兜底：{' '}
                <button type="button" className="cr-link" onClick={openByok}>
                  去填写凭据
                </button>
              </>
            ) : (
              '提交后停留在本页，进度与成片会出现在下方。'
            )}
          </div>
          <button
            type="button"
            className="wb-btn wb-btn-primary cr-submit"
            disabled={submitDisabled}
            onClick={() => void handleSubmit()}
          >
            {submitting ? '提交中…' : '✦ 生成'}
          </button>
        </div>

        {uploadError === null ? null : (
          <div className="wb-uncertain cr-alert">
            <span className="wb-uncertain-title">素材上传未成功</span>
            <span className="wb-uncertain-body">{uploadError}</span>
          </div>
        )}
        {poolError === null ? null : (
          <div className="wb-uncertain cr-alert">
            <span className="wb-uncertain-title">素材库读取失败</span>
            <span className="wb-uncertain-body">{poolError}</span>
          </div>
        )}
        {submitError === null ? null : (
          <div className="wb-uncertain cr-alert">
            <span className="wb-uncertain-title">提交未成功</span>
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
            <span className="wb-uncertain-title">任务状态读取失败</span>
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
                {STATUS_TEXT[task.status]}
              </span>
              <span className="wb-note">
                任务 {task.taskId.slice(0, 8)} · {task.requestSnapshot.prompt.slice(0, 24)}
              </span>
              <button
                type="button"
                className="cr-link"
                onClick={() => navigate('#/workbench')}
              >
                去专业模式查看
              </button>
            </div>

            {task.status === 'failed' ? (
              <p className="wb-note cr-task-error">
                {task.error === undefined
                  ? '任务失败（详情见操作日志）'
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
                    ⤓ 下载 MP4
                  </a>
                  <button
                    type="button"
                    className="cr-link"
                    onClick={() => navigate(`#/edit?task=${encodeURIComponent(task.taskId)}`)}
                  >
                    ✂ 送剪辑台
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
                    ↺ 再来一条
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
