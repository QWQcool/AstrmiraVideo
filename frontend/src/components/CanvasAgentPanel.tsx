import { useMemo, useState } from 'react';
import {
  STORYBOARD_SESSION_MAX_SHOTS,
  type AgentPlanUsage,
  type CanvasDoc,
  type CanvasNodeProposal,
  type CanvasTextNodeUpdateProposal,
  type StoryboardExpansion,
  type StoryboardPlan,
} from '@astrmira/shared';
import {
  askCanvasAgent,
  createStoryboard,
  expandStoryboard,
  proposeCanvasTextNode,
  proposeCanvasTextNodeUpdate,
} from '../lib/api';
import { resolveLlmConfig, resolveLlmKey } from '../lib/byok';
import {
  buildCanvasAgentContext,
  canvasAgentContextSummary,
  canvasAgentSelectedSummary,
} from '../lib/canvasAgentContext';
import { collectLandingReferences } from '../lib/storyboardLanding';
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
  /** 用户点击“确认修改”后才调用；目标失效时返回 false。 */
  onUpdateText(proposal: CanvasTextNodeUpdateProposal): boolean;
  /** S8-A2b：用户在展开卡点击“创建镜头草稿”后才调用；返回 false 表示当前文档不可写。 */
  onLandStoryboard(expansion: StoryboardExpansion): boolean;
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
  onUpdateText,
  onLandStoryboard,
  onClose,
}: CanvasAgentPanelProps) {
  const t = useTranslate();
  const { byok, openByok } = useShell();
  const [mode, setMode] = useState<'ask' | 'create' | 'update' | 'storyboard'>('ask');
  /** 创建模式默认走严格 schema；关闭后只拿自由文本建议，不能直接落节点。 */
  const [structured, setStructured] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CanvasNodeProposal | null>(null);
  const [updateProposal, setUpdateProposal] = useState<CanvasTextNodeUpdateProposal | null>(
    null,
  );
  const [storyboard, setStoryboard] = useState<StoryboardPlan | null>(null);
  /** S8-A2：分镜展开结果（每镜生成参数）；确认后才由视图落节点。 */
  const [expansion, setExpansion] = useState<StoryboardExpansion | null>(null);
  const [expansionBusy, setExpansionBusy] = useState(false);
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
  const selected = useMemo(
    () => canvasAgentSelectedSummary(doc, selectedNodeId),
    [doc, selectedNodeId],
  );
  const canUpdate = selected !== null && selected.type === 'text';
  const selectedUpstream =
    selected === null || selected.upstream.length === 0
      ? t('canvas.agent.none')
      : selected.upstream.map((item) => item.title).join('、');
  const selectedDownstream =
    selected === null || selected.downstream.length === 0
      ? t('canvas.agent.none')
      : selected.downstream.map((item) => item.title).join('、');

  const submit = async (): Promise<void> => {
    const question = message.trim();
    if (question === '' || busy) return;
    if (mode === 'update' && (selected === null || !canUpdate)) {
      setError(t('canvas.agent.selectTextHint'));
      return;
    }
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
    setUpdateProposal(null);
    setStoryboard(null);
    setExpansion(null);
    setProposalMeta(null);
    setHistory((prev) => [...prev, { role: 'user', text: question }]);
    try {
      if (mode === 'storyboard') {
        const result = await createStoryboard(
          {
            instruction: question,
            canvas: context,
            llm: resolveLlmConfig(byok),
          },
          { llmKey: apiKey },
        );
        setStoryboard(result.plan);
        setProposalMeta({
          model: result.model,
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        });
      } else if (mode === 'update' && selected !== null) {
        const result = await proposeCanvasTextNodeUpdate(
          {
            instruction: question,
            canvas: context,
            targetNodeId: selected.id,
            llm: resolveLlmConfig(byok),
          },
          { llmKey: apiKey },
        );
        setUpdateProposal(result.proposal);
        setProposalMeta({
          model: result.model,
          ...(result.usage === undefined ? {} : { usage: result.usage }),
        });
      } else if (mode === 'create' && structured) {
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

  /**
   * S8-A2：把确认过的分镜表展开成每镜生成参数（第二次文本调用，用户点击才发起）。
   * 参考图候选 = 当前画布上上传/资产库来源的图片节点产物；展开结果只进预览卡，
   * 落节点必须再点一次「创建镜头草稿」。
   */
  const expand = async (): Promise<void> => {
    if (storyboard === null || busy || expansionBusy) return;
    const apiKey = resolveLlmKey(byok);
    if (apiKey === undefined) {
      setError(t('canvas.agent.noKey'));
      openByok();
      return;
    }
    setExpansionBusy(true);
    setError(null);
    try {
      const result = await expandStoryboard(
        {
          plan: storyboard,
          references: collectLandingReferences(doc),
          llm: resolveLlmConfig(byok),
        },
        { llmKey: apiKey },
      );
      setExpansion(result.plan);
      setProposalMeta({
        model: result.model,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      });
    } catch (caught) {
      setError(t('canvas.agent.storyboard.expandFailed', { reason: errorText(caught) }));
    } finally {
      setExpansionBusy(false);
    }
  };

  /** S8-A2b：确认落地。失败（文档不可写）时保留预览卡，让用户处理后再试。 */
  const confirmLanding = (): void => {
    if (expansion === null) return;
    if (!onLandStoryboard(expansion)) {
      setError(t('canvas.agent.storyboard.landingBlocked'));
      return;
    }
    setStoryboard(null);
    setExpansion(null);
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
    setUpdateProposal(null);
    setStoryboard(null);
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

  const confirmUpdate = (): void => {
    if (updateProposal === null) return;
    if (!onUpdateText(updateProposal)) {
      setError(t('canvas.agent.updateFailed'));
      return;
    }
    setHistory((prev) => [
      ...prev,
      {
        role: 'assistant',
        text: t('canvas.agent.updated', { title: updateProposal.title }),
      },
    ]);
    setUpdateProposal(null);
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
            setUpdateProposal(null);
            setStoryboard(null);
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
            setUpdateProposal(null);
            setStoryboard(null);
            setProposalMeta(null);
            setError(null);
          }}
        >
          {t('canvas.agent.modeCreate')}
        </button>
        <button
          type="button"
          className="cs-agent-mode"
          data-testid="canvas-agent-mode-update"
          aria-pressed={mode === 'update'}
          disabled={!canUpdate}
          title={canUpdate ? t('canvas.agent.modeUpdate') : t('canvas.agent.selectTextHint')}
          onClick={() => {
            setMode('update');
            setProposal(null);
            setUpdateProposal(null);
            setStoryboard(null);
            setProposalMeta(null);
            setError(null);
          }}
        >
          {t('canvas.agent.modeUpdate')}
        </button>
        <button
          type="button"
          className="cs-agent-mode"
          data-testid="canvas-agent-mode-storyboard"
          aria-pressed={mode === 'storyboard'}
          onClick={() => {
            setMode('storyboard');
            setProposal(null);
            setUpdateProposal(null);
            setStoryboard(null);
            setProposalMeta(null);
            setError(null);
          }}
        >
          {t('canvas.agent.modeStoryboard')}
        </button>
      </div>

      <section className="cs-agent-selection" data-testid="canvas-agent-selection">
        <span className="cs-agent-selection-title">{t('canvas.agent.selectionTitle')}</span>
        {selected === null ? (
          <p className="wb-note">{t('canvas.agent.selectionEmpty')}</p>
        ) : (
          <>
            <strong>{selected.title}</strong>
            <p className="wb-note">
              {t('canvas.agent.selectionMeta', {
                type: selected.type,
                batches: selected.batchCount,
                outputs: selected.outputKinds.length,
                references: selected.referenceCount,
              })}
            </p>
            <p className="wb-note">
              {t('canvas.agent.selectionUpstream', { titles: selectedUpstream })}
            </p>
            <p className="wb-note">
              {t('canvas.agent.selectionDownstream', { titles: selectedDownstream })}
            </p>
          </>
        )}
      </section>

      {mode === 'create' ? (
        <label className="cs-agent-structure-toggle">
          <input
            type="checkbox"
            data-testid="canvas-agent-structured"
            checked={structured}
            onChange={(event) => {
              setStructured(event.target.checked);
              setProposal(null);
              setUpdateProposal(null);
              setStoryboard(null);
              setProposalMeta(null);
              setError(null);
            }}
          />
          <span>{t('canvas.agent.structured')}</span>
          <span className="wb-note">{t('canvas.agent.structuredHint')}</span>
        </label>
      ) : null}

      <p className="wb-note cs-agent-readonly">
        {mode === 'storyboard'
          ? t('canvas.agent.storyboardModeHint')
          : mode === 'update'
            ? canUpdate
              ? t('canvas.agent.updateHint')
              : t('canvas.agent.selectTextHint')
            : mode === 'create'
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
        {storyboard === null ? null : (
          <section className="cs-agent-storyboard" data-testid="canvas-storyboard">
            <div className="cs-agent-storyboard-head">
              <div>
                <h4 className="cs-agent-proposal-title">{t('canvas.agent.storyboardTitle')}</h4>
                <strong>{storyboard.title}</strong>
                <p className="wb-note">
                  {t('canvas.agent.storyboardMeta', {
                    aspect: storyboard.aspectRatio,
                    duration: storyboard.durationSec,
                    shots: storyboard.shots.length,
                  })}
                </p>
              </div>
              <button
                type="button"
                className="wb-btn lib-icon"
                aria-label={t('canvas.agent.storyboardClose')}
                onClick={() => setStoryboard(null)}
              >
                ✕
              </button>
            </div>
            <div className="cs-agent-storyboard-scroll">
              <table className="cs-agent-storyboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('canvas.agent.storyboard.time')}</th>
                    <th>{t('canvas.agent.storyboard.shot')}</th>
                    <th>{t('canvas.agent.storyboard.visual')}</th>
                  </tr>
                </thead>
                <tbody>
                  {storyboard.shots.map((shot) => (
                    <tr key={`${shot.index}-${shot.time}`}>
                      <td>{shot.index}</td>
                      <td>{shot.time}</td>
                      <td>
                        {shot.shotSize}
                        <br />
                        <span className="wb-note">{shot.camera}</span>
                      </td>
                      <td>
                        {shot.visual}
                        {shot.transition === undefined ? null : (
                          <span className="wb-note"> · {shot.transition}</span>
                        )}
                        {shot.audio === undefined ? null : (
                          <span className="wb-note"> · {shot.audio}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {storyboard.openQuestions.length === 0 ? null : (
              <div className="cs-agent-storyboard-notes">
                <span className="wb-note">{t('canvas.agent.storyboard.questions')}</span>
                <ul>
                  {storyboard.openQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            )}
            {storyboard.warnings.map((warning) => (
              <p className="wb-note cs-agent-proposal-warning" key={warning}>
                {warning}
              </p>
            ))}
            <p className="wb-note">{t('canvas.agent.storyboardHint')}</p>
            {storyboard.shots.length > STORYBOARD_SESSION_MAX_SHOTS ? (
              <p className="wb-note cs-agent-proposal-warning" data-testid="canvas-storyboard-over-limit">
                {t('canvas.agent.storyboard.overLimit', {
                  count: storyboard.shots.length,
                  max: STORYBOARD_SESSION_MAX_SHOTS,
                })}
              </p>
            ) : (
              <button
                type="button"
                className="wb-btn cs-agent-primary"
                data-testid="canvas-storyboard-expand"
                disabled={expansionBusy}
                onClick={() => {
                  void expand();
                }}
              >
                {expansionBusy
                  ? t('canvas.agent.storyboard.expandBusy')
                  : t('canvas.agent.storyboard.toShots')}
              </button>
            )}
            {expansion === null ? null : (
              <div className="cs-agent-storyboard-notes" data-testid="canvas-storyboard-expansion">
                <span className="wb-note">{t('canvas.agent.storyboard.expansionTitle')}</span>
                <ul>
                  {expansion.shots.map((shot) => (
                    <li key={shot.index}>
                      <strong>{shot.title}</strong>
                      <span className="wb-note">
                        {` · ${shot.aspectRatio} · ${shot.resolutionTier} · ${shot.durationSec}s`}
                        {shot.imagePrompt === undefined ? '' : ` · ${t('canvas.agent.storyboard.firstFrame')}`}
                        {shot.referenceAssetIds.length === 0
                          ? ''
                          : ` · ${t('canvas.agent.storyboard.shotRefs', { count: shot.referenceAssetIds.length })}`}
                      </span>
                    </li>
                  ))}
                </ul>
                {expansion.shots.some((shot) => shot.warnings.length > 0) ? (
                  <p className="wb-note cs-agent-proposal-warning">
                    {t('canvas.agent.storyboard.hasWarnings')}
                  </p>
                ) : null}
                <p className="wb-note">{t('canvas.agent.storyboard.landingNote')}</p>
                <button
                  type="button"
                  className="wb-btn cs-agent-primary"
                  data-testid="canvas-storyboard-land"
                  onClick={confirmLanding}
                >
                  {t('canvas.agent.storyboard.confirmLanding', { count: expansion.shots.length })}
                </button>
              </div>
            )}
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
          </section>
        )}
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
        {updateProposal === null ? null : (
          <section className="cs-agent-proposal" data-testid="canvas-node-update-proposal">
            <h4 className="cs-agent-proposal-title">{t('canvas.agent.updateProposalTitle')}</h4>
            <p className="wb-note">
              {t('canvas.agent.updateTarget', {
                title: selected?.title ?? updateProposal.targetNodeId,
              })}
            </p>
            <div className="cs-agent-diff">
              <span className="wb-note">{t('canvas.agent.oldTitle')}</span>
              <p>{selected?.title ?? t('canvas.agent.none')}</p>
              <span className="wb-note">{t('canvas.agent.newTitle')}</span>
              <p>{updateProposal.title}</p>
              <span className="wb-note">{t('canvas.agent.oldContent')}</span>
              <p>{selected?.prompt ?? t('canvas.agent.none')}</p>
              <span className="wb-note">{t('canvas.agent.newContent')}</span>
              <p>{updateProposal.content}</p>
            </div>
            {updateProposal.reason === undefined ? null : (
              <p className="wb-note">{updateProposal.reason}</p>
            )}
            {updateProposal.warnings.map((warning) => (
              <p className="wb-note cs-agent-proposal-warning" key={warning}>
                {warning}
              </p>
            ))}
            <p className="wb-note">{t('canvas.agent.updateProposalNote')}</p>
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
                data-testid="canvas-node-update-cancel"
                onClick={() => {
                  setUpdateProposal(null);
                  setProposalMeta(null);
                }}
              >
                {t('canvas.agent.cancel')}
              </button>
              <button
                type="button"
                className="wb-btn wb-btn-primary"
                data-testid="canvas-node-update-confirm"
                onClick={confirmUpdate}
              >
                {t('canvas.agent.confirmUpdate')}
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
            mode === 'storyboard'
              ? t('canvas.agent.storyboardPlaceholder')
              : mode === 'update'
                ? t('canvas.agent.updatePlaceholder')
                : mode === 'create'
                  ? t('canvas.agent.createPlaceholder')
                  : t('canvas.agent.placeholder')
          }
          placeholder={
            mode === 'storyboard'
              ? t('canvas.agent.storyboardPlaceholder')
              : mode === 'update'
                ? t('canvas.agent.updatePlaceholder')
                : mode === 'create'
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
          disabled={busy || message.trim() === '' || (mode === 'update' && !canUpdate)}
        >
          {mode === 'storyboard'
            ? t('canvas.agent.storyboardGenerate')
            : mode === 'update'
              ? t('canvas.agent.updatePropose')
              : mode === 'create'
                ? structured
                  ? t('canvas.agent.propose')
                  : t('canvas.agent.freeform')
                : t('canvas.agent.send')}
        </button>
      </form>
    </aside>
  );
}
