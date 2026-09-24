import { describe, expect, it } from 'vitest';
import { addVideoClip, createProjectFromSource } from './model';
import { exportDurationFrames, exportFileName } from './exportMeta';

const makeSource = () => ({
  taskId: 'task-source-0001',
  url: '/media/source.mp4',
  durationFrames: 150,
});

describe('exportDurationFrames（导出时长 = 内容精确结束帧）', () => {
  it('单 clip 从 0 起：等于 clip 时长', () => {
    const project = createProjectFromSource(makeSource());
    expect(exportDurationFrames(project)).toBe(150);
  });

  it('末尾追加后：等于轨尾 clip 的结束帧（不含预览的 1s 余量）', () => {
    const project = createProjectFromSource(makeSource());
    const { project: withTwo } = addVideoClip(project, {
      taskId: 'task-b',
      url: '/media/b.mp4',
      durationFrames: 90,
    });
    expect(exportDurationFrames(withTwo)).toBe(240);
  });

  it('空工程（清空全部片段）：保底 1 帧，不产生 0 帧导出', () => {
    const project = createProjectFromSource(makeSource());
    const emptied = {
      ...project,
      tracks: project.tracks.map((track) => ({ ...track, clips: [] })),
    };
    expect(exportDurationFrames(emptied)).toBe(1);
  });
});

describe('exportFileName', () => {
  it('含源片前 8 位与时间戳，扩展名 mp4（同一时刻确定）', () => {
    const name = exportFileName('abcdef12-3456-7890-abcd-ef1234567890', Date.UTC(2026, 8, 24, 12, 34, 56));
    expect(name).toBe('astrmira-edit-abcdef12-20260924T123456.mp4');
  });

  it('没有源片（纯工程）时用 project 占位，不出现 undefined', () => {
    const name = exportFileName(null, Date.UTC(2026, 8, 24, 0, 0, 0));
    expect(name).toBe('astrmira-edit-project-20260924T000000.mp4');
    expect(name.includes('undefined')).toBe(false);
  });
});
