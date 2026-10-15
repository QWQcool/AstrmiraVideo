import { useCallback, useState, type ReactElement } from 'react';
import type {
  AspectRatio,
  GenerationMode,
  ProviderStatus,
  ProviderType,
  SelfCheckResponse,
  TaskProgress,
} from '@astrmira/shared';
import { ApiError, fetchSelfCheck } from '../lib/api';
import {
  comfyUiEngineOptions,
  isComfyUiEngine,
  providerLabel,
  type EngineOption,
} from '../lib/engineOptions';
import { AssetDropZone } from './AssetDropZone';
import { Eyebrow } from './Eyebrow';
import type { AssetSlotKey, AssetSlots } from '../lib/assets';
import {
  DURATION_OPTIONS,
  RESOLUTION_TIERS,
  dialogueLength,
  resolveTargetSize,
  type ResolutionTier,
} from '../lib/format';

/**
 * 左栏控制台（PLAN §4 Step 3）。
 *
 * 三条容易被做错的细节：
 * 1. **✨ 扩写不可用时必须写明原因**（V2.0）：扩写真的实现了，唯一的"不可用"是
 *    没填文本轨 Key（纯 BYOK）。此时按钮置灰，但**同一屏内**给出 `enhanceNotice` ——
 *    "只置灰不解释"和"点了才说不能用"是一样的糟糕；
 * 2. **四种模式按钮恒可点**：素材没传就点不了模式，用户会被卡在
 *    "想选首尾帧 → 按钮灰着 → 不知道该先传图"的循环里；缺什么由提交按钮的禁用态 + 提示收口（批次 3-⑤）；
 * 3. **本地引擎按钮不置灰**：状态端点只陈述"本服务有没有配"，
 *    不替访客判断能不能用（CONTRACT §2 V1.8）；选了未配置的本地轨，提交时如实报 `PROVIDER_UNAVAILABLE`。
 */
export interface LeftPanelProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onEnhance: () => void;
  /**
   * 非 null 表示当前**不可用**，文案即原因（不得省略）。
   * V2.0 起扩写真的实现了，所以"不可用"只有一种原因：没填文字轨 Key（纯 BYOK）。
   */
  enhanceNotice: string | null;
  enhancing: boolean;

  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  /** 目标时长（秒）；受契约 `durationSec ≤ 10` 约束 */
  durationSec: number;
  onDurationChange: (value: number) => void;
  /** 清晰度档：决定目标渲染尺寸，并透传给上游 `--resolution` */
  resolutionTier: ResolutionTier;
  onResolutionTierChange: (tier: ResolutionTier) => void;
  mode: GenerationMode;
  onModeChange: (mode: GenerationMode) => void;

  provider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
  providerStatus: ProviderStatus | null;

  /** 三槽参考资产（首帧 / 尾帧 / 参考视频，与 CONTRACT §1 的 `assets` 字段一一对应） */
  assets: AssetSlots;
  /** 正在上传的槽（`null` = 无上传进行中）；单槽 spinner，避免三个槽一起转 */
  uploadingSlot: AssetSlotKey | null;
  uploadError: string | null;
  onAssetSelect: (slot: AssetSlotKey, file: File) => void;
  onAssetClear: (slot: AssetSlotKey) => void;
  /**
   * V2.6 / B37：可直接当 V2V 参考的候选（已出片的生成产物 + 剪辑产物）。
   * 选中即把该任务以 `task:<taskId>` 引用放进参考视频槽 —— 不再要求"先下载再上传"。
   */
  videoRefCandidates: TaskProgress[];
  onVideoRefTaskSelect: (taskId: string) => void;
  /** 当前模式缺少必需素材时的说明（非 null = 提交会被挡住，必须讲清缺哪一格） */
  assetRequirementHint: string | null;

  seed: string;
  onSeedChange: (value: string) => void;
  seedLocked: boolean;
  onSeedLockedChange: (locked: boolean) => void;

  byokSummary: string;
  onOpenByok: () => void;

  onSubmit: () => void;
  submitDisabled: boolean;
  submitLabel: string;
  /**
   * V2.12（台账 B48）：**提交前预估价**文案（如「预计花费 ¥2.484（预估）」）。
   * 由**视图**算好传进来（它才拿得到分辨率 / 时长 / 模型），本组件只负责显示 ——
   * 预估价必须与结算价同源（`estimateCostFromRequest`），所以不在组件里另算一套。
   * 可选：不传就是"不显示"（既有调用方与测试零改动）。
   */
  costHint?: string | null;
}

const PROVIDER_CLOUD: ProviderType = 'cloud-volcano-seedance';
// ⚠️ V2.37（D56）：本地 H3 那一档的常量已随该档撤掉一起删除（撤的是"点了才知道不行"的入口）。
// V2.36：ComfyUI 那一档**不是常量** —— 它可能有多台（`host-comfyui:<name>`），
// 名单由 `/status` 的 `comfyui.servers` 给出（见 lib/engineOptions.ts）。

/** 自检结果的错误文案（与各视图同一份口径：ApiError 带契约码） */
function describeError(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * 四种生成模式（CONTRACT §1 `GenerationMode`）。
 *
 * `requirement` 只说"需要哪格素材"，**不用它禁用按钮** —— 素材还没上传就点不了模式，
 * 用户会被卡在"想选首尾帧 → 按钮灰着 → 不知道该先传图"的循环里。
 * 因此按钮恒可点，缺素材时由下方的提示与提交按钮的禁用态收口。
 */
const MODE_OPTIONS: ReadonlyArray<{
  value: GenerationMode;
  label: string;
  title: string;
  requirement: string;
}> = [
  { value: 't2v', label: '文生视频', title: '仅凭文字描述生成', requirement: '不需要参考素材' },
  {
    value: 'i2v',
    label: '图生视频',
    title: '以参考首帧为起点生成',
    requirement: '需要「参考首帧」',
  },
  {
    value: 'fl2v',
    label: '首尾帧',
    title: '给定首帧与尾帧，由模型补出中间运动',
    requirement: '需要「参考首帧 + 参考尾帧」',
  },
  {
    value: 'v2v',
    label: '视频参考',
    title: '以参考视频做风格 / 动作迁移',
    requirement: '需要「参考视频」',
  },
];

export function LeftPanel(props: LeftPanelProps) {
  const {
    prompt,
    onPromptChange,
    onEnhance,
    enhanceNotice,
    enhancing,
    aspectRatio,
    onAspectRatioChange,
    durationSec,
    onDurationChange,
    resolutionTier,
    onResolutionTierChange,
    mode,
    onModeChange,
    provider,
    onProviderChange,
    providerStatus,
    assets,
    uploadingSlot,
    uploadError,
    onAssetSelect,
    onAssetClear,
    videoRefCandidates,
    onVideoRefTaskSelect,
    assetRequirementHint,
    seed,
    onSeedChange,
    seedLocked,
    onSeedLockedChange,
    byokSummary,
    onOpenByok,
    onSubmit,
    submitDisabled,
    costHint,
    submitLabel,
  } = props;

  const isCloud = provider === PROVIDER_CLOUD;
  /**
   * 当前选中的引擎在**本服务这边**是否已配置好（只影响提示文案与"推荐配置"，**不置灰按钮**）。
   *
   * 两个本地档各有自己的状态（H3 / ComfyUI）—— V2.31 起必须分开看：
   * 用 `local.available` 去判断 ComfyUI 会出现"选了 ComfyUI 但提示写的是 H3 的配置"。
   */
  /**
   * V2.36：ComfyUI 可能是**多台实例**（`host-comfyui:<name>`，§19-1）——
   * 判分支必须用 `isComfyUiEngine`：写成 `=== 'host-comfyui'` 会让"选了具名实例"的用户
   * 看到 H3 那一档的配置提示（V2.31 修过一次同类问题）。
   */
  const comfyEngines = comfyUiEngineOptions(providerStatus);
  const selectedComfyEngine = comfyEngines.find((item) => item.id === provider);

  const engineConfigured =
    isCloud ||
    (isComfyUiEngine(provider)
      ? (selectedComfyEngine?.configured ?? providerStatus?.comfyui.available === true)
      // 其余情况（当前只可能是**已撤掉的 H3 档**或未知 id）→ 视为"没配"：
      // V2.37（D56）起 `local` 段恒为 `available:false`，这里不再去读它。
      : false);

  /**
   * 一台 ComfyUI 实例的按钮。
   *
   * 单台与多台两种布局**共用这一份渲染**（免得两处的 title / testid / 选中态各写一遍而漂移）。
   * 状态只影响文案（`hint`）与下方的"推荐配置"提示，**不置灰按钮** —— §2 V1.8：
   * 状态端点只陈述"本服务配没配"，不替访客判断能不能用。
   */
  const renderComfyEngineButton = (option: EngineOption): ReactElement => (
    <button
      key={option.id}
      type="button"
      className="wb-segment"
      data-testid={`wb-engine-${option.id}`}
      aria-pressed={provider === option.id}
      onClick={() => onProviderChange(option.id)}
      title={option.hint}
    >
      {option.label}
    </button>
  );

  /**
   * V2.34（台账 B4 / CONTRACT §20）：**本地引擎运行时自检**的结果。
   *
   * 它与 `providerStatus` 的区别要一直记住：状态说"你**配了没有**"（读 env 就能答，快），
   * 自检说"**刚才通不通**"（真的去连一次 ComfyUI，慢几秒）。所以它**只在点击时**请求，
   * 绝不放在渲染路径上 —— 否则每次改一个字都会去连一次用户的 ComfyUI。
   */
  const [selfCheck, setSelfCheck] = useState<SelfCheckResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [selfCheckError, setSelfCheckError] = useState<string | null>(null);

  const runSelfCheck = useCallback(async (): Promise<void> => {
    setChecking(true);
    setSelfCheckError(null);
    try {
      setSelfCheck(await fetchSelfCheck());
    } catch (caught) {
      // 端点本身几乎不会失败（逐项 try/catch → 总 200）；走到这里通常是服务断了
      setSelfCheckError(describeError(caught));
    } finally {
      setChecking(false);
    }
  }, []);
  const target = resolveTargetSize(aspectRatio, resolutionTier);
  const dialogue = dialogueLength(prompt);

  return (
    <section className="wb-panel">
      <Eyebrow index={1} tone="gold" as="h2">
        创作输入
      </Eyebrow>

      <div className="wb-field">
        <div className="wb-field-head">
          <span className="wb-label">提示词</span>
          <button
            type="button"
            className="wb-btn wb-btn-gold"
            onClick={onEnhance}
            disabled={enhancing || enhanceNotice !== null}
            title={enhanceNotice ?? '用模型把提示词写得更完整'}
          >
            {enhancing ? '扩写中…' : '✨ 扩写'}
          </button>
        </div>

        <textarea
          className="wb-textarea"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          rows={5}
          placeholder="镜头运动、主体动作、氛围；对白写在引号里，例如：她笑着说“我们终于成功了！”"
        />

        <div className="wb-field-head">
          <span className="wb-note">
            对白引号内 {dialogue} 字（5 秒镜头建议 ≤ 20 字）
          </span>
          <span className="wb-counter">{prompt.length} 字符</span>
        </div>

        {enhanceNotice === null ? null : <span className="wb-note">{enhanceNotice}</span>}
      </div>

      {/* 参考素材：**按模式渲染槽位**，不做"三个槽永远都摆着"——
          v2v 用户看到两个跟自己无关的图片槽只会困惑该往哪儿放。
          注意 t2v 仍显示首帧槽：它是进入图生视频的入口（上传后自动切换模式）。 */}
      {mode === 'v2v' ? null : (
        <AssetDropZone
          label="参考首帧"
          hint={
            mode === 't2v'
              ? '可选：上传后会切到「图生视频」；仅文生视频可直接忽略此槽'
              : '必需：作为首帧（起点画面）。⚠️ 含真人 / 拟真人脸的图会被上游隐私检测拒绝 —— 可换非人物素材，或改用文生视频'
          }
          kind="image"
          aspectRatio={aspectRatio}
          asset={assets.firstFrame}
          uploading={uploadingSlot === 'firstFrame'}
          error={uploadingSlot === null ? uploadError : null}
          onSelect={(file) => onAssetSelect('firstFrame', file)}
          onClear={() => onAssetClear('firstFrame')}
        />
      )}

      {mode === 'fl2v' ? (
        <AssetDropZone
          label="参考尾帧"
          hint="必需：作为尾帧（终点画面）；与首帧一起交给上游补中间运动。⚠️ 含真人 / 拟真人脸的图会被上游隐私检测拒绝"
          kind="image"
          aspectRatio={aspectRatio}
          asset={assets.lastFrame}
          uploading={uploadingSlot === 'lastFrame'}
          error={uploadingSlot === null ? uploadError : null}
          onSelect={(file) => onAssetSelect('lastFrame', file)}
          onClear={() => onAssetClear('lastFrame')}
        />
      ) : null}

      {mode === 'v2v' ? (
        <>
          <AssetDropZone
            label="参考视频"
            hint="必需：作为风格 / 动作迁移的参考（mp4 / mov）"
            kind="video"
            aspectRatio={aspectRatio}
            asset={assets.referenceVideo}
            uploading={uploadingSlot === 'referenceVideo'}
            error={uploadingSlot === null ? uploadError : null}
            onSelect={(file) => onAssetSelect('referenceVideo', file)}
            onClear={() => onAssetClear('referenceVideo')}
          />
          {videoRefCandidates.length === 0 ? null : (
            <select
              className="wb-input wb-tref-pick"
              value=""
              aria-label="从成片库选择参考视频"
              onChange={(event) => {
                if (event.target.value !== '') onVideoRefTaskSelect(event.target.value);
              }}
            >
              <option value="">或直接从已有成片 / 剪辑产物选…</option>
              {videoRefCandidates.map((item) => (
                <option key={item.taskId} value={item.taskId}>
                  {item.origin?.kind === 'edit' ? '✂ 剪辑产物 · ' : ''}
                  {item.taskId.slice(0, 8)} · {item.requestSnapshot.prompt.slice(0, 16)}
                </option>
              ))}
            </select>
          )}
        </>
      ) : null}

      <div className="wb-field">
        <span className="wb-label">生成模式</span>
        <div className="wb-segmented">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="wb-segment"
              aria-pressed={mode === option.value}
              onClick={() => onModeChange(option.value)}
              title={`${option.title}（${option.requirement}）`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="wb-note">
          {MODE_OPTIONS.find((option) => option.value === mode)?.requirement}
          {mode === 'fl2v' || mode === 'v2v' ? '；该模式的上游字段接受度待真实冒烟核对' : ''}
        </span>
      </div>

      <div className="wb-field">
        <div className="wb-field-head">
          <span className="wb-label">画幅</span>
          <span className="wb-note">
            渲染为 {target.width}×{target.height}
          </span>
        </div>
        <div className="wb-segmented">
          <button
            type="button"
            className="wb-segment"
            aria-pressed={aspectRatio === '16:9'}
            onClick={() => onAspectRatioChange('16:9')}
          >
            16:9
          </button>
          <button
            type="button"
            className="wb-segment"
            aria-pressed={aspectRatio === '9:16'}
            onClick={() => onAspectRatioChange('9:16')}
          >
            9:16
          </button>
          <button
            type="button"
            className="wb-segment"
            aria-pressed={aspectRatio === '1:1'}
            onClick={() => onAspectRatioChange('1:1')}
            disabled={!isCloud}
            title={isCloud ? undefined : '方画幅仅云端引擎支持'}
          >
            1:1
          </button>
        </div>
      </div>

      <div className="wb-field">
        <div className="wb-field-head">
          <span className="wb-label">时长</span>
          <span className="wb-note">单段上限 10 秒（公网部署防线，CONTRACT §1）</span>
        </div>
        <div className="wb-segmented">
          {DURATION_OPTIONS.map((seconds) => (
            <button
              key={seconds}
              type="button"
              className="wb-segment"
              aria-pressed={durationSec === seconds}
              onClick={() => onDurationChange(seconds)}
            >
              {seconds}s
            </button>
          ))}
        </div>
      </div>

      <div className="wb-field">
        <div className="wb-field-head">
          <span className="wb-label">清晰度</span>
          <span className="wb-note">透传上游 `--resolution`；目标尺寸随之变化</span>
        </div>
        <div className="wb-segmented">
          {RESOLUTION_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              className="wb-segment"
              aria-pressed={resolutionTier === tier}
              onClick={() => onResolutionTierChange(tier)}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-field">
        <span className="wb-label">执行引擎</span>
        <div className="wb-segmented">
          <button
            type="button"
            className="wb-segment"
            aria-pressed={isCloud}
            onClick={() => onProviderChange(PROVIDER_CLOUD)}
          >
            云端 Seedance
          </button>
          {/* ⚠️ V2.37（D56）：「本地 MiniMax H3」这一档**已撤掉** ——
              这里曾经有一个**永远不可用**的按钮（点了才知道不行，提交必 503），
              那正是本仓最反感的一种形态。本地轨现在只有 ComfyUI（下面那组，可能有多台）。 */}
          {/* V2.31（A1 片 C / D53）：用户自备的 ComfyUI —— 引擎与模型都由用户装，我们只对接接口（§19）。
              V2.36：它可能是**多台**（§19-1）—— 名单来自 `/status` 的 `comfyui.servers`（前端不维护第二份，
              否则必然与服务端漂移）。只有一台时仍渲染在这一行（观感与 V2.35 一致）；多台时另起一行（见下）。 */}
          {comfyEngines.length === 1 && comfyEngines[0] !== undefined
            ? renderComfyEngineButton(comfyEngines[0])
            : null}
        </div>
        {comfyEngines.length > 1 ? (
          <div
            className="wb-segmented wb-segmented-engines"
            role="group"
            aria-label="本地 ComfyUI 实例"
          >
            {comfyEngines.map((option) => renderComfyEngineButton(option))}
          </div>
        ) : null}
        <span className="wb-note" data-testid="wb-panel-engine-note">
          {isCloud
            ? byokSummary
            : isComfyUiEngine(provider)
              ? (selectedComfyEngine?.hint ??
                providerStatus?.comfyui.reason ??
                '本地 ComfyUI 状态未知')
              : (providerStatus?.local.reason ?? '本地引擎状态未知')}
        </span>

        {/* V2.34（台账 B4 / CONTRACT §20）：**检测本地引擎** ——
            它要回答的正是"配完 env、重启之后到底成没成"这个问题；
            在此之前用户只能靠提交一条任务去试错（而失败还可能是别的原因，混在一起更难判）。 */}
        <button
          type="button"
          className="wb-btn"
          data-testid="wb-selfcheck"
          disabled={checking}
          title={
            checking
              ? '正在连一次本地引擎（ComfyUI 的模型清单较大，通常一两秒）'
              : '真的去连一次本机 / 内网的引擎，如实报告能不能跑、能跑哪些模式'
          }
          onClick={() => {
            void runSelfCheck();
          }}
        >
          {checking ? '🔍 检测中…' : '🔍 检测本地引擎'}
        </button>

        {selfCheckError === null ? null : (
          <span className="wb-note cv-plan-bad" data-testid="wb-selfcheck-error">
            检测失败：{selfCheckError}
          </span>
        )}

        {selfCheck === null ? null : (
          <div className="wb-note" data-testid="wb-selfcheck-result">
            {selfCheck.entries.map((entry) => (
              <div key={entry.provider} data-testid={`wb-selfcheck-${entry.provider}`}>
                <strong className={entry.available ? 'cv-plan-ok' : 'cv-plan-bad'}>
                  {entry.available ? '✓' : '✗'}
                </strong>{' '}
                {/* V2.36：逐实例自检 —— 名字走同一份显示名口径（`host-comfyui:office` → 「ComfyUI · …」） */}
                {providerLabel(entry.provider, providerStatus)}：{entry.reason ?? '可用'}
              </div>
            ))}
            <div>
              （{new Date(selfCheck.checkedAt).toLocaleTimeString()} 检测 ——
              它反映的是<strong>此刻</strong>能不能连上，与上面那行"配没配"是两件事）
            </div>
          </div>
        )}

        {/* AC2：本地轨不可用时给出**推荐配置说明**，但开关本身**保持可选、不置灰** ——
            状态端点只陈述"本服务有没有配"，不替访客判断能不能用（CONTRACT §2 V1.8）。 */}
        {engineConfigured ? null : (
          <span className="wb-note">
            推荐配置（可选）：本服务自身配置 ComfyUI 后重启即可开放，需在服务端设置
            <code> COMFYUI_BASE_URL </code>（已运行的 ComfyUI 地址，仅回环 / 内网；
            多台用 <code>COMFYUI_SERVERS_FILE</code>），再置 <code>EXPOSE_HOST_LOCAL_TRACK=1</code>。
            在此之前选择本地轨提交，会如实返回 <code>PROVIDER_UNAVAILABLE</code>。
          </span>
        )}

        {/* V2.0：抽屉里现在有**两条轨**的凭据（视频 + 文本扩写），
            所以入口不再挂在"云端 Seedance"分支下 —— 选本地轨的访客同样需要填扩写 Key */}
        <button type="button" className="wb-btn" onClick={onOpenByok}>
          凭据设置（BYOK）
        </button>
      </div>

      <div className="wb-field">
        <div className="wb-field-head">
          <span className="wb-label">Seed</span>
          <label className="wb-checkbox">
            <input
              type="checkbox"
              checked={seedLocked}
              onChange={(event) => onSeedLockedChange(event.target.checked)}
            />
            <span>锁定复现</span>
          </label>
        </div>
        <input
          className="wb-input wb-input-mono"
          value={seed}
          onChange={(event) => onSeedChange(event.target.value)}
          disabled={!seedLocked}
          inputMode="numeric"
          placeholder={seedLocked ? '填写整数种子' : '未锁定：每次随机'}
        />
        <span className="wb-note">
          锁定后同种子同参数可复现；云端不锁定时由服务商侧随机。
        </span>
      </div>

      {/* 缺素材时按钮是灰的 —— 原因必须同时写在按钮上方，否则用户只能靠猜 */}
      {assetRequirementHint === null ? null : (
        <span className="wb-warn">{assetRequirementHint}</span>
      )}

      {/* V2.12（B48）：提交前预估价（用户点生成之前就该看到要花多少钱） */}
      {costHint === null || costHint === undefined ? null : (
        <span className="wb-note cr-cost" title="按公开价目与上游计费式估算；实际以方舟账单为准">
          {costHint}
        </span>
      )}

      <button
        type="button"
        className="wb-btn wb-btn-primary wb-btn-block"
        onClick={onSubmit}
        disabled={submitDisabled}
      >
        {submitLabel}
      </button>
    </section>
  );
}
