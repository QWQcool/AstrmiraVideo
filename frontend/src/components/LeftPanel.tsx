import type {
  AspectRatio,
  GenerationMode,
  ProviderStatus,
  ProviderType,
} from '@astrmira/shared';
import { AssetDropZone } from './AssetDropZone';
import { Eyebrow } from './Eyebrow';
import type { AssetState } from '../lib/assets';
import { dialogueLength, resolveTargetSize } from '../lib/format';

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
  mode: GenerationMode;
  onModeChange: (mode: GenerationMode) => void;

  provider: ProviderType;
  onProviderChange: (provider: ProviderType) => void;
  providerStatus: ProviderStatus | null;

  asset: AssetState | null;
  uploading: boolean;
  uploadError: string | null;
  onAssetSelect: (file: File) => void;
  onAssetClear: () => void;

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

export function LeftPanel(props: LeftPanelProps) {
  const {
    prompt,
    onPromptChange,
    onEnhance,
    enhanceNotice,
    enhancing,
    aspectRatio,
    onAspectRatioChange,
    mode,
    onModeChange,
    provider,
    onProviderChange,
    providerStatus,
    asset,
    uploading,
    uploadError,
    onAssetSelect,
    onAssetClear,
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
  const target = resolveTargetSize(aspectRatio);
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

      <AssetDropZone
        aspectRatio={aspectRatio}
        asset={asset}
        uploading={uploading}
        error={uploadError}
        onSelect={onAssetSelect}
        onClear={onAssetClear}
      />

      <div className="wb-field">
        <span className="wb-label">生成模式</span>
        <div className="wb-segmented">
          <button
            type="button"
            className="wb-segment"
            aria-pressed={mode === 't2v'}
            onClick={() => onModeChange('t2v')}
          >
            文生视频
          </button>
          <button
            type="button"
            className="wb-segment"
            aria-pressed={mode === 'i2v'}
            onClick={() => onModeChange('i2v')}
            disabled={asset === null}
            title={asset === null ? '先上传参考首帧' : '以首帧为起点生成'}
          >
            图生视频
          </button>
        </div>
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
