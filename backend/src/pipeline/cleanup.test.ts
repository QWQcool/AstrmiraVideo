import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanupTaskTemp, taskTmpDir } from './cleanup.js';

/**
 * 防线 3：中间帧目录「合成结束立即物理删除」。
 * 断言口径 = **目录不存在**（PLAN §8 施工避坑第 5 条：日志不是事实）。
 */

const TEST_TMP_ROOT = path.join(process.cwd(), '.tmp', 'cleanup-test-root');
const createdDirs: string[] = [];

afterAll(() => {
  // 测试自身清理（不依赖被测函数）
  for (const dir of createdDirs) {
    cleanupTaskTemp(path.basename(dir), TEST_TMP_ROOT);
  }
});

describe('cleanupTaskTemp（防线 3）', () => {
  it('删除存在的任务临时目录（含中间帧文件）', async () => {
    const taskId = 'cleanup-case-1';
    const dir = taskTmpDir(taskId, TEST_TMP_ROOT);
    createdDirs.push(dir);

    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'frame-0001.png'), 'fake-frame');
    expect(existsSync(dir)).toBe(true);

    await cleanupTaskTemp(taskId, TEST_TMP_ROOT);

    // 断言口径：目录不存在（而不是"没有报错"）
    expect(existsSync(dir)).toBe(false);
  });

  it('目录不存在时也安全（幂等）', async () => {
    await expect(cleanupTaskTemp('never-existed', TEST_TMP_ROOT)).resolves.toBeUndefined();
  });

  it('只删目标任务目录，不误伤兄弟任务', async () => {
    const victim = taskTmpDir('cleanup-victim', TEST_TMP_ROOT);
    const bystander = taskTmpDir('cleanup-bystander', TEST_TMP_ROOT);
    createdDirs.push(victim, bystander);

    mkdirSync(victim, { recursive: true });
    mkdirSync(bystander, { recursive: true });

    await cleanupTaskTemp('cleanup-victim', TEST_TMP_ROOT);

    expect(existsSync(victim)).toBe(false);
    expect(existsSync(bystander)).toBe(true);
  });
});
