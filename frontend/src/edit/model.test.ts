import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_FPS,
  EditProjectSchema,
  MIN_CLIP_FRAMES,
  addVideoClip,
  applySnap,
  clipEndFrame,
  collectSnapTargets,
  contentEndFrame,
  createProjectFromSource,
  findClip,
  moveClip,
  previewDurationFrames,
  removeClip,
  trimClip,
  type EditClipSource,
} from './model';
import { formatTimecode, framesToSeconds, secondsToFrames } from './time';

/** 5s 源片 @ 30fps 工程 = 150 帧 */
function makeSource(overrides?: Partial<EditClipSource>): EditClipSource {
  return {
    taskId: 'task-a',
    url: '/media/a.mp4',
    durationFrames: 150,
    ...overrides,
  };
}

describe('schema', () => {
  it('合法工程通过校验', () => {
    const project = createProjectFromSource(makeSource());
    expect(EditProjectSchema.safeParse(project).success).toBe(true);
  });

  it('轨道内混入异类 clip 被拒（字幕轨里塞视频）', () => {
    const project = createProjectFromSource(makeSource());
    const broken = {
      ...project,
      tracks: [{ id: 't1', kind: 'caption', clips: project.tracks[0]!.clips }],
    };
    const result = EditProjectSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('url 必须是 /media/ 同源相对地址', () => {
    const project = createProjectFromSource(makeSource({ url: 'https://evil.example/x.mp4' }));
    expect(EditProjectSchema.safeParse(project).success).toBe(false);
  });
});

describe('createProjectFromSource', () => {
  it('一条视频轨 + 一个铺满源片全长的 clip，默认 30fps', () => {
    const project = createProjectFromSource(makeSource());
    expect(project.fps).toBe(DEFAULT_PROJECT_FPS);
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0]!.kind).toBe('video');
    const clip = project.tracks[0]!.clips[0]!;
    if (clip.kind !== 'video') throw new Error('初始 clip 应是视频片段');
    expect(clip.startFrame).toBe(0);
    expect(clip.durationFrames).toBe(150);
    expect(clip.trimStartFrames).toBe(0);
    expect(clip.speed).toBe(1);
    expect(clip.volume).toBe(1);
  });

  it('画幅按源片探测值落地', () => {
    const project = createProjectFromSource(makeSource(), { width: 704, height: 1280 });
    expect(project.width).toBe(704);
    expect(project.height).toBe(1280);
  });
});

describe('addVideoClip', () => {
  it('默认追加到视频轨末尾', () => {
    const project = createProjectFromSource(makeSource());
    const { project: next, clipId } = addVideoClip(
      project,
      makeSource({ taskId: 'task-b', url: '/media/b.mp4', durationFrames: 90 }),
    );
    const found = findClip(next, clipId);
    expect(found).not.toBeNull();
    expect(found!.clip.startFrame).toBe(150);
    expect(next.tracks[0]!.clips).toHaveLength(2);
    // 不可变：原工程不动
    expect(project.tracks[0]!.clips).toHaveLength(1);
  });

  it('显式 atFrame 落点（取整 + 钳制 ≥0）', () => {
    const project = createProjectFromSource(makeSource());
    const { project: next, clipId } = addVideoClip(project, makeSource(), 40.6);
    expect(findClip(next, clipId)!.clip.startFrame).toBe(41);
  });
});

describe('moveClip', () => {
  it('移动并钳制在时间轴 0 点之内', () => {
    const project = createProjectFromSource(makeSource());
    const clipId = project.tracks[0]!.clips[0]!.id;
    expect(findClip(moveClip(project, clipId, 66.4), clipId)!.clip.startFrame).toBe(66);
    expect(findClip(moveClip(project, clipId, -30), clipId)!.clip.startFrame).toBe(0);
  });
});

describe('trimClip', () => {
  it('左裁：起点与裁入点同步平移，时长缩短', () => {
    const project = createProjectFromSource(makeSource());
    const clipId = project.tracks[0]!.clips[0]!.id;
    const next = trimClip(project, clipId, 'left', 30);
    const clip = findClip(next, clipId)!.clip;
    expect(clip.startFrame).toBe(30);
    expect(clip.durationFrames).toBe(120);
    expect(clip.kind === 'video' ? clip.trimStartFrames : -1).toBe(30);
  });

  it('裁入点已为 0 时左缘不能再向左拖（源片没有更多内容可揭示）', () => {
    const project = createProjectFromSource(makeSource());
    const clipId = project.tracks[0]!.clips[0]!.id;
    const moved = moveClip(project, clipId, 10);
    const next = trimClip(moved, clipId, 'left', -50);
    const clip = findClip(next, clipId)!.clip;
    expect(clip.startFrame).toBe(10);
    expect(clip.durationFrames).toBe(150);
  });

  it('左裁不越过源片开头（裁入点不为负）', () => {
    const project = createProjectFromSource(makeSource());
    const clipId = project.tracks[0]!.clips[0]!.id;
    // 先左裁 30（trimStart=30），再把 clip 移出 0 点，然后往左回裁：
    // 最多只能回到 trimStart=0，即 delta ≥ -30
    const trimmed = trimClip(project, clipId, 'left', 30);
    const moved = moveClip(trimmed, clipId, 60);
    const next = trimClip(moved, clipId, 'left', -80);
    const clip = findClip(next, clipId)!.clip;
    expect(clip.startFrame).toBe(30);
    expect(clip.kind === 'video' ? clip.trimStartFrames : -1).toBe(0);
  });

  it('右裁不超过源片真实时长', () => {
    const project = createProjectFromSource(makeSource());
    const clipId = project.tracks[0]!.clips[0]!.id;
    const next = trimClip(project, clipId, 'right', 999);
    expect(findClip(next, clipId)!.clip.durationFrames).toBe(150);
  });

  it('右裁受变速约束：speed=2 时源片消耗加倍，可拖时长减半', () => {
    const project = createProjectFromSource(makeSource());
    const clipId = project.tracks[0]!.clips[0]!.id;
    const sped = {
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({ ...clip, speed: 2 })),
      })),
    };
    const next = trimClip(sped, clipId, 'right', 999);
    // 源片 150 帧 ÷ speed 2 = 时间轴上最多 75 帧
    expect(findClip(next, clipId)!.clip.durationFrames).toBe(75);
  });

  it('两侧都守住最短时长', () => {
    const project = createProjectFromSource(makeSource({ durationFrames: 10 }));
    const clipId = project.tracks[0]!.clips[0]!.id;
    const left = trimClip(project, clipId, 'left', 999);
    expect(findClip(left, clipId)!.clip.durationFrames).toBe(MIN_CLIP_FRAMES);
    const right = trimClip(project, clipId, 'right', -999);
    expect(findClip(right, clipId)!.clip.durationFrames).toBe(MIN_CLIP_FRAMES);
  });

  it('base 几何基准：拖拽往返回到原位不产生累积误差', () => {
    const project = createProjectFromSource(makeSource());
    const clipId = project.tracks[0]!.clips[0]!.id;
    const base = { startFrame: 0, durationFrames: 150, trimStartFrames: 0, speed: 1, maxDurationFrames: 150 };
    const dragged = trimClip(project, clipId, 'left', 50, base);
    const back = trimClip(dragged, clipId, 'left', 0, base);
    const clip = findClip(back, clipId)!.clip;
    expect(clip.startFrame).toBe(0);
    expect(clip.durationFrames).toBe(150);
  });
});

describe('同轨防重叠（磁吸撞墙）', () => {
  /** clip A [0,150] + clip B（90 帧）追加在轨尾 [150,240] */
  function makeTwoClips() {
    const project = createProjectFromSource(makeSource());
    const { project: withTwo, clipId: bId } = addVideoClip(
      project,
      makeSource({ taskId: 'task-b', url: '/media/b.mp4', durationFrames: 90 }),
    );
    const aId = withTwo.tracks[0]!.clips[0]!.id;
    return { project: withTwo, aId, bId };
  }

  it('移动不越过前一个 clip 的尾帧', () => {
    const { project, bId } = makeTwoClips();
    const next = moveClip(project, bId, 0);
    expect(findClip(next, bId)!.clip.startFrame).toBe(150);
  });

  it('空隙放不下时原地不动', () => {
    const { project, aId } = makeTwoClips();
    // A 长 150 帧，右边紧贴 B（150 起）→ 无处可去
    const next = moveClip(project, aId, 60);
    expect(findClip(next, aId)!.clip.startFrame).toBe(0);
  });

  it('右裁不越过下一个 clip 的首帧', () => {
    const { project, aId } = makeTwoClips();
    const shortened = trimClip(project, aId, 'right', -60); // A 收到 [0,90]
    expect(findClip(shortened, aId)!.clip.durationFrames).toBe(90);
    const widened = trimClip(shortened, aId, 'right', 999); // 源片富余，但 B 在 150
    expect(findClip(widened, aId)!.clip.durationFrames).toBe(150);
  });

  it('左裁不越过前一个 clip 的尾帧（邻居比源片裁入先撞墙）', () => {
    const { project, bId } = makeTwoClips();
    // 先左裁 30：B [180,240] trimStart=30；再移到 160：裁入余量 30 帧 > 距邻居 10 帧
    const trimmed = trimClip(project, bId, 'left', 30);
    const moved = moveClip(trimmed, bId, 160);
    const next = trimClip(moved, bId, 'left', -999);
    const clip = findClip(next, bId)!.clip;
    expect(clip.startFrame).toBe(150); // 撞在 A 的尾帧，而不是 trimStart 允许的 130
    expect(clip.durationFrames).toBe(70);
    expect(clip.kind === 'video' ? clip.trimStartFrames : -1).toBe(20);
  });
});

describe('removeClip / 时长', () => {
  it('删除只影响目标 clip', () => {
    const project = createProjectFromSource(makeSource());
    const { project: withTwo, clipId } = addVideoClip(project, makeSource({ taskId: 'b', url: '/media/b.mp4' }));
    const next = removeClip(withTwo, clipId);
    expect(next.tracks[0]!.clips).toHaveLength(1);
    expect(findClip(next, clipId)).toBeNull();
  });

  it('contentEndFrame 取最晚 clip 结束；previewDurationFrames 有下限与余量', () => {
    const project = createProjectFromSource(makeSource());
    expect(contentEndFrame(project)).toBe(150);
    expect(previewDurationFrames(project)).toBe(180);
    const empty = removeClip(project, project.tracks[0]!.clips[0]!.id);
    expect(contentEndFrame(empty)).toBe(0);
    expect(previewDurationFrames(empty)).toBe(60);
  });
});

describe('吸附', () => {
  it('候选 = 0 点 + 播放头 + 其他 clip 首尾（不含自身）', () => {
    const project = createProjectFromSource(makeSource());
    const selfId = project.tracks[0]!.clips[0]!.id;
    const { project: withTwo, clipId: otherId } = addVideoClip(
      project,
      makeSource({ taskId: 'b', url: '/media/b.mp4', durationFrames: 90 }),
    );
    // 把第二个 clip 挪到 300，避免与自身尾帧重叠干扰断言
    const arranged = moveClip(withTwo, otherId, 300);
    const targets = collectSnapTargets(arranged, selfId, 42);
    expect(targets).toContain(0);
    expect(targets).toContain(42);
    expect(targets).toContain(300); // 另一个 clip 的首
    expect(targets).toContain(390); // 另一个 clip 的尾
    expect(targets).not.toContain(clipEndFrame(arranged.tracks[0]!.clips[0]!)); // 自身尾帧 150 不在内
  });

  it('首尾缘都在容差内吸附，容差外原样通过', () => {
    const targets = [100, 200];
    expect(applySnap(103, 50, targets, 5)).toBe(100);
    expect(applySnap(148, 50, targets, 5)).toBe(150); // 尾缘 198 → 200
    expect(applySnap(120, 50, targets, 5)).toBe(120);
  });
});

describe('时间工具', () => {
  it('秒帧互转与时间码', () => {
    expect(secondsToFrames(1.5, 30)).toBe(45);
    expect(framesToSeconds(45, 30)).toBe(1.5);
    expect(formatTimecode(0, 30)).toBe('00:00.00');
    expect(formatTimecode(45, 30)).toBe('00:01.15');
    expect(formatTimecode(30 * 65 + 7, 30)).toBe('01:05.07');
  });
});
