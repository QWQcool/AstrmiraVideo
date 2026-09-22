import type {
  AspectRatio,
  GenerationMode,
  ProviderStatus,
  ProviderType,
} from '@astrmira/shared';
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
 * 左栏控制台（施工单 §7）。
 *
 * 两条容易被做错的细节：
 * 1. **✨ 扩写不得静默不可点**：demo 版服务端恒返回 501，所以按钮保持可点，
 *    点击时把"为什么不能用 + 去哪看"讲清楚（`enhanceNotice` 由上层注入）；
 * 2. **本地引擎按钮不置灰**：状态端点只陈述"本服务有没有配"，
 *    不替访客判断能不能用（CONTRACT §2 V1.8）；选了未配置的本地轨，提交时如实报 `PROVIDER_UNAVAILABLE`。
 */
export interface LeftPanelProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  onEnhance: () => void;
  /** 非 null 表示当前不可用，文案即原因（不得省略） */
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
}

const PROVIDER_CLOUD: ProviderType = 'cloud-volcano-seedance';
const PROVIDER_LOCAL: ProviderType = 'local-minimax-h3';

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
    assetRequirementHint,
    seed,
    onSeedChange,
    seedLocked,
    onSeedLockedChange,
    byokSummary,
    onOpenByok,
    onSubmit,
    submitDisabled,
    submitLabel,
  } = props;

  const isCloud = provider === PROVIDER_CLOUD;
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
            disabled={enhancing}
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
              : '必需：作为首帧（起点画面）'
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
          hint="必需：作为尾帧（终点画面）；与首帧一起交给上游补中间运动"
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
          <button
            type="button"
            className="wb-segment"
            aria-pressed={!isCloud}
            onClick={() => onProviderChange(PROVIDER_LOCAL)}
            title={
              providerStatus?.local.available === true
                ? '使用本服务已配置的本地引擎'
                : '本服务未配置本地引擎；仍可选择，提交时会返回 PROVIDER_UNAVAILABLE'
            }
          >
            本地 MiniMax H3
          </button>
        </div>
        <span className="wb-note">
          {isCloud
            ? byokSummary
            : providerStatus?.local.reason ?? '本地引擎状态未知'}
        </span>

        {/* AC2：本地轨不可用时给出**推荐配置说明**，但开关本身**保持可选、不置灰** ——
            状态端点只陈述"本服务有没有配"，不替访客判断能不能用（CONTRACT §2 V1.8）。 */}
        {isCloud || providerStatus?.local.available === true ? null : (
          <span className="wb-note">
            推荐配置（可选）：本服务自身配置本地引擎后重启即可开放，需在服务端设置
            <code> H3_WORKDIR </code>（本地推理工作目录）或
            <code> COMFYUI_BASE_URL </code>（已运行的 ComfyUI 地址，仅回环 / 内网），
            再置 <code>EXPOSE_HOST_LOCAL_TRACK=1</code>。
            在此之前选择本地轨提交，会如实返回 <code>PROVIDER_UNAVAILABLE</code>。
          </span>
        )}

        {isCloud ? (
          <button type="button" className="wb-btn" onClick={onOpenByok}>
            配置云端凭据（BYOK）
          </button>
        ) : null}
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
