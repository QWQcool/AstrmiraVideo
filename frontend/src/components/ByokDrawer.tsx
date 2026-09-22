import { useEffect, useState } from 'react';
import { LLM_CUSTOM_PRESET_ID, LLM_PRESETS } from '@astrmira/shared';
import { Eyebrow } from './Eyebrow';
import type { ByokConfig } from '../lib/byok';
import { applyLlmPreset, keyInputNotice } from '../lib/byok';

/**
 * BYOK 抽屉（CONTRACT §5 / 施工单 §7）。
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
}

export function ByokDrawer({
  config,
  persist,
  pageLocation,
  onSave,
  onClear,
  onClose,
}: ByokDrawerProps) {
  const [draft, setDraft] = useState<ByokConfig>(config);
  const [persistDraft, setPersistDraft] = useState<boolean>(persist);
  const [reveal, setReveal] = useState(false);
  const [revealLlm, setRevealLlm] = useState(false);

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const notice = keyInputNotice(pageLocation);
  const keyInputDisabled = notice !== null;

  return (
    <>
      <div className="wb-drawer-backdrop" onClick={onClose} role="presentation" />

      <aside className="wb-drawer" role="dialog" aria-modal="true" aria-label="BYOK 凭据设置">
        <div className="wb-drawer-head">
          <Eyebrow tone="gold">BYOK 凭据</Eyebrow>
          <button type="button" className="wb-btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="wb-drawer-body">
          <div className="wb-field">
            <span className="wb-label">服务端地址</span>
            <input
              className="wb-input wb-input-mono"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              spellCheck={false}
              placeholder="https://ark.cn-beijing.volces.com/api/v3"
            />
            <span className="wb-note">默认已填火山方舟；自建代理或兼容端点可改。</span>
          </div>

          <div className="wb-field">
            <div className="wb-field-head">
              <span className="wb-label">API Key</span>
              <button
                type="button"
                className="wb-btn"
                onClick={() => setReveal(!reveal)}
                disabled={keyInputDisabled}
              >
                {reveal ? '隐藏' : '显示'}
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
              placeholder={keyInputDisabled ? '当前环境禁止填写' : '粘贴你的 Key'}
            />
            {notice === null ? null : <span className="wb-warn">{notice}</span>}
            <span className="wb-note">
              仅经请求头 <code>X-Provider-Key</code> 传输，
              <strong>不进 URL、不进请求体、不进日志</strong>；服务端运行时使用，不落库、不回显。
            </span>
          </div>

          <div className="wb-field">
            <span className="wb-label">模型名</span>
            <input
              className="wb-input wb-input-mono"
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              spellCheck={false}
            />
          </div>

          {/* ── 文本轨（V2.0 扩写）────────────────────────────────────
              独立成段是刻意的：视频 Key 与文本 Key 往往不是同一家（方舟 vs OpenAI/DeepSeek），
              混在一起填会让人以为"填了视频 Key 就能扩写"。 */}
          <div className="wb-field">
            <div className="wb-field-head">
              <span className="wb-label">扩写模型（文本轨）</span>
              <button
                type="button"
                className="wb-btn"
                title="把上面视频轨的 Key 复制到文本轨（仅当两者是同一把 Key 时使用）"
                onClick={() => setDraft({ ...draft, llmKey: draft.key })}
                disabled={keyInputDisabled || draft.key.trim() === ''}
              >
                复用视频 Key
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
              <option value={LLM_CUSTOM_PRESET_ID}>自定义（自填地址与模型）</option>
            </select>
            <span className="wb-note">
              {LLM_PRESETS.find((preset) => preset.id === draft.llmPreset)?.note ??
                '自定义：需填完整的 baseUrl 与模型名；留空时服务端会明确报「未配置」，不会替你挑一个地址'}
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
              placeholder="模型名 / endpoint id"
            />

            <div className="wb-field-head">
              <span className="wb-label">扩写 API Key</span>
              <button
                type="button"
                className="wb-btn"
                onClick={() => setRevealLlm(!revealLlm)}
                disabled={keyInputDisabled}
              >
                {revealLlm ? '隐藏' : '显示'}
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
              placeholder={keyInputDisabled ? '当前环境禁止填写' : '粘贴你的 Key（可不填，那时 ✨ 会置灰）'}
            />
            <span className="wb-note">
              仅经请求头 <code>X-LLM-Key</code> 传输。本服务**不提供文本侧兜底 Key**（纯 BYOK）：
              没填就是"没配"，不会静默降级成规则改写。
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
              明文存储到本机（localStorage）
              <br />
              <span className="wb-warn">
                仅限个人信任设备：勾选后 Key 以明文留在浏览器中，任何人使用这台设备都能读到。
              </span>
            </span>
          </label>

          <span className="wb-note">
            不勾选时只存 sessionStorage —— 关闭标签页即失效，这是默认且推荐的用法。
          </span>
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
            清除本地凭据
          </button>
          <button
            type="button"
            className="wb-btn wb-btn-gold wb-btn-block"
            onClick={() => onSave(draft, persistDraft)}
            disabled={keyInputDisabled}
          >
            保存
          </button>
        </div>
      </aside>
    </>
  );
}
