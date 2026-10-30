import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AUDIO_ENGINES,
  AUDIO_VOICES,
  DEFAULT_AUDIO_VOICE,
  MAX_AUDIO_SECONDS,
  MAX_AUDIO_TEXT_CHARS,
  MIN_AUDIO_SECONDS,
  audioEnginesFor,
  type AudioGenerateRequest,
  type AudioMode,
  type TaskProgress,
} from '@astrmira/shared';
import { ApiError, fetchTask, resolveMediaUrl, submitAudio } from '../lib/api';
import { Eyebrow } from '../components/Eyebrow';
import { useTranslate } from '../lib/i18n';
import { clipGeometry, contentEndFrame, findClip } from './model';
import { probeAudioDurationFrames } from './mediaProbe';
import type { EditStore } from './store';
import { useEditStore } from './store';

/**
 * 配音 / 配乐面板（V2.103 / Phase 2 ·「声音」）。
 *
 * ## 它解决的问题
 * 在这之前，声音只能"先在外面做好 → 上传 → 手拖进音效轨"。这个面板把中间那三段接起来：
 * **写一段字（或一句音乐描述）→ 生成 → 自动落到音效轨**，落点与淡入淡出都由代码定，
 * 用户不需要懂帧。
 *
 * ## 三条设计口径
 * 1. **引擎由模式决定**（`audioEnginesFor`）：配音只有云端 MiMo（本地配音本轮未接线），
 *    配乐/音效只有本机 Stable Audio。界面不提供"看起来能选但其实不存在"的选项。
 * 2. **隐私必须写在按钮旁边**：`AUDIO_ENGINES[engine].privacy` 原文照抄 ——
 *    MiMo 会把文本发到第三方云，这件事不能只写在文档里。
 * 3. **落轨规则是确定的**（不"猜"）：
 *    - 起点 = 0 帧；
 *    - 目标位置已有片段 → 新开一条音效轨（V2.102 的叠加语义）；
 *    - 比片子长的音频**在落轨时裁到片长**（否则导出时长会被一条 BGM 撑长 —— 实测过：5s 片变 8.04s）；
 *    - 淡入 8 帧 / 淡出 15 帧（不超过片段时长的 1/4、1/3），避免起止爆音。
 */

const POLL_INTERVAL_MS = 1200;
/** 本机 Stable Audio 冷态实测 39–47s；给到 5 分钟（含队列等待） */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const FADE_IN_MAX = 8;
const FADE_OUT_MAX = 15;

type Stage = 'idle' | 'running' | 'placing';

function describeFailure(caught: unknown): string {
  if (caught instanceof ApiError) {
    const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
    return `${code}${caught.failure.message}`;
  }
  return caught instanceof Error ? caught.message : String(caught);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const AudioPanel: React.FC<{ store: EditStore }> = ({ store }) => {
  const t = useTranslate();
  const project = useEditStore(store, (s) => s.project);

  const [mode, setMode] = useState<AudioMode>('tts');
  const [text, setText] = useState('');
  const [prompt, setPrompt] = useState('');
  const [voice, setVoice] = useState(DEFAULT_AUDIO_VOICE);
  const [style, setStyle] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  const filmFrames = contentEndFrame(project);
  const filmSec = Math.max(1, Math.round(filmFrames / project.fps));
  const [seconds, setSeconds] = useState(() =>
    Math.min(MAX_AUDIO_SECONDS, Math.max(MIN_AUDIO_SECONDS, filmSec)),
  );

  const engines = useMemo(() => audioEnginesFor(mode), [mode]);
  const engine = engines[0];
  const info = engine === undefined ? null : AUDIO_ENGINES[engine];
  const busy = stage !== 'idle';

  // 轮询计时器：给用户一个"真的在等"的读数（不编百分比 —— 音频模型不报进度）
  useEffect(() => {
    if (stage !== 'running') {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [stage]);

  /**
   * 落轨：把生成好的音频放到音效轨 0 帧，裁到片长，加淡入淡出。
   * 返回给人看的一句话（"落到了第几条音效轨"）。
   */
  const placeOnTimeline = async (task: Pick<TaskProgress, 'taskId' | 'outputAudioUrl'>): Promise<string> => {
    const url = resolveMediaUrl(task.outputAudioUrl);
    if (url === null) throw new Error(t('edit.audio.error.noOutput'));

    const durationFrames = await probeAudioDurationFrames(url, project.fps);
    const clipId = store.addAudioAt(
      {
        taskId: task.taskId,
        url,
        durationFrames,
        name: `${mode} · ${task.taskId.slice(0, 8)}`,
      },
      0,
    );

    const placed = store.getState().project;
    const found = findClip(placed, clipId);
    if (found === null) return t('edit.audio.placed', { seconds: (durationFrames / project.fps).toFixed(1) });

    const excess = durationFrames - filmFrames;
    const finalFrames = excess > 0 ? filmFrames : durationFrames;
    if (excess > 0) store.trimClip(clipId, 'right', -excess, clipGeometry(found.clip));

    store.updateSelectedClip({
      kind: 'audio',
      fadeInFrames: Math.min(FADE_IN_MAX, Math.floor(finalFrames / 4)),
      fadeOutFrames: Math.min(FADE_OUT_MAX, Math.floor(finalFrames / 3)),
    });

    return t('edit.audio.placed', { seconds: (finalFrames / project.fps).toFixed(1) });
  };

  const handleGenerate = async (): Promise<void> => {
    if (engine === undefined || busy) return;
    setError(null);
    setMessage(null);
    setStage('running');
    try {
      const body: AudioGenerateRequest =
        mode === 'tts'
          ? {
              mode,
              engine,
              text: text.trim(),
              voice,
              ...(style.trim() === '' ? {} : { style: style.trim() }),
            }
          : { mode, engine, prompt: prompt.trim(), seconds };

      const { taskId } = await submitAudio(body);

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let placed = false;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const task = await fetchTask(taskId);
        if (task.status === 'succeeded') {
          setStage('placing');
          const note = await placeOnTimeline(task);
          setMessage(note);
          placed = true;
          break;
        }
        if (task.status === 'failed' || task.status === 'cancelled') {
          throw new Error(task.error?.message ?? t('edit.audio.error.failed'));
        }
      }
      if (!placed) throw new Error(t('edit.audio.error.timeout'));
    } catch (caught) {
      setError(describeFailure(caught));
    } finally {
      setStage('idle');
    }
  };

  const canSubmit =
    !busy &&
    engine !== undefined &&
    (mode === 'tts' ? text.trim() !== '' : prompt.trim() !== '');
  const submitLabel =
    stage === 'running'
      ? t('edit.audio.busy', { seconds: elapsed })
      : stage === 'placing'
        ? t('edit.audio.placing')
        : t('edit.audio.generate');

  return (
    <section className="wb-panel ed-side-panel" data-testid="ed-audio-panel">
      <div className="wb-field-head">
        <Eyebrow index={3} tone="gold" as="h2">
          {t('edit.audio.section')}
        </Eyebrow>
        <span className="wb-note">{t('edit.audio.filmLength', { seconds: filmSec })}</span>
      </div>

      <div className="ed-audio-modes" role="group" aria-label={t('edit.audio.modeAria')}>
        {(['tts', 'bgm', 'sfx'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`wb-btn${mode === item ? ' wb-btn-gold' : ''}`}
            aria-pressed={mode === item}
            disabled={busy}
            onClick={() => {
              setMode(item);
              setError(null);
              setMessage(null);
            }}
          >
            {t(item === 'tts' ? 'common.mode.tts' : item === 'bgm' ? 'common.mode.bgm' : 'common.mode.sfx')}
          </button>
        ))}
      </div>

      {mode === 'tts' ? (
        <>
          <div className="ed-field">
            <label className="ed-field-label" htmlFor="ed-audio-text">
              {t('edit.audio.text.label')}
            </label>
            <textarea
              id="ed-audio-text"
              className="wb-input ed-field-textarea"
              rows={3}
              maxLength={MAX_AUDIO_TEXT_CHARS}
              value={text}
              placeholder={t('edit.audio.text.placeholder')}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="ed-field">
            <label className="ed-field-label" htmlFor="ed-audio-voice">
              {t('edit.audio.voice.label')}
            </label>
            <select
              id="ed-audio-voice"
              className="wb-input"
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
            >
              {AUDIO_VOICES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="ed-field">
            <label className="ed-field-label" htmlFor="ed-audio-style">
              {t('edit.audio.style.label')}
            </label>
            <input
              id="ed-audio-style"
              className="wb-input"
              type="text"
              value={style}
              placeholder={t('edit.audio.style.placeholder')}
              onChange={(event) => setStyle(event.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="ed-field">
            <label className="ed-field-label" htmlFor="ed-audio-prompt">
              {t('edit.audio.prompt.label')}
            </label>
            <textarea
              id="ed-audio-prompt"
              className="wb-input ed-field-textarea"
              rows={3}
              value={prompt}
              placeholder={t('edit.audio.prompt.placeholder')}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>
          <div className="ed-field">
            <label className="ed-field-label" htmlFor="ed-audio-seconds">
              {t('edit.audio.seconds.label')}
            </label>
            <input
              id="ed-audio-seconds"
              className="wb-input ed-field-number"
              type="number"
              min={MIN_AUDIO_SECONDS}
              max={MAX_AUDIO_SECONDS}
              step={1}
              value={seconds}
              onChange={(event) => setSeconds(Number(event.target.value))}
            />
            <span className="ed-field-hint">{t('edit.audio.seconds.hint', { max: MAX_AUDIO_SECONDS })}</span>
          </div>
        </>
      )}

      <div className="ed-export-actions">
        <button
          type="button"
          className="wb-btn wb-btn-gold"
          disabled={!canSubmit}
          onClick={() => void handleGenerate()}
        >
          {submitLabel}
        </button>
      </div>

      <p className="wb-note" style={{ marginTop: 8 }}>
        {t('edit.audio.autoPlace')}
      </p>

      {info === null ? null : (
        <div className="wb-note" data-testid="ed-audio-privacy" style={{ marginTop: 8 }}>
          <div>
            {t('edit.audio.engine', { engine: info.label })}
            {info.executedBy === 'cloud' ? ` · ${t('edit.audio.executedBy.cloud')}` : ` · ${t('edit.audio.executedBy.local')}`}
          </div>
          {/* 隐私与许可**原文**照抄引擎表：这不是装饰，是用户点按钮前必须知道的事 */}
          <div>{info.privacy}</div>
          <div>{info.license}</div>
          {info.notes === undefined ? null : <div>{info.notes}</div>}
        </div>
      )}

      {mode === 'tts' ? (
        <p className="wb-note" style={{ marginTop: 8 }}>
          {t('edit.audio.localTtsMissing')}
        </p>
      ) : null}

      {message === null ? null : <p className="wb-note" data-testid="ed-audio-done">{message}</p>}
      {error === null ? null : (
        <div className="wb-uncertain" style={{ marginTop: 8 }}>
          <span className="wb-uncertain-title">{t('edit.audio.failed')}</span>
          <span className="wb-uncertain-body">{error}</span>
        </div>
      )}
    </section>
  );
};
