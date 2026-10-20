import type { AspectRatio } from '@astrmira/shared';
import type { ResolutionTier } from '../lib/format';
import { DURATION_OPTIONS, RESOLUTION_TIERS, resolveImageSize } from '../lib/format';
import { useTranslate } from '../lib/i18n';

export interface EngineOption {
  id: string;
  label: string;
  hint?: string;
}

export interface ComposerBarProps {
  /** 图片态不显示"时长"与"模型名"：t2i 没有时长，模型由本地模板决定 */
  kind: 'video' | 'image';
  aspectRatio: AspectRatio;
  resolutionTier: ResolutionTier;
  durationSec: number;
  engines: EngineOption[];
  provider: string;
  /** 已选模型的可读名（来自 BYOK / 能力目录）；没有就显示"默认" */
  modelLabel?: string;
  /** 预估费用文案；null = 待核算 / 不适用 */
  priceText: string | null;
  submitDisabled: boolean;
  submitting: boolean;
  onAspectChange(next: AspectRatio): void;
  onResolutionChange(next: ResolutionTier): void;
  onDurationChange(next: number): void;
  onProviderChange(next: string): void;
  onOpenMentions(): void;
  onSubmit(): void;
  advancedOpen: boolean;
  onToggleAdvanced(): void;
}

/**
 * 输入框底部的参数行（Step 11-S2；对齐实测产品的"一行参数 + 右侧价格与提交"）。
 *
 * 为什么平铺而不是收进"更多设置"：参数是**每次生成都要确认**的东西（多少钱、多长、什么画质），
 * 藏起来只会让人反复展开；真正低频的项（种子）留在 advanced。
 */
export function ComposerBar({
  kind,
  aspectRatio,
  resolutionTier,
  durationSec,
  engines,
  provider,
  modelLabel,
  priceText,
  submitDisabled,
  submitting,
  onAspectChange,
  onResolutionChange,
  onDurationChange,
  onProviderChange,
  onOpenMentions,
  onSubmit,
  advancedOpen,
  onToggleAdvanced,
}: ComposerBarProps) {
  const t = useTranslate();
  const imageSize = kind === 'image' ? resolveImageSize(aspectRatio) : null;

  return (
    <div className="cr-params">
      <div className="cr-params-left">
        <label className="cr-params-field">
          <select
            className="cr-params-select"
            aria-label={t('create.more.aspect')}
            value={aspectRatio}
            onChange={(event) => onAspectChange(event.target.value as AspectRatio)}
          >
            {(['16:9', '9:16', '1:1'] as const).map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </label>

        {kind === 'image' ? (
          <span className="cr-params-static" aria-label={t('create.more.resolution')}>
            {imageSize?.width}×{imageSize?.height}
          </span>
        ) : (
          <label className="cr-params-field">
            <select
              className="cr-params-select"
              aria-label={t('create.more.resolution')}
              value={resolutionTier}
              onChange={(event) => onResolutionChange(event.target.value as ResolutionTier)}
            >
              {RESOLUTION_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === 'video' ? (
          <label className="cr-params-field">
            <select
              className="cr-params-select"
              aria-label={t('create.more.duration')}
              value={durationSec}
              onChange={(event) => onDurationChange(Number(event.target.value))}
            >
              {DURATION_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}s
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="cr-params-field cr-params-field--engine">
          <select
            className="cr-params-select"
            aria-label={t('create.more.engine')}
            value={provider}
            onChange={(event) => onProviderChange(event.target.value)}
          >
            <option value="cloud-volcano-seedance">{t('common.engine.cloud')}</option>
            {engines.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.label}
              </option>
            ))}
          </select>
        </label>

        {/* 图片态不显示模型名：真正用哪个模板由服务端能力目录决定，写一个名字反而会骗人 */}
        {kind === 'image' || modelLabel === undefined ? null : (
          <span className="cr-params-model">{modelLabel}</span>
        )}

        <button
          type="button"
          className="cr-params-icon"
          aria-label={t('create.hint.mention')}
          title={t('create.hint.mention')}
          onClick={onOpenMentions}
        >
          @
        </button>

        <button
          type="button"
          className="cr-params-link"
          aria-expanded={advancedOpen}
          onClick={onToggleAdvanced}
        >
          {advancedOpen ? t('create.more.collapse') : t('create.more.expand')}
        </button>
      </div>

      <div className="cr-params-right">
        {priceText === null ? null : (
          <span className="cr-params-price" title={t('common.cost.title')}>
            {priceText}
          </span>
        )}
        <button
          type="button"
          className="wb-btn wb-btn-primary cr-submit"
          disabled={submitDisabled}
          onClick={onSubmit}
        >
          {submitting ? t('common.submit.pending') : t('create.submit')}
        </button>
      </div>
    </div>
  );
}
