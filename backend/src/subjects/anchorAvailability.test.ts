import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { anchorAvailability, withAnchorAvailability } from './anchorAvailability.js';

/**
 * B103 片 B：定妆图"现在还在不在"（V2.100）。
 *
 * 为什么值得单独测：锚点只存一个引用（`task:<id>` 或资产 id），
 * 产物被容量淘汰、任务被清理之后**引用本身永远不报错** ——
 * 它只会在下一次生成时变成一个读不到的文件，最后以"上游报错"收场。
 * 这个函数是唯一能把那句话提前说出来的地方，所以三种状态必须分得清。
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function outputsDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-anchor-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  return dir;
}

describe('锚点可用性（B103 片 B）', () => {
  it('没有锚点 → undefined（"还没出定妆图"与"出过但没了"必须分开）', () => {
    const dir = outputsDir();
    expect(anchorAvailability(undefined, { taskById: () => null, outputsDir: dir })).toBeUndefined();
    expect(anchorAvailability('', { taskById: () => null, outputsDir: dir })).toBeUndefined();
  });

  it('task: 锚点：任务成功且产物文件在 → true', () => {
    const dir = outputsDir();
    writeFileSync(path.join(dir, 'shot.png'), 'x');
    const available = anchorAvailability('task:t1', {
      taskById: () => ({ status: 'succeeded', outputImageUrl: '/media/shot.png' }),
      outputsDir: dir,
    });
    expect(available).toBe(true);
  });

  it('task: 锚点：产物被清理（文件没了）→ false', () => {
    const dir = outputsDir();
    const available = anchorAvailability('task:t1', {
      taskById: () => ({ status: 'succeeded', outputImageUrl: '/media/gone.png' }),
      outputsDir: dir,
    });
    expect(available).toBe(false);
  });

  it('task: 锚点：任务不存在 / 未成功 → false（不猜"也许还能用"）', () => {
    const dir = outputsDir();
    expect(anchorAvailability('task:nope', { taskById: () => null, outputsDir: dir })).toBe(false);
    expect(
      anchorAvailability('task:failed', {
        taskById: () => ({ status: 'failed' }),
        outputsDir: dir,
      }),
    ).toBe(false);
  });

  it('资产锚点：按扩展名找文件（jpg/png 都可能）', () => {
    const dir = outputsDir();
    writeFileSync(path.join(dir, 'assets', 'a1.jpg'), 'x');
    writeFileSync(path.join(dir, 'assets', 'a2.png'), 'x');
    expect(anchorAvailability('a1', { taskById: () => null, outputsDir: dir })).toBe(true);
    expect(anchorAvailability('a2', { taskById: () => null, outputsDir: dir })).toBe(true);
    expect(anchorAvailability('a3', { taskById: () => null, outputsDir: dir })).toBe(false);
  });

  it('withAnchorAvailability：没有锚点时原样返回（不加字段）', () => {
    const dir = outputsDir();
    const subject = { id: 's1', anchorAssetId: undefined };
    const shaped = withAnchorAvailability(subject, { taskById: () => null, outputsDir: dir });
    expect('anchorAvailable' in shaped).toBe(false);
  });
});
