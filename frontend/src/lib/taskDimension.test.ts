import { describe, expect, it } from 'vitest';
import type { TaskProgress } from '@astrmira/shared';
import { requestedDimensionMismatch } from './taskDimension';

function task(overrides: {
  resolution?: { width: number; height: number };
  dimension?: { width: number; height: number };
}): Pick<TaskProgress, 'requestSnapshot' | 'outputDimension'> {
  return {
    requestSnapshot: {
      prompt: 'p',
      mode: 't2v',
      aspectRatio: '16:9',
      provider: 'host-comfyui',
      ...(overrides.resolution === undefined ? {} : { resolution: overrides.resolution }),
    } as TaskProgress['requestSnapshot'],
    ...(overrides.dimension === undefined ? {} : { outputDimension: overrides.dimension }),
  };
}

describe('产物尺寸 vs 计划尺寸（B98 片 B）', () => {
  it('两边一致 → 不报（这是常态，不该有提示）', () => {
    expect(
      requestedDimensionMismatch(
        task({ resolution: { width: 832, height: 480 }, dimension: { width: 832, height: 480 } }),
      ),
    ).toBe(false);
  });

  it('宽或高任一不同 → 报', () => {
    expect(
      requestedDimensionMismatch(
        task({ resolution: { width: 832, height: 480 }, dimension: { width: 1280, height: 480 } }),
      ),
    ).toBe(true);
    expect(
      requestedDimensionMismatch(
        task({ resolution: { width: 832, height: 480 }, dimension: { width: 832, height: 720 } }),
      ),
    ).toBe(true);
  });

  it('没探到实际尺寸 → 不报（无话可说就不要说）', () => {
    expect(requestedDimensionMismatch(task({ resolution: { width: 832, height: 480 } }))).toBe(false);
  });

  it('请求里没有 resolution（老客户端/老任务）→ 不报（没有可比对象）', () => {
    expect(requestedDimensionMismatch(task({ dimension: { width: 1024, height: 576 } }))).toBe(false);
  });
});
