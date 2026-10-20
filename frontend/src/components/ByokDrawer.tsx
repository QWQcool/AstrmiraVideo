import { useState } from 'react';
import { useDialogFocus } from '../lib/dialogFocus';
import {
  LLM_CUSTOM_PRESET_ID,
  LLM_PRESETS,
  VIDEO_CUSTOM_MODEL_ID,
  VIDEO_MODEL_PRESETS,
} from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import type { ByokConfig } from '../lib/byok';
import { applyLlmPreset, applyVideoPreset, keyInputNotice, videoPresetSelection } from '../lib/byok';
import { useTranslate } from '../lib/i18n';

/**
 * BYOK 抽屉（CONTRACT §5 / PLAN §4 Step 3）。
 *
 * 要贴在用户脸上的事实：
 * 1. Key **只**经请求头传给本服务，服务端**只用不存**（不落库、不写日志、不回显）；
 * 2. 浏览器侧默认只存**本次会话**（关标签页即失效），要落本机必须显式勾选并看到明文警示；
 * 3. 公网明文（http 且非回环）下**禁止填写** —— 明文传输等于公开（PLAN §9-2 红线）；
 * 4. V2.0：**文本轨与视频轨是两套凭据**（视频 = 方舟，文本 = 任意 OpenAI 兼容端点），
 *    因此分两段填写；文本段提供「复用视频 Key」一键按钮，但字段本身独立。
 */
export interface ByokDrawerProps {
  config: ByokConfig;
  persist: boolean;
  /** 当前页面位置（用于 HTTPS 守卫） */
  pageLocation: { protocol: string; hostname: string };
  onSave: (config: ByokConfig, persist: boolean) => void;
  onClear: () => void;
  onClose: () => void;
  /**
   * 「测试连接」（V2.1，CONTRACT §9）：提交前零费用核对 Key 与模型。
   * 校验用的是**当前草稿**（未保存的值也测），否则用户得"先存再测"两步走。
   */
  onVerify: (track: 'video' | 'text', draft: ByokConfig) => Promise<string>;
}

export function ByokDrawer({
  config,
  persist,
  pageLocation,
  onSave,
  onClear,
  onClose,
  onVerify,
}: ByokDrawerProps) {
  const [draft, setDraft] = useState<ByokConfig>(config);
  const [persistDraft, setPersistDraft] = useState<boolean>(persist);
  const [reveal, setReveal] = useState(false);
  const [revealLlm, setRevealLlm] = useState(false);
  /** 两条轨各自的"测试连接"结果（null = 还没测过） */
  const [verifyResult, setVerifyResult] = useState<{ video: string | null; text: string | null }>({
    video: null,
    text: null,
  });
  const t = useTranslate();
  const [verifying, setVerifying] = useState<'video' | 'text' | null>(null);

  async function runVerify(track: 'video' | 'text'): Promise<void> {
    setVerifying(track);
    setVerifyResult((previous) => ({ ...previous, [track]: t('byok.verify.running') }));
    try {
      const message = await onVerify(track, draft);
      setVerifyResult((previous) => ({ ...previous, [track]: message }));
    } finally {
      setVerifying(null);
    }
  }

  // 抽屉只在打开时挂载；焦点移入/Tab 循环/Esc/回焦与 modalLayer 由 hook 统一处理
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);

  const notice = keyInputNotice(pageLocation);
  const keyInputDisabled = notice !== null;

  return (
    <>
      <div className="wb-drawer-backdrop" onClick={onClose} role="presentation" />

      <aside
        ref={dialogRef}
        className="wb-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={t('byok.aria')}
      >
        <div className="wb-drawer-head">
          <Eyebrow tone="gold">{t('byok.title')}</Eyebrow>
          <button type="button" className="wb-btn" onClick={onClose}>
            {t('byok.close')}
          </button>
        </div>

        <div className="wb-drawer-body">
          <div className="wb-field">
            <span className="wb-label">{t('byok.baseUrl.label')}</span>
            <input
              className="wb-input wb-input-mono"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              spellCheck={false}
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
            />
            <span className="wb-note">{t('byok.baseUrl.note')}</span>
          </div>

          <div className="wb-field">
            <div className="wb-field-head">
              <span className="wb-label">{t('byok.key.label')}</span>
              <button
                type="button"
                className="wb-btn"
                onClick={() => setReveal(!reveal)}
                disabled={keyInputDisabled}
              >
                {reveal ? t('byok.key.hide') : t('byok.key.show')}
              </button>
            </div>
            <input
              className="wb-input wb-input-mono"
              type={reveal ? 'text' : 'password'}
              value={draft.key}
              onChange={(event) => setDraft({ ...draft, key: event.target.value })}
              disabled={keyInputDisabled}
              spellCheck={false}
              autoComplete="off"
              placeholder={
                keyInputDisabled ? t('byok.key.placeholderDisabled') : t('byok.key.placeholder')
              }
            />
            {notice === null ? null : <span className="wb-warn">{notice}</span>}
            <span className="wb-note">
              {t('byok.key.transport.before')}
              <code>X-Provider-Key</code>
              {t('byok.key.transport.mid')}
              <strong>{t('byok.key.transport.emphasis')}</strong>
              {t('byok.key.transport.after')}
            </span>
          </div>

          {/* 模型档位（V2.1）：手打模型 id 曾直接导致一次线上 404，故改为"下拉选档 + 自定义填写" */}
          <div className="wb-field">
            <span className="wb-label">{t('byok.model.label')}</span>
            <select
              className="wb-input"
              value={videoPresetSelection(draft)}
              onChange={(event) => setDraft(applyVideoPreset(draft, event.target.value))}
            >
              {VIDEO_MODEL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value={VIDEO_CUSTOM_MODEL_ID}>{t('byok.model.custom')}</option>
            </select>
            <span className="wb-note">
              {VIDEO_MODEL_PRESETS.find((preset) => preset.id === draft.model)?.note ??
                t('byok.model.customNote')}
            </span>
            <input
              className="wb-input wb-input-mono"
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              spellCheck={false}
              placeholder="doubao-seedance-… / ep-…"
            />
            <div className="wb-field-head">
              <button
                type="button"
                className="wb-btn"
                onClick={() => void runVerify('video')}
                disabled={verifying !== null}
              >
                {verifying === 'video' ? t('byok.verify.running') : t('byok.verify.test')}
              </button>
              <span className="wb-note">{t('byok.verify.videoNote')}</span>
            </div>
            {verifyResult.video === null ? null : (
              <span className="wb-note wb-verify-result">{verifyResult.video}</span>
            )}
          </div>

          {/* ── 文本轨（V2.0 扩写）────────────────────────────────────
              独立成段是刻意的：视频 Key 与文本 Key 往往不是同一家（方舟 vs OpenAI/DeepSeek），
              混在一起填会让人以为"填了视频 Key 就能扩写"。 */}
          <div className="wb-field">
            <div className="wb-field-head">
              <span className="wb-label">{t('byok.llm.label')}</span>
              <button
                type="button"
                className="wb-btn"
                title={t('byok.llm.reuseTitle')}
                onClick={() => setDraft({ ...draft, llmKey: draft.key })}
                disabled={keyInputDisabled || draft.key.trim() === ''}
              >
                {t('byok.llm.reuse')}
              </button>
            </div>
            <select
              className="wb-input"
              value={draft.llmPreset}
              onChange={(event) => setDraft(applyLlmPreset(draft, event.target.value))}
            >
              {LLM_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value={LLM_CUSTOM_PRESET_ID}>{t('byok.llm.custom')}</option>
            </select>
            <span className="wb-note">
              {LLM_PRESETS.find((preset) => preset.id === draft.llmPreset)?.note ??
                t('byok.llm.customNote')}
            </span>

            <input
              className="wb-input wb-input-mono"
              value={draft.llmBaseUrl}
              onChange={(event) => setDraft({ ...draft, llmBaseUrl: event.target.value })}
              spellCheck={false}
              placeholder="https://api.example.com/v1"
            />
            <input
              className="wb-input wb-input-mono"
              value={draft.llmModel}
              onChange={(event) => setDraft({ ...draft, llmModel: event.target.value })}
              spellCheck={false}
              placeholder={t('byok.llm.modelPlaceholder')}
            />

            <div className="wb-field-head">
              <span className="wb-label">{t('byok.llm.keyLabel')}</span>
              <button
                type="button"
                className="wb-btn"
                onClick={() => setRevealLlm(!revealLlm)}
                disabled={keyInputDisabled}
              >
                {revealLlm ? t('byok.key.hide') : t('byok.key.show')}
              </button>
            </div>
            <input
              className="wb-input wb-input-mono"
              type={revealLlm ? 'text' : 'password'}
              value={draft.llmKey}
              onChange={(event) => setDraft({ ...draft, llmKey: event.target.value })}
              disabled={keyInputDisabled}
              spellCheck={false}
              autoComplete="off"
              placeholder={
                keyInputDisabled
                  ? t('byok.key.placeholderDisabled')
                  : t('byok.llm.keyPlaceholder')
              }
            />
            <div className="wb-field-head">
              <button
                type="button"
                className="wb-btn"
                onClick={() => void runVerify('text')}
                disabled={verifying !== null}
              >
                {verifying === 'text' ? t('byok.verify.running') : t('byok.verify.test')}
              </button>
              <span className="wb-note">{t('byok.llm.verifyNote')}</span>
            </div>
            {verifyResult.text === null ? null : (
              <span className="wb-note wb-verify-result">{verifyResult.text}</span>
            )}

            <span className="wb-note">
              {t('byok.llm.transport.before')}
              <code>X-LLM-Key</code>
              {t('byok.llm.transport.after')}
            </span>
          </div>

          <label className="wb-checkbox">
            <input
              type="checkbox"
              checked={persistDraft}
              onChange={(event) => setPersistDraft(event.target.checked)}
              disabled={keyInputDisabled}
            />
            <span>
              {t('byok.persist.label')}
              <br />
              <span className="wb-warn">{t('byok.persist.warn')}</span>
            </span>
          </label>

          <span className="wb-note">{t('byok.persist.note')}</span>
        </div>

        <div className="wb-drawer-foot">
          <button
            type="button"
            className="wb-btn"
            onClick={() => {
              onClear();
              // 两把 Key 一起清：只清视频轨会留下"看着已清除、其实文本 Key 还在"的假象
              setDraft({ ...draft, key: '', llmKey: '' });
              setPersistDraft(false);
            }}
          >
            {t('byok.clear')}
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-gold wb-btn-block"
            onClick={() => onSave(draft, persistDraft)}
            disabled={keyInputDisabled}
          >
            {t('byok.save')}
          </button>
        </div>
      </aside>
    </>
  );
}
