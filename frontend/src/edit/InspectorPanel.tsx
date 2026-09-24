import React from 'react';
import { Eyebrow } from '../components/Eyebrow';
import { CLIP_FIELD_SCHEMA, applyProperty, readProperty, type FieldDescriptor } from './clipProperties';
import { EDIT_TRANSITION_LABELS, findClip, type EditClip } from './model';
import type { EditStore } from './store';
import { useEditStore } from './store';
import { formatTimecode } from './time';

/**
 * 属性面板（B34 · P3）：**schema 驱动**的选中片段属性编辑器。
 *
 * 面板不认识任何具体字段 —— 它遍历 `CLIP_FIELD_SCHEMA[clip.kind]` 的描述符渲染控件，
 * 把输入交给 `applyProperty` 翻译成模型补丁，再由 `store.updateSelectedClip` 写回
 * （值域钳制在 `model.updateClipFields`，这里只负责"采集与提示"）。
 *
 * 新增一个可调参数 = `clipProperties.ts` 加一行 + model 分支收口，本文件零改动。
 */

const CLIP_KIND_LABELS: Record<EditClip['kind'], string> = {
  video: '视频片段',
  caption: '字幕',
  audio: '音效',
  transition: '转场',
};

/** 只读的"事实"行（时长/时间码/来源）；这些不由面板改写 */
function factsFor(clip: EditClip, fps: number): { label: string; value: string }[] {
  const facts = [
    { label: '起点', value: formatTimecode(clip.startFrame, fps) },
    { label: '时长', value: formatTimecode(clip.durationFrames, fps) },
  ];
  if (clip.kind === 'video' || clip.kind === 'audio') {
    facts.push({ label: '来源', value: clip.source.taskId.slice(0, 8) });
    facts.push({
      label: '源片',
      value: `${formatTimecode(clip.source.durationFrames, fps)} · 裁入 ${formatTimecode(clip.trimStartFrames, fps)}`,
    });
  }
  if (clip.kind === 'transition') {
    facts.push({ label: '类型', value: EDIT_TRANSITION_LABELS[clip.transition] });
  }
  return facts;
}

const Field: React.FC<{
  descriptor: FieldDescriptor;
  clip: EditClip;
  onCommit: (key: string, value: string | number) => void;
}> = ({ descriptor, clip, onCommit }) => {
  const value = readProperty(clip, descriptor.key);
  const id = `ed-prop-${clip.id}-${descriptor.key}`;

  return (
    <div className="ed-field">
      <label className="ed-field-label" htmlFor={id}>
        {descriptor.label}
        {descriptor.unit === undefined ? null : <span className="ed-field-unit">（{descriptor.unit}）</span>}
      </label>
      {descriptor.type === 'textarea' ? (
        <textarea
          id={id}
          className="wb-input ed-field-textarea"
          value={String(value)}
          rows={3}
          onChange={(event) => onCommit(descriptor.key, event.target.value)}
        />
      ) : descriptor.type === 'select' ? (
        <select
          id={id}
          className="wb-input"
          value={String(value)}
          onChange={(event) => onCommit(descriptor.key, event.target.value)}
        >
          {(descriptor.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : descriptor.type === 'number' ? (
        <input
          id={id}
          className="wb-input ed-field-number"
          type="number"
          value={Number(value)}
          min={descriptor.min}
          max={descriptor.max}
          step={descriptor.step}
          onChange={(event) => onCommit(descriptor.key, event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="wb-input"
          type="text"
          value={String(value)}
          onChange={(event) => onCommit(descriptor.key, event.target.value)}
        />
      )}
      {descriptor.hint === undefined ? null : <span className="ed-field-hint">{descriptor.hint}</span>}
    </div>
  );
};

export const InspectorPanel: React.FC<{ store: EditStore }> = ({ store }) => {
  const project = useEditStore(store, (s) => s.project);
  const selectedClipId = useEditStore(store, (s) => s.selectedClipId);
  const found = selectedClipId === null ? null : findClip(project, selectedClipId);
  const clip = found?.clip ?? null;

  const commit = (key: string, value: string | number): void => {
    if (clip === null) return;
    const patch = applyProperty(clip, key, value);
    if (patch === null) return;
    store.updateSelectedClip(patch);
  };

  return (
    <section className="wb-panel ed-side-panel" data-testid="ed-inspector">
      <div className="wb-field-head">
        <Eyebrow index={1} tone="gold" as="h2">
          属性
        </Eyebrow>
        <span className="wb-note">
          {clip === null ? '未选中' : `${CLIP_KIND_LABELS[clip.kind]} · ${clip.id.slice(-6)}`}
        </span>
      </div>

      {clip === null ? (
        <p className="wb-note">在时间轴上点选一个片段（镜头 / 转场 / 字幕 / 音效）来编辑它的属性。</p>
      ) : (
        <>
          <div className="ed-facts">
            {factsFor(clip, project.fps).map((fact) => (
              <div className="ed-fact" key={fact.label}>
                <span className="ed-fact-label">{fact.label}</span>
                <span className="ed-fact-value">{fact.value}</span>
              </div>
            ))}
          </div>
          {CLIP_FIELD_SCHEMA[clip.kind].map((descriptor) => (
            <Field key={descriptor.key} descriptor={descriptor} clip={clip} onCommit={commit} />
          ))}
          {clip.kind === 'transition' ? (
            <div className="ed-export-actions">
              <button
                type="button"
                className="wb-btn"
                onClick={() => store.removeSelectedTransition()}
                title="移除转场并把后继片段右移还原"
              >
                移除转场
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
};
