import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';

import { openDatabase, type Db } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { SqliteJobQueue } from './SqliteJobQueue.js';

/**
 * B98 片 B：任务完成时探一次产物尺寸（V2.94）。
 *
 * 这条断言钉的是"**计划尺寸 ≠ 产物尺寸时，系统手里有事实**"：没有它，界面只能把
 * `requestSnapshot.resolution` 当成产物尺寸展示 —— 上游出别的大小时就成了撒谎。
 */

const request = {
  prompt: 'p',
  mode: 't2i',
  aspectRatio: '16:9',
  resolution: { width: 832, height: 480 },
  provider: 'host-comfyui',
} as VideoGenerateRequest;

describe('队列 · 完成时记录产物实测尺寸（B98 片 B）', () => {
  let dir: string;
  let db: Db;
  let store: TaskStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'astrmira-dim-'));
    db = openDatabase(':memory:');
    store = new TaskStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(taskId: string): void {
    store.insert({
      taskId,
      track: 'local',
      provider: 'host-comfyui',
      status: 'running',
      progressPercent: 50,
      requestSnapshot: request,
      warnings: [],
      submitting: false,
    });
  }

  it('图片产物：写入真实宽高（图片没有时长，必须是独立探测，不能复用视频探针）', async () => {
    const file = path.join(dir, 'out.png');
    await sharp({ create: { width: 96, height: 40, channels: 3, background: '#123456' } })
      .png()
      .toFile(file);
    seed('t-img');

    const queue = new SqliteJobQueue(store, undefined, dir);
    await queue.complete('t-img', { videoUrl: '', imageUrl: '/media/out.png' });

    // 探测是"终态之后"的 best-effort 异步，等它落地（不阻塞任务完成）
    for (let i = 0; i < 20 && store.get('t-img')?.outputWidth === undefined; i += 1) {
      await sleep(50);
    }
    const record = store.get('t-img');
    expect(record?.status).toBe('succeeded');
    expect(record?.outputWidth).toBe(96);
    expect(record?.outputHeight).toBe(40);
  });

  it('文件不在（已被淘汰）→ 不写尺寸，也不把任务改成失败', async () => {
    seed('t-missing');
    const queue = new SqliteJobQueue(store, undefined, dir);
    await queue.complete('t-missing', { videoUrl: '', imageUrl: '/media/nope.png' });
    await sleep(200);

    const record = store.get('t-missing');
    expect(record?.status).toBe('succeeded');
    expect(record?.outputWidth).toBeUndefined();
  });

  it('没配 outputsDir（单测/旧调用）→ 零 IO，行为与从前一致', async () => {
    seed('t-nodir');
    const queue = new SqliteJobQueue(store);
    await queue.complete('t-nodir', { videoUrl: '', imageUrl: '/media/whatever.png' });
    expect(store.get('t-nodir')?.outputWidth).toBeUndefined();
  });
});
