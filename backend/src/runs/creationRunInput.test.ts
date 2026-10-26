import { describe, expect, it } from 'vitest';
import {
  CREATION_RUN_MAX_VIDEO_STEPS,
  creationRunStepKey,
  validateCreationRunInput,
  type CreationRunInput,
} from '@astrmira/shared';

function step(id: string, kind: 'image' | 'video', overrides: Record<string, unknown> = {}) {
  return { id, kind, prompt: `${id} 提示词`, aspectRatio: '16:9' as const, ...overrides };
}

function input(steps: Array<ReturnType<typeof step>>, overrides: Record<string, unknown> = {}) {
  return {
    title: '雨夜霓虹',
    mode: 'unattended' as const,
    provider: 'fixture-local',
    steps,
    ...overrides,
  } as CreationRunInput;
}

describe('创作会话输入校验（S8-B1 / §29）', () => {
  it('合法输入通过：图片首帧 + 视频依赖', () => {
    const problem = validateCreationRunInput(
      input([
        step('img-1', 'image'),
        step('shot-1', 'video', { dependsOn: ['img-1'], durationSec: 5 }),
      ]),
    );
    expect(problem).toBeNull();
  });

  it('没有视频步骤 → 拒绝（成片目标是会话的存在理由）', () => {
    expect(validateCreationRunInput(input([step('img-1', 'image')]))).toContain('视频步骤');
  });

  it('视频步骤超过 16 → 拒绝（D75）', () => {
    const steps = [
      step('img-1', 'image'),
      ...Array.from({ length: CREATION_RUN_MAX_VIDEO_STEPS + 1 }, (_u, i) =>
        step(`shot-${i + 1}`, 'video', { dependsOn: ['img-1'] }),
      ),
    ];
    expect(validateCreationRunInput(input(steps))).toContain('16');
  });

  it('依赖不存在 / 依赖自己 / 依赖视频步骤（非首帧语义）→ 拒绝', () => {
    expect(validateCreationRunInput(input([
      step('shot-1', 'video', { dependsOn: ['ghost'] }),
    ]))).toContain('不存在');
    expect(validateCreationRunInput(input([
      step('shot-1', 'video', { dependsOn: ['shot-1'] }),
    ]))).toContain('自己');
    expect(validateCreationRunInput(input([
      step('shot-1', 'video'),
      step('shot-2', 'video', { dependsOn: ['shot-1'] }),
    ]))).toContain('图片步骤');
  });

  it('B93：用户参考 + 图片依赖 / 多参考 / 多依赖 → 明确拒绝', () => {
    expect(
      validateCreationRunInput(
        input([
          step('img-1', 'image'),
          step('shot-1', 'video', {
            dependsOn: ['img-1'],
            durationSec: 5,
            referenceAssetIds: ['asset-user'],
          }),
        ]),
      ),
    ).toContain('参考');

    expect(
      validateCreationRunInput(
        input([
          step('shot-1', 'video', {
            durationSec: 5,
            referenceAssetIds: ['asset-a', 'asset-b'],
          }),
        ]),
      ),
    ).toContain('参考');

    expect(
      validateCreationRunInput(
        input([
          step('img-1', 'image'),
          step('img-2', 'image'),
          step('shot-1', 'video', {
            dependsOn: ['img-1', 'img-2'],
            durationSec: 5,
          }),
        ]),
      ),
    ).toContain('依赖');
  });

  it('依赖成环 → 拒绝并给出路径', () => {
    // 图片步骤互依构环（video→video 会被"只能依赖图片步骤"先拦住，到不了环检测）
    const bad = input([
      step('shot-1', 'video', { dependsOn: ['img-1'] }),
      step('img-1', 'image', { dependsOn: ['img-2'] }),
      step('img-2', 'image', { dependsOn: ['img-1'] }),
    ]);
    expect(validateCreationRunInput(bad)).toContain('成环');
  });

  it('幂等键确定性：同 intent 同键，attempt 变则换键', () => {
    expect(creationRunStepKey('r1', 'shot-1', 0)).toBe('run:r1:shot-1:a0');
    expect(creationRunStepKey('r1', 'shot-1', 0)).toBe(creationRunStepKey('r1', 'shot-1', 0));
    expect(creationRunStepKey('r1', 'shot-1', 1)).not.toBe(creationRunStepKey('r1', 'shot-1', 0));
  });
});
