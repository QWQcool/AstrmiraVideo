import { useEffect, useState } from 'react';
import { Eyebrow } from './Eyebrow';
import type { ByokConfig } from '../lib/byok';
import { keyInputNotice } from '../lib/byok';

/**
 * BYOK 抽屉（CONTRACT §5 / 施工单 §7）。
 *
 * 三条要贴在用户脸上的事实：
 * 1. Key **只**经请求头传给本服务，服务端**只用不存**（不落库、不写日志、不回显）；
 * 2. 浏览器侧默认只存**本次会话**（关标签页即失效），要落本机必须显式勾选并看到明文警示；
 * 3. 公网明文（http 且非回环）下**禁止填写** —— 明文传输等于公开（PLAN §9-2 红线）。
 *
 * 该组件**只在打开时挂载**（父组件控制），因此内部 state 以 props 初始化即可，无需同步 effect。
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
              setDraft({ ...draft, key: '' });
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
