import { useMemo, useState } from 'react';
import type { AgentPlanUsage, CanvasDoc } from '@astrmira/shared';
import { askCanvasAgent } from '../lib/api';
import { resolveLlmConfig, resolveLlmKey } from '../lib/byok';
import {
  buildCanvasAgentContext,
  canvasAgentContextSummary,
} from '../lib/canvasAgentContext';
import { useTranslate } from '../lib/i18n';
import { useShell } from '../lib/shell';

interface CanvasAgentMessage {
  role: 'user' | 'assistant';
  text: string;
  model?: string;
  usage?: AgentPlanUsage;
}

export interface CanvasAgentPanelProps {
  doc: CanvasDoc;
  selectedNodeId?: string;
  onClose(): void;
}

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * S7-D1：只读画布助手。
 *
 * 它只把 `CanvasDoc` 派生快照发给 `/api/agent/canvas`，拿到文本回答；
 * 这里**没有任何 apply / create / delete** 路径。写操作不是“提示词要求模型不要做”，
 * 而是根本没有对应函数可调用。
 */
export function CanvasAgentPanel({ doc, selectedNodeId, onClose }: CanvasAgentPanelProps) {
  const t = useTranslate();
  const { byok, openByok } = useShell();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<CanvasAgentMessage[]>([]);

  const context = useMemo(
    () => buildCanvasAgentContext(doc, selectedNodeId),
    [doc, selectedNodeId],
  );
  const summary = useMemo(() => canvasAgentContextSummary(context), [context]);

  const submit = async (): Promise<void> => {
    const question = message.trim();
    if (question === '' || busy) return;
    const apiKey = resolveLlmKey(byok);
    if (apiKey === undefined) {
      setError(t('canvas.agent.noKey'));
      openByok();
      return;
    }
    setMessage('');
    setError(null);
    setBusy(true);
    setHistory((prev) => [...prev, { role: 'user', text: question }]);
    try {
      const result = await askCanvasAgent(
        {
          question,
          canvas: context,
          llm: resolveLlmConfig(byok),
        },
        { llmKey: apiKey },
      );
      setHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: result.answer,
          model: result.model,
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        },
      ]);
    } catch (caught) {
      setError(t('canvas.agent.failed', { reason: errorText(caught) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="cs-agent-panel" data-testid="canvas-agent-panel" aria-label={t('canvas.agent.title')}>
      <header className="cs-agent-head">
        <div>
          <h3 className="cs-agent-title">{t('canvas.agent.title')}</h3>
          <p className="wb-note cs-agent-context" data-testid="canvas-agent-context">
            {t('canvas.agent.context', {
              nodes: summary.nodes,
              edges: summary.edges,
              outputs: summary.outputs,
            })}
            {summary.truncated ? ` · ${t('canvas.agent.truncated')}` : ''}
          </p>
        </div>
        <button
          type="button"
          className="wb-btn cs-icon-btn"
          data-testid="canvas-agent-close"
          aria-label={t('canvas.agent.close')}
          title={t('canvas.agent.close')}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <p className="wb-note cs-agent-readonly">{t('canvas.agent.readOnly')}</p>

      <div className="cs-agent-log" data-testid="canvas-agent-log" aria-live="polite">
        {history.length === 0 ? <p className="wb-note">{t('canvas.agent.empty')}</p> : null}
        {history.map((item, index) => (
          <div key={`${item.role}-${index}`} className={`cs-agent-msg cs-agent-msg--${item.role}`}>
            <span className="cs-agent-role">
              {item.role === 'user' ? t('canvas.agent.you') : t('canvas.agent.title')}
            </span>
            <p>{item.text}</p>
            {item.model === undefined ? null : (
              <span className="wb-note cs-agent-meta">
                {item.model}
                {item.usage === undefined
                  ? ''
                  : ` · ${t('canvas.agent.usage', {
                      prompt: item.usage.promptTokens,
                      completion: item.usage.completionTokens,
                    })}`}
              </span>
            )}
          </div>
        ))}
        {busy ? <p className="wb-note">{t('canvas.agent.thinking')}</p> : null}
      </div>

      {error === null ? null : (
        <p className="wb-alert cs-agent-error" role="alert">
          {error}
        </p>
      )}

      <form
        className="cs-agent-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          className="cs-agent-input"
          data-testid="canvas-agent-input"
          aria-label={t('canvas.agent.placeholder')}
          placeholder={t('canvas.agent.placeholder')}
          rows={3}
          value={message}
          maxLength={2000}
          disabled={busy}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="submit"
          className="wb-btn wb-btn-primary"
          data-testid="canvas-agent-send"
          disabled={busy || message.trim() === ''}
        >
          {t('canvas.agent.send')}
        </button>
      </form>
    </aside>
  );
}
