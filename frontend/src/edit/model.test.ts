import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_FPS,
  EditProjectSchema,
  MIN_CLIP_FRAMES,
  addAudioClip,
  addCaptionClip,
  addTransition,
  addVideoClip,
  applySnap,
  audioFadeFactor,
  audioVolumeAt,
  audioVolumeProp,
  clipEndFrame,
  collectSnapTargets,
  contentEndFrame,
  createProjectFromSource,
  editSourceLabel,
  findClip,
  moveClip,
  previewDurationFrames,
  removeClip,
  removeTransition,
  tracksInRenderOrder,
  transitionWindow,
  trimClip,
  updateClipFields,
  type AudioClip,
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
  it('四轨一次建齐（镜头 / 转场 / 字幕 / 音效）+ 一个铺满源片全长的 clip，默认 30fps', () => {
    const project = createProjectFromSource(makeSource());
    expect(project.fps).toBe(DEFAULT_PROJECT_FPS);
    expect(project.tracks.map((track) => track.kind)).toEqual([
      'video',
      'transition',
      'caption',
      'audio',
    ]);
    expect(project.tracks[1]!.clips).toHaveLength(0);
    expect(project.tracks[2]!.clips).toHaveLength(0);
    expect(project.tracks[3]!.clips).toHaveLength(0);
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

// ── P3：转场 / 字幕 / 音效 / 属性更新 ──────────────────────────────────────

/** A[0,150] + B（90 帧）紧贴追加 → [150,240] */
function makeTwoClips() {
  const project = createProjectFromSource(makeSource());
  const { project: withTwo, clipId: bId } = addVideoClip(project, {
    taskId: 'task-b',
    url: '/media/b.mp4',
    durationFrames: 90,
  });
  const aId = withTwo.tracks[0]!.clips[0]!.id;
  return { project: withTwo, aId, bId };
}

function transitionClips(project: ReturnType<typeof makeTwoClips>['project']) {
  const track = project.tracks.find((item) => item.kind === 'transition')!;
  return track.clips.filter((clip) => clip.kind === 'transition');
}

describe('转场（P3：添加 / 移除 / 破损清理）', () => {
  it('添加：后继片段左移 d，转场块坐在接缝窗口上（WYSIWYG，总时长缩短 d）', () => {
    const { project, aId, bId } = makeTwoClips();
    const result = addTransition(project, aId, 'fade', 15);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const b = findClip(result.project, bId)!.clip;
    expect(b.startFrame).toBe(135); // 150 - 15
    const transitions = transitionClips(result.project);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.startFrame).toBe(135);
    expect(transitions[0]!.durationFrames).toBe(15);
    expect(contentEndFrame(result.project)).toBe(225); // 240 - 15
    // 窗口查询：A 有 out、B 有 in
    expect(transitionWindow(result.project, aId).out?.id).toBe(transitions[0]!.id);
    expect(transitionWindow(result.project, bId).in?.id).toBe(transitions[0]!.id);
    // 模型仍然合法（zod 全过）
    expect(EditProjectSchema.safeParse(result.project).success).toBe(true);
  });

  it('拒绝：两段之间有空隙 / 后面没有片段 / 片段太短', () => {
    const { project, aId, bId } = makeTwoClips();
    const moved = moveClip(project, bId, 400); // 拉开空隙
    const gap = addTransition(moved, aId, 'fade', 15);
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.reason).toContain('空隙');

    const onlyOne = createProjectFromSource(makeSource());
    const noNext = addTransition(onlyOne, onlyOne.tracks[0]!.clips[0]!.id, 'fade', 15);
    expect(noNext.ok).toBe(false);
    if (!noNext.ok) expect(noNext.reason).toContain('没有相邻片段');

    const tiny = addVideoClip(project, { taskId: 'c', url: '/media/c.mp4', durationFrames: 3 });
    const tooShort = addTransition(tiny.project, bId, 'fade', 15);
    expect(tooShort.ok).toBe(false);
    if (!tooShort.ok) expect(tooShort.reason).toContain('太短');
  });

  it('时长被钳制在 [MIN, 上限]：转场不能吃掉整段', () => {
    const { project, aId, bId } = makeTwoClips();
    const huge = addTransition(project, aId, 'fade', 9999);
    expect(huge.ok).toBe(true);
    if (!huge.ok) return;
    const d = transitionClips(huge.project)[0]!.durationFrames;
    // 上限 = min(MAX_TRANSITION_FRAMES=60, fps*2=60, A.dur-1=149, B.dur-1=89)
    expect(d).toBe(60);
    expect(findClip(huge.project, bId)!.clip.startFrame).toBe(90);
  });

  it('显式移除：后继片段右移还原', () => {
    const { project, aId, bId } = makeTwoClips();
    const added = addTransition(project, aId, 'fade', 15);
    if (!added.ok) throw new Error('前置转场失败');
    const id = transitionClips(added.project)[0]!.id;
    const removed = removeTransition(added.project, id);
    expect(transitionClips(removed)).toHaveLength(0);
    expect(findClip(removed, bId)!.clip.startFrame).toBe(150);
  });

  it('破坏相邻性的编辑会移除转场并还原布局（移动 / 删除两端都算）', () => {
    const { project, aId, bId } = makeTwoClips();
    const added = addTransition(project, aId, 'fade', 15);
    if (!added.ok) throw new Error('前置转场失败');

    // 移动 B：转场没了，且 B 落在拖动指定的位置（不做额外位移）
    const moved = moveClip(added.project, bId, 200);
    expect(transitionClips(moved)).toHaveLength(0);
    expect(findClip(moved, bId)!.clip.startFrame).toBe(200);

    // 移动后 prune 也已还原 A 的邻居关系：A[0,150] 与 B[200,290] 不重叠
    const trimmed = trimClip(added.project, bId, 'right', -10); // 裁剪 B 同样破坏
    expect(transitionClips(trimmed)).toHaveLength(0);
    expect(findClip(trimmed, bId)!.clip.startFrame).toBe(150); // 还原到未左移位置

    const deleted = removeClip(added.project, aId);
    expect(transitionClips(deleted)).toHaveLength(0);
    expect(findClip(deleted, bId)!.clip.startFrame).toBe(150);
  });

  it('同接缝重复添加 = 替换（不叠加）', () => {
    const { project, aId } = makeTwoClips();
    const first = addTransition(project, aId, 'fade', 15);
    if (!first.ok) throw new Error('前置转场失败');
    const second = addTransition(first.project, aId, 'wipeleft', 20);
    if (!second.ok) throw new Error('替换失败');
    const transitions = transitionClips(second.project);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.transition).toBe('wipeleft');
    expect(transitions[0]!.durationFrames).toBe(20);
    expect(findClip(second.project, second.project.tracks[0]!.clips[1]!.id)!.clip.startFrame).toBe(130);
  });
});

describe('字幕与音效（P3）', () => {
  it('添加字幕：默认 2s、底部位、静态预设', () => {
    const project = createProjectFromSource(makeSource());
    const { project: withCaption, clipId } = addCaptionClip(project, { atFrame: 20 });
    const clip = findClip(withCaption, clipId)!.clip;
    expect(clip.kind).toBe('caption');
    if (clip.kind !== 'caption') return;
    expect(clip.startFrame).toBe(20);
    expect(clip.durationFrames).toBe(60);
    expect(clip.preset).toBe('plain');
    expect(clip.position).toBe('bottom');
    expect(EditProjectSchema.safeParse(withCaption).success).toBe(true);
  });

  it('字幕不与既有字幕重叠：重叠时右推到空位', () => {
    const project = createProjectFromSource(makeSource());
    const first = addCaptionClip(project, { atFrame: 0 });
    const second = addCaptionClip(first.project, { atFrame: 30 }); // 与 [0,60] 重叠
    expect(findClip(second.project, second.clipId)!.clip.startFrame).toBe(60);
  });

  it('添加音效：素材铺满源片、追加在音效轨末尾', () => {
    const project = createProjectFromSource(makeSource());
    const one = addAudioClip(project, { taskId: 'sfx', url: '/media/sfx.mp4', durationFrames: 45 });
    const two = addAudioClip(one.project, {
      taskId: 'sfx2',
      url: '/media/sfx2.mp4',
      durationFrames: 45,
    });
    expect(findClip(two.project, one.clipId)!.clip.startFrame).toBe(0);
    expect(findClip(two.project, two.clipId)!.clip.startFrame).toBe(45);
    expect(two.project.tracks.find((track) => track.kind === 'audio')!.clips).toHaveLength(2);
  });
});

/**
 * V2.102：音效轨可以叠加 —— 这是"旁白 + 配乐同时出声"能表达出来的唯一前提。
 * 旧模型里第二个片段被 `moveClip` 钳在第一个之后（真机实测：5s 片变 8.04s）。
 */
describe('音效轨叠加（V2.102）', () => {
  const audioSource = (name: string, durationFrames: number) => ({
    assetId: `asset-${name}`,
    url: `/media/assets/${name}.wav`,
    durationFrames,
  });

  it('atFrame 与已有片段相交 → 新开一条音效轨（旁白压在配乐上）', () => {
    const base = createProjectFromSource(makeSource());
    const bgm = addAudioClip(base, audioSource('bgm', 150), 0);
    const narration = addAudioClip(bgm.project, audioSource('narration', 91), 0);
    const audioTracks = narration.project.tracks.filter((track) => track.kind === 'audio');
    expect(audioTracks).toHaveLength(2);
    expect(findClip(narration.project, bgm.clipId)!.clip.startFrame).toBe(0);
    expect(findClip(narration.project, narration.clipId)!.clip.startFrame).toBe(0);
    // 两条轨都通过 schema（服务端 `POST /api/edits/renders` 用同一份校验）
    expect(EditProjectSchema.safeParse(narration.project).success).toBe(true);
  });

  it('atFrame 落在空位 → 复用同一条音效轨（不无脑新开轨）', () => {
    const base = createProjectFromSource(makeSource());
    const first = addAudioClip(base, audioSource('a', 45), 0);
    const second = addAudioClip(first.project, audioSource('b', 45), 60);
    const audioTracks = second.project.tracks.filter((track) => track.kind === 'audio');
    expect(audioTracks).toHaveLength(1);
    expect(findClip(second.project, second.clipId)!.clip.startFrame).toBe(60);
  });

  it('moveClip 对音效片段放开邻居钳制（视频仍然磁吸撞墙）', () => {
    const base = createProjectFromSource(makeSource());
    const bgm = addAudioClip(base, audioSource('bgm', 150), 0);
    // 不加 atFrame → 追加到末尾（91..241 之外）
    const narration = addAudioClip(bgm.project, audioSource('narr', 91));
    const appended = findClip(narration.project, narration.clipId)!.clip.startFrame;
    expect(appended).toBe(150);

    // 音效：拖回 0 叠在配乐上 —— 允许
    const moved = moveClip(narration.project, narration.clipId, 0);
    expect(findClip(moved, narration.clipId)!.clip.startFrame).toBe(0);

    // 视频：仍然被邻居挡住（这里没有邻居，用第二段视频验证）
    const withTwoVideos = addVideoClip(base, { taskId: 'task-b', url: '/media/b.mp4', durationFrames: 60 });
    const second = findClip(withTwoVideos.project, withTwoVideos.clipId)!.clip;
    expect(second.startFrame).toBe(150);
    const clamped = moveClip(withTwoVideos.project, withTwoVideos.clipId, 0);
    expect(findClip(clamped, withTwoVideos.clipId)!.clip.startFrame).toBe(150);
  });

  it('tracksInRenderOrder 返回**全部**轨道，按类型分组（同类型保持数组顺序）', () => {
    const base = createProjectFromSource(makeSource());
    const bgm = addAudioClip(base, audioSource('bgm', 150), 0);
    const narration = addAudioClip(bgm.project, audioSource('narr', 91), 0);
    const ordered = tracksInRenderOrder(narration.project);
    expect(ordered).toHaveLength(narration.project.tracks.length);
    expect(ordered.map((track) => track.kind)).toEqual([
      'video',
      'transition',
      'caption',
      'audio',
      'audio',
    ]);
    // 两条音效轨都在（这正是旧写法 `TRACK_RENDER_ORDER.map(find)` 丢掉的那一条）
    expect(ordered.filter((track) => track.kind === 'audio')).toHaveLength(2);
  });
});

describe('属性面板字段更新（updateClipFields）', () => {
  it('video：speed 受源片余量钳制、volume 钳在 0~2', () => {
    const { project, aId } = makeTwoClips();
    // A 铺满全片（150/150）→ 可提速空间为 0，speed=2 被钳回 1
    expect(
      findClip(updateClipFields(project, aId, { kind: 'video', speed: 2 }), aId)!.clip.kind ===
        'video',
    ).toBe(true);
    const clipped = findClip(updateClipFields(project, aId, { kind: 'video', speed: 2 }), aId)!.clip;
    if (clipped.kind !== 'video') return;
    expect(clipped.speed).toBe(1);
    const loud = findClip(updateClipFields(project, aId, { kind: 'video', volume: 9 }), aId)!.clip;
    if (loud.kind !== 'video') return;
    expect(loud.volume).toBe(2);
  });

  it('video：label 空串 = 清除标签', () => {
    const { project, aId } = makeTwoClips();
    const labelled = updateClipFields(project, aId, { kind: 'video', label: '开场' });
    expect(findClip(labelled, aId)!.clip.kind === 'video' && (findClip(labelled, aId)!.clip as { label?: string }).label).toBe('开场');
    const cleared = updateClipFields(labelled, aId, { kind: 'video', label: null });
    expect(
      findClip(cleared, aId)!.clip.kind === 'video' &&
        (findClip(cleared, aId)!.clip as { label?: string }).label,
    ).toBeUndefined();
  });

  it('caption：文本去空白、空文本保持原值；预设可切换', () => {
    const project = createProjectFromSource(makeSource());
    const { project: withCaption, clipId } = addCaptionClip(project, { atFrame: 0 });
    const edited = findClip(
      updateClipFields(withCaption, clipId, { kind: 'caption', text: '  雨停了  ', preset: 'wordSlide' }),
      clipId,
    )!.clip;
    if (edited.kind !== 'caption') return;
    expect(edited.text).toBe('雨停了');
    expect(edited.preset).toBe('wordSlide');
    const kept = findClip(updateClipFields(withCaption, clipId, { kind: 'caption', text: '   ' }), clipId)!.clip;
    if (kept.kind !== 'caption') return;
    expect(kept.text).toBe('字幕文本');
  });

  it('transition：改时长 = 移除+重加，后继片段的左移量随之变化', () => {
    const { project, aId, bId } = makeTwoClips();
    const added = addTransition(project, aId, 'fade', 15);
    if (!added.ok) throw new Error('前置转场失败');
    const id = transitionClips(added.project)[0]!.id;
    const updated = updateClipFields(added.project, id, { kind: 'transition', durationFrames: 30 });
    expect(findClip(updated, bId)!.clip.startFrame).toBe(120); // 150 - 30
    const t = transitionClips(updated)[0]!;
    expect(t.durationFrames).toBe(30);
    expect(t.startFrame).toBe(120);
  });

  it('kind 不匹配 = 原样返回（调用方 bug 不该静默生效）', () => {
    const project = createProjectFromSource(makeSource());
    const { project: withCaption, clipId } = addCaptionClip(project, { atFrame: 0 });
    const unchanged = updateClipFields(withCaption, clipId, { kind: 'video', speed: 2 });
    expect(unchanged).toBe(withCaption);
  });
});

describe('V2.10（台账 B57）· 音频素材来源与淡入淡出', () => {
  const audioSource = { assetId: 'asset-audio', url: '/media/assets/a.mp3', durationFrames: 90 };

  it('片段来源可以是**上传资产**（音频素材），工程仍通过校验', () => {
    const { project, clipId } = addAudioClip(createProjectFromSource(makeSource()), audioSource);
    expect(EditProjectSchema.safeParse(project).success).toBe(true);
    const clip = findClip(project, clipId)!.clip;
    expect(clip.kind === 'audio' && clip.source.assetId).toBe('asset-audio');
    // 没有伪造 taskId —— 资产来源就是资产来源
    expect(clip.kind === 'audio' && clip.source.taskId).toBe(undefined);
  });

  it('**无来源**（既无 taskId 也无 assetId）被 schema 拒绝（不静默接受无源片段）', () => {
    const project = createProjectFromSource(makeSource());
    const broken = {
      ...project,
      tracks: [
        {
          id: 'track-audio',
          kind: 'audio',
          clips: [
            {
              kind: 'audio',
              id: 'clip-audio',
              startFrame: 0,
              durationFrames: 30,
              trimStartFrames: 0,
              volume: 1,
              source: { url: '/media/x.mp3', durationFrames: 30 },
            },
          ],
        },
      ],
    };
    expect(EditProjectSchema.safeParse(broken).success).toBe(false);
  });

  it('editSourceLabel：name > taskId 前 8 位 > assetId 前 8 位（资产来源不会崩在 undefined）', () => {
    expect(editSourceLabel({ taskId: 'abcdefgh-1111', url: '/media/a.mp4', durationFrames: 1 })).toBe(
      'abcdefgh',
    );
    expect(
      editSourceLabel({ assetId: '12345678-2222', url: '/media/b.mp3', durationFrames: 1 }),
    ).toBe('12345678');
    expect(
      editSourceLabel({
        assetId: '12345678-2222',
        name: 'BGM.mp3',
        url: '/media/b.mp3',
        durationFrames: 1,
      }),
    ).toBe('BGM.mp3');
  });

  it('淡入淡出曲线：线性、端点为 0、中段为 1', () => {
    const clip: Pick<AudioClip, 'durationFrames' | 'fadeInFrames' | 'fadeOutFrames'> = {
      durationFrames: 100,
      fadeInFrames: 10,
      fadeOutFrames: 20,
    };
    expect(audioFadeFactor(clip, 0)).toBe(0);
    expect(audioFadeFactor(clip, 5)).toBeCloseTo(0.5);
    expect(audioFadeFactor(clip, 10)).toBe(1);
    expect(audioFadeFactor(clip, 50)).toBe(1);
    expect(audioFadeFactor(clip, 90)).toBeCloseTo(0.5);
    expect(audioFadeFactor(clip, 100)).toBe(0);
  });

  it('两段重叠时取**较小值**（不会因叠加而放大），越界帧被钳到端点上', () => {
    const overlap = { durationFrames: 10, fadeInFrames: 8, fadeOutFrames: 8 };
    // frame=4：淡入 4/8=0.5、淡出 (10-4)/8=0.75 → 取小 = 0.5
    expect(audioFadeFactor(overlap, 4)).toBeCloseTo(0.5);
    expect(audioFadeFactor(overlap, -5)).toBe(0);
    expect(audioFadeFactor(overlap, 999)).toBe(0);
    // 无淡变 → 恒定 1（不因"没设"而静音）
    expect(audioFadeFactor({ durationFrames: 10 }, 0)).toBe(1);
    expect(audioFadeFactor({ durationFrames: 10 }, 10)).toBe(1);
  });

  it('audioVolumeProp：无淡变给**常量**（Remotion 走静态路径），有淡变给帧函数', () => {
    const plain: AudioClip = {
      kind: 'audio',
      id: 'c1',
      startFrame: 0,
      durationFrames: 60,
      trimStartFrames: 0,
      volume: 0.8,
      source: { taskId: 't', url: '/media/a.mp4', durationFrames: 60 },
    };
    expect(audioVolumeProp(plain)).toBe(0.8);
    expect(audioVolumeProp({ ...plain, fadeInFrames: 0, fadeOutFrames: 0 })).toBe(0.8);

    const faded = { ...plain, fadeInFrames: 30 };
    const prop = audioVolumeProp(faded);
    expect(typeof prop).toBe('function');
    if (typeof prop !== 'function') throw new Error('应为帧函数');
    expect(prop(0)).toBe(0);
    expect(prop(30)).toBeCloseTo(0.8);
    expect(audioVolumeAt(faded, 15)).toBeCloseTo(0.4);
  });

  it('updateClipFields 把淡入淡出钳到 [0, durationFrames]（越界就地修正，不报错）', () => {
    const { project, clipId } = addAudioClip(createProjectFromSource(makeSource()), audioSource);
    const bumped = updateClipFields(project, clipId, {
      kind: 'audio',
      fadeInFrames: 9999,
      fadeOutFrames: -5,
    });
    const clip = findClip(bumped, clipId)!.clip;
    expect(clip.kind === 'audio' && clip.fadeInFrames).toBe(audioSource.durationFrames);
    expect(clip.kind === 'audio' && clip.fadeOutFrames).toBe(0);
  });
});
