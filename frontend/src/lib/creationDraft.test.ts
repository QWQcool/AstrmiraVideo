import { describe, expect, it } from 'vitest';
import type { ModelCapability } from '@astrmira/shared';
import {
  CREATION_DRAFT_BACKUP_KEY,
  CREATION_DRAFT_STORAGE_KEY,
  CREATION_KIND_CONTROLS,
  clearCreationDraft,
  clearCreationDraftBackup,
  createCreationDraft,
  creationIssue,
  readCreationDraft,
  readCreationDraftBackup,
  settingsForKind,
  switchCreationKind,
  writeCreationDraft,
  writeCreationDraftBackup,
  type CreationDraft,
} from './creationDraft';

function capability(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    modelId: 'seedance-mini',
    label: 'Seedance 2.0 mini',
    provider: 'cloud-volcano-seedance',
    modes: ['t2v', 'i2v'],
    referenceModes: ['none', 'first-last-frame'],
    maxReferences: 2,
    referenceKinds: ['image'],
    aspectRatios: ['16:9'],
    resolutions: [{ width: 1280, height: 720 }],
    durations: [5],
    maxCount: 1,
    cost: { source: 'provider', unit: 'per-second', amountCny: 0.2 },
    ...overrides,
  };
}

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    raw: map,
  };
}

function draftWith(overrides: Partial<CreationDraft> = {}): CreationDraft {
  return {
    ...createCreationDraft('video', 1),
    prompt: '镜头缓缓推进',
    references: [{ assetId: 'a1', role: 'first-frame', order: 0 }],
    settings: {
      modelId: 'seedance-mini',
      mode: 'i2v',
      aspectRatio: '16:9',
      resolution: { width: 1280, height: 720 },
      durationSec: 5,
      count: 1,
    },
    ...overrides,
  };
}

describe('creationDraft', () => {
  it('默认是 Agent 态，且不带任何参数', () => {
    const draft = createCreationDraft('agent', 10);
    expect(draft).toEqual({
      kind: 'agent',
      prompt: '',
      references: [],
      settings: {},
      updatedAt: 10,
    });
    expect(CREATION_KIND_CONTROLS.agent).toEqual([]);
  });

  it('切换类型不清空提示词、素材与被隐藏的参数', () => {
    const video = draftWith();
    const image = switchCreationKind(video, 'image', 20);
    expect(image.kind).toBe('image');
    expect(image.prompt).toBe(video.prompt);
    expect(image.references).toEqual(video.references);
    // 时长在图片态不显示，但**不删**——切回来还在
    expect(image.settings.durationSec).toBe(5);
    expect(switchCreationKind(image, 'video', 30).settings.durationSec).toBe(5);
  });

  it('切到同一类型时返回原对象（避免无谓重渲染）', () => {
    const draft = draftWith();
    expect(switchCreationKind(draft, 'video')).toBe(draft);
  });

  it('提交时只带当前类型的参数：图片不带时长/参考模式，视频带全套', () => {
    const draft = draftWith();
    expect(settingsForKind(draft, 'image')).toEqual({
      mode: 't2i',
      modelId: 'seedance-mini',
      aspectRatio: '16:9',
      resolution: { width: 1280, height: 720 },
      count: 1,
    });
    expect(settingsForKind(draft, 'video')).toMatchObject({ durationSec: 5, mode: 'i2v' });
    expect(settingsForKind(draft, 'agent')).toEqual({});
  });

  it('空提示词优先报错，即使没有能力目录', () => {
    expect(creationIssue(createCreationDraft('agent'), null)).toBe('empty-prompt');
  });

  it('Agent 态不判能力（先出方案，不直接提交生成）', () => {
    const draft = { ...createCreationDraft('agent'), prompt: '做一个猫的短片' };
    expect(creationIssue(draft, null)).toBeNull();
  });

  it('图片/视频没有能力目录时如实报 model-unavailable', () => {
    expect(creationIssue(draftWith(), null)).toBe('model-unavailable');
  });

  it('能力不满足时返回能力目录的第一个问题码', () => {
    const draft = draftWith({ settings: { ...draftWith().settings, mode: 'v2v' } });
    expect(creationIssue(draft, capability())).toBe('mode-unsupported');
    expect(
      creationIssue(
        draftWith({ references: [{ assetId: 'a', role: 'reference-video', order: 0 }] }),
        capability({ modes: ['t2v', 'i2v', 'v2v'] }),
      ),
    ).toBe('reference-kind-unsupported');
  });

  it('草稿可往返存储；坏数据回落默认值而不是抛错', () => {
    const storage = memoryStorage();
    const draft = draftWith();
    writeCreationDraft(storage, draft);
    expect(readCreationDraft(storage, 99)).toEqual(draft);

    storage.setItem(CREATION_DRAFT_STORAGE_KEY, '{not json');
    expect(readCreationDraft(storage, 99).kind).toBe('agent');

    storage.setItem(CREATION_DRAFT_STORAGE_KEY, JSON.stringify({ kind: 'timeline' }));
    expect(readCreationDraft(storage, 99).kind).toBe('agent');
  });

  it('清除后回到默认草稿', () => {
    const storage = memoryStorage();
    writeCreationDraft(storage, draftWith());
    clearCreationDraft(storage);
    expect(storage.getItem(CREATION_DRAFT_STORAGE_KEY)).toBeNull();
    expect(readCreationDraft(storage).kind).toBe('agent');
  });

  it('S5-B3e：备份与主草稿分离，可读可清，坏数据返回 null', () => {
    const storage = memoryStorage();
    const draft = draftWith({ prompt: '覆盖前的草稿' });
    writeCreationDraftBackup(storage, draft);
    expect(storage.getItem(CREATION_DRAFT_BACKUP_KEY)).not.toBeNull();
    expect(readCreationDraftBackup(storage)?.prompt).toBe('覆盖前的草稿');
    // 主草稿不因备份而出现
    expect(storage.getItem(CREATION_DRAFT_STORAGE_KEY)).toBeNull();

    storage.setItem(CREATION_DRAFT_BACKUP_KEY, '{broken');
    expect(readCreationDraftBackup(storage)).toBeNull();

    writeCreationDraftBackup(storage, draft);
    clearCreationDraftBackup(storage);
    expect(readCreationDraftBackup(storage)).toBeNull();
  });
});
