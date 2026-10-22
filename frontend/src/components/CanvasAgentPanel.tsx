import { useMemo, useState } from 'react';
import type { AgentPlanUsage, CanvasDoc, CanvasNodeProposal } from '@astrmira/shared';
import { askCanvasAgent, proposeCanvasTextNode } from '../lib/api';
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
  /** 由“自由发挥”产生的建议；可显式再转成结构化方案。 */
  freeform?: boolean;
}

export interface CanvasAgentPanelProps {
  doc: CanvasDoc;
  selectedNodeId?: string;
  /** 用户点击“创建节点”后才调用；返回 false 表示当前文档不可写。 */
  onCreateText(proposal: CanvasNodeProposal): boolean;
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
export function CanvasAgentPanel({
  doc,
  selectedNodeId,
  onCreateText,
  onClose,
}: CanvasAgentPanelProps) {
  const t = useTranslate();
  const { byok, openByok } = useShell();
  const [mode, setMode] = useState<'ask' | 'create'>('ask');
  /** 创建模式默认走严格 schema；关闭后只拿自由文本建议，不能直接落节点。 */
  const [structured, setStructured] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CanvasNodeProposal | null>(null);
  const [proposalMeta, setProposalMeta] = useState<{
    model: string;
    usage?: AgentPlanUsage;
  } | null>(null);
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
    setProposal(null);
    setProposalMeta(null);
    setHistory((prev) => [...prev, { role: 'user', text: question }]);
    try {
      if (mode === 'create' && structured) {
        const result = await proposeCanvasTextNode(
          {
            instruction: question,
            canvas: context,
            llm: resolveLlmConfig(byok),
          },
          { llmKey: apiKey },
        );
        setProposal(result.proposal);
        setProposalMeta({
          model: result.model,
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        });
      } else {
        const freeformQuestion =
          mode === 'create'
            ? t('canvas.agent.freeformPrompt', { instruction: question })
            : question;
        const result = await askCanvasAgent(
          {
            question: freeformQuestion,
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
            ...(mode === 'create' ? { freeform: true } : {}),
          },
        ]);
      }
    } catch (caught) {
      setError(t('canvas.agent.failed', { reason: errorText(caught) }));
    } finally {
      setBusy(false);
    }
  };

  /** S7-D4：自由发挥转结构化必须由用户显式点击；不自动解析、不自动写画布。 */
  const structureFreeform = async (suggestion: string): Promise<void> => {
    if (busy) return;
    const apiKey = resolveLlmKey(byok);
    if (apiKey === undefined) {
      setError(t('canvas.agent.noKey'));
      openByok();
      return;
    }
    setBusy(true);
    setError(null);
    setProposal(null);
    setProposalMeta(null);
    try {
      const result = await proposeCanvasTextNode(
        {
          instruction: t('canvas.agent.freeformToPlanPrompt', {
            suggestion: suggestion.trim().slice(0, 1800),
          }),
          canvas: context,
          llm: resolveLlmConfig(byok),
        },
        { llmKey: apiKey },
      );
      setProposal(result.proposal);
      setProposalMeta({
        model: result.model,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      });
    } catch (caught) {
      setError(t('canvas.agent.failed', { reason: errorText(caught) }));
    } finally {
      setBusy(false);
    }
  };

  const confirmProposal = (): void => {
    if (proposal === null) return;
    if (!onCreateText(proposal)) {
      setError(t('canvas.agent.createFailed'));
      return;
    }
    setHistory((prev) => [
      ...prev,
      { role: 'assistant', text: t('canvas.agent.created', { title: proposal.title }) },
    ]);
    setProposal(null);
    setProposalMeta(null);
    setError(null);
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

      <div className="cs-agent-modes" role="group" aria-label={t('canvas.agent.title')}>
        <button
          type="button"
          className="cs-agent-mode"
          data-testid="canvas-agent-mode-ask"
          aria-pressed={mode === 'ask'}
          onClick={() => {
            setMode('ask');
            setProposal(null);
            setProposalMeta(null);
            setError(null);
          }}
        >
          {t('canvas.agent.modeAsk')}
        </button>
        <button
          type="button"
          className="cs-agent-mode"
          data-testid="canvas-agent-mode-create"
          aria-pressed={mode === 'create'}
          onClick={() => {
            setMode('create');
            setProposal(null);
            setProposalMeta(null);
            setError(null);
          }}
        >
          {t('canvas.agent.modeCreate')}
        </button>
      </div>

      {mode === 'create' ? (
        <label className="cs-agent-structure-toggle">
          <input
            type="checkbox"
            data-testid="canvas-agent-structured"
            checked={structured}
            onChange={(event) => {
              setStructured(event.target.checked);
              setProposal(null);
              setProposalMeta(null);
              setError(null);
            }}
          />
          <span>{t('canvas.agent.structured')}</span>
          <span className="wb-note">{t('canvas.agent.structuredHint')}</span>
        </label>
      ) : null}

      <p className="wb-note cs-agent-readonly">
        {mode === 'create'
          ? structured
            ? t('canvas.agent.createHint')
            : t('canvas.agent.freeformHint')
          : t('canvas.agent.readOnly')}
      </p>

      <div className="cs-agent-log" data-testid="canvas-agent-log" aria-live="polite">
        {history.length === 0 ? <p className="wb-note">{t('canvas.agent.empty')}</p> : null}
        {history.map((item, index) => (
          <div key={`${item.role}-${index}`} className={`cs-agent-msg cs-agent-msg--${item.role}`}>
            <span className="cs-agent-role">
              {item.role === 'user' ? t('canvas.agent.you') : t('canvas.agent.title')}
            </span>
            <p>{item.text}</p>
            {item.freeform === true ? (
              <button
                type="button"
                className="wb-btn cs-agent-convert"
                data-testid="canvas-freeform-to-structured"
                disabled={busy}
                onClick={() => void structureFreeform(item.text)}
              >
                {t('canvas.agent.convertToPlan')}
              </button>
            ) : null}
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
        {proposal === null ? null : (
          <section className="cs-agent-proposal" data-testid="canvas-node-proposal">
            <h4 className="cs-agent-proposal-title">{t('canvas.agent.proposalTitle')}</h4>
            <strong>{proposal.title}</strong>
            <p>{proposal.content}</p>
            {proposal.reason === undefined ? null : (
              <p className="wb-note">{proposal.reason}</p>
            )}
            {proposal.warnings.map((warning) => (
              <p className="wb-note cs-agent-proposal-warning" key={warning}>
                {warning}
              </p>
            ))}
            <p className="wb-note">{t('canvas.agent.proposalNote')}</p>
            {proposalMeta === null ? null : (
              <span className="wb-note cs-agent-meta">
                {proposalMeta.model}
                {proposalMeta.usage === undefined
                  ? ''
                  : ` · ${t('canvas.agent.usage', {
                      prompt: proposalMeta.usage.promptTokens,
                      completion: proposalMeta.usage.completionTokens,
                    })}`}
              </span>
            )}
            <div className="cs-agent-proposal-actions">
              <button
                type="button"
                className="wb-btn"
                data-testid="canvas-node-proposal-cancel"
                onClick={() => {
                  setProposal(null);
                  setProposalMeta(null);
                }}
              >
                {t('canvas.agent.cancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                data-testid="canvas-node-proposal-confirm"
                onClick={confirmProposal}
              >
                {t('canvas.agent.confirmCreate')}
              </button>
            </div>
          </section>
        )}
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
          aria-label={
            mode === 'create'
              ? t('canvas.agent.createPlaceholder')
              : t('canvas.agent.placeholder')
          }
          placeholder={
            mode === 'create'
              ? t('canvas.agent.createPlaceholder')
              : t('canvas.agent.placeholder')
          }
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
          {mode === 'create'
            ? structured
              ? t('canvas.agent.propose')
              : t('canvas.agent.freeform')
            : t('canvas.agent.send')}
        </button>
      </form>
    </aside>
  );
}
