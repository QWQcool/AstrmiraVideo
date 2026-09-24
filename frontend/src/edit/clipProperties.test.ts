import { describe, expect, it } from 'vitest';
import { CLIP_FIELD_SCHEMA, applyProperty, readProperty } from './clipProperties';
import {
  MAX_TRANSITION_FRAMES,
  MIN_TRANSITION_FRAMES,
  addCaptionClip,
  addTransition,
  addVideoClip,
  createProjectFromSource,
  findClip,
  updateClipFields,
  type EditClip,
} from './model';

const makeSource = () => ({ taskId: 'task-prop', url: '/media/p.mp4', durationFrames: 150 });

function videoClip(): EditClip {
  return createProjectFromSource(makeSource()).tracks[0]!.clips[0]!;
}

describe('CLIP_FIELD_SCHEMA（描述表）', () => {
  it('四类片段都有可调字段，且字段 key 互不重复', () => {
    for (const kind of ['video', 'caption', 'audio', 'transition'] as const) {
      const fields = CLIP_FIELD_SCHEMA[kind];
      expect(fields.length).toBeGreaterThan(0);
      const keys = fields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('转场时长的提示值域与模型常量一致（改常量必须同步面板）', () => {
    const duration = CLIP_FIELD_SCHEMA.transition.find((field) => field.key === 'durationFrames')!;
    expect(duration.min).toBe(MIN_TRANSITION_FRAMES);
    expect(duration.max).toBe(MAX_TRANSITION_FRAMES);
  });

  it('select 字段的选项与模型枚举一一对应（不出现面板写不出、模型不认的值）', () => {
    const presets = CLIP_FIELD_SCHEMA.caption.find((field) => field.key === 'preset')!;
    expect(presets.options?.map((option) => option.value)).toEqual([
      'plain',
      'fade',
      'wordSlide',
      'typewriter',
    ]);
    const positions = CLIP_FIELD_SCHEMA.caption.find((field) => field.key === 'position')!;
    expect(positions.options?.map((option) => option.value)).toEqual(['bottom', 'center', 'top']);
    const transitions = CLIP_FIELD_SCHEMA.transition.find((field) => field.key === 'transition')!;
    expect(transitions.options?.map((option) => option.value)).toEqual([
      'fade',
      'wipeleft',
      'slideright',
    ]);
  });
});

describe('readProperty / applyProperty', () => {
  it('读回当前值（video 的 label 缺省为空串）', () => {
    const clip = videoClip();
    expect(readProperty(clip, 'speed')).toBe(1);
    expect(readProperty(clip, 'volume')).toBe(1);
    expect(readProperty(clip, 'label')).toBe('');
    expect(readProperty(clip, 'nope')).toBe('');
  });

  it('数值输入转成补丁；NaN 拒绝（返回 null 由面板保持原值）', () => {
    const clip = videoClip();
    expect(applyProperty(clip, 'speed', '1.25')).toEqual({ kind: 'video', speed: 1.25 });
    expect(applyProperty(clip, 'speed', 'abc')).toBeNull();
    expect(applyProperty(clip, 'speed', '')).toBeNull();
  });

  it('未知字段 / 种类不匹配 → null（不误伤）', () => {
    const clip = videoClip();
    expect(applyProperty(clip, 'whatever', 1)).toBeNull();
    expect(applyProperty(clip, 'text', '嗨')).toBeNull(); // text 是 caption 的字段
  });

  it('select 值原样透传，由模型收口合法性', () => {
    const { project, clipId } = addCaptionClip(createProjectFromSource(makeSource()), {});
    const clip = findClip(project, clipId)!.clip;
    expect(applyProperty(clip, 'preset', 'wordSlide')).toEqual({ kind: 'caption', preset: 'wordSlide' });
    expect(applyProperty(clip, 'position', 'top')).toEqual({ kind: 'caption', position: 'top' });
  });
});

describe('面板 → 模型 的端到端（applyProperty + updateClipFields）', () => {
  it('改字幕文本与预设，写回能落进工程', () => {
    const { project, clipId } = addCaptionClip(createProjectFromSource(makeSource()), {});
    const clip = findClip(project, clipId)!.clip;
    const patch = applyProperty(clip, 'text', '雨停了')!;
    const next = findClip(updateClipFields(project, clipId, patch), clipId)!.clip;
    expect(next.kind === 'caption' && next.text).toBe('雨停了');
  });

  it('改转场时长，后继片段的左移量同步变化（面板 → 模型链路）', () => {
    const project = createProjectFromSource(makeSource());
    const { project: two, clipId: bId } = addVideoClip(project, {
      taskId: 'b',
      url: '/media/b.mp4',
      durationFrames: 90,
    });
    const aId = two.tracks[0]!.clips[0]!.id;
    const added = addTransition(two, aId, 'fade', 15);
    if (!added.ok) throw new Error('前置转场失败');
    const transitionClip = added.project.tracks
      .find((track) => track.kind === 'transition')!
      .clips.find((clip) => clip.kind === 'transition')!;
    const patch = applyProperty(transitionClip, 'durationFrames', '30')!;
    const next = updateClipFields(added.project, transitionClip.id, patch);
    expect(findClip(next, bId)!.clip.startFrame).toBe(120);
  });
});
