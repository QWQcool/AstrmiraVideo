import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from './db.js';
import { TaskStore, toTaskProgress } from './taskStore.js';

/**
 * 音频产物列（V2.103 / CONTRACT §4 `outputAudioUrl`）。
 *
 * 为什么专门钉一条：V2.40 加图片产物时**只加了列没加读取映射**，症状是
 * "真出了图、接口里却看不到产物地址"—— 类型和单测都绿，只有真机能发现。
 * 所以这里把 insert → rowToRecord → toTaskProgress 的**整条读回路径**走一遍。
 */

let dir: string;
let store: TaskStore;
/** SQLite 连接必须显式关：Windows 上没关就删目录会 EBUSY（`app.db-shm` 被占） */
let db: ReturnType<typeof openDatabase>;

const AUDIO_SNAPSHOT = {
  prompt: '雪停以后，院子里只剩那枚红苹果。',
  mode: 'tts' as const,
  aspectRatio: '16:9' as const,
  provider: 'mimo-tts' as const,
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'astrmira-taskstore-audio-'));
  db = openDatabase(path.join(dir, 'app.db'));
  store = new TaskStore(db);
});

afterAll(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('音频产物落库与读回', () => {
  it('insert → get → toTaskProgress 都带 outputAudioUrl', () => {
    store.insert({
      taskId: 'audio-1',
      track: 'cloud',
      provider: 'mimo-tts',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: AUDIO_SNAPSHOT,
      outputAudioUrl: '/media/audio-1.wav',
      warnings: [],
      submitting: false,
      executedBy: 'cloud',
    });

    const record = store.get('audio-1');
    expect(record?.outputAudioUrl).toBe('/media/audio-1.wav');
    expect(record?.outputVideoUrl).toBeUndefined();

    const progress = toTaskProgress(record!);
    expect(progress.outputAudioUrl).toBe('/media/audio-1.wav');
    // 关键：音频**不许**被写成 video（那会变成"任务成功但拿到一个播不了的 mp4"）
    expect(progress.outputVideoUrl).toBeUndefined();
  });

  it('update 能清空音频产物（容量淘汰 / 手动删除后不指向 404 地址）', () => {
    store.update('audio-1', { outputAudioUrl: undefined });
    expect(store.get('audio-1')?.outputAudioUrl).toBeUndefined();
  });

  it('容量淘汰的候选查询认得音频产物', () => {
    store.insert({
      taskId: 'audio-2',
      track: 'local',
      provider: 'host-stable-audio',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: {
        prompt: 'soft piano',
        mode: 'bgm' as const,
        aspectRatio: '16:9' as const,
        provider: 'host-stable-audio' as const,
      },
      outputAudioUrl: '/media/audio-2.wav',
      warnings: [],
      submitting: false,
      executedBy: 'host-local',
    });

    const candidates = store.listOldestWithOutput(50).map((item) => item.taskId);
    expect(candidates).toContain('audio-2');
  });
});
