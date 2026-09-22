import { describe, expect, it } from 'vitest';
import type { VideoGenerateRequest } from '@astrmira/shared';
import {
  aspectRatioToUpstream,
  buildSeedanceSubmitBody,
  classifyHttpFailure,
  mapUpstreamStatus,
  parseSeedanceTask,
  readUpstreamTaskId,
  readUpstreamVideoUrl,
  resolutionToTier,
} from './seedanceProtocol.js';

/**
 * 协议适配层的断言（S5b）。
 *
 * ⚠️ 这些测试证明的是**"代码与我们对协议的理解一致"**，不是"上游就是这么返回的"。
 * 后者只能由 AC2 的真实冒烟证明；本文件的价值在于：一旦上游字段与假设不符，
 * 改动面被限制在这一层，而且这里的断言会明确告诉你哪条假设被打破。
 */

const baseRequest: VideoGenerateRequest = {
  prompt: '雨夜街头，女孩撑伞回头',
  mode: 't2v',
  aspectRatio: '16:9',
  provider: 'cloud-volcano-seedance',
};

describe('buildSeedanceSubmitBody（契约请求 → 上游请求体）', () => {
  it('T2V：参数以 `--` 尾缀拼进 text，且 model 就是用户填的那个', () => {
    const body = buildSeedanceSubmitBody(
      {
        ...baseRequest,
        params: { durationSec: 5, seed: 12345 },
        resolution: { width: 832, height: 480 },
      },
      { model: 'doubao-seedance-1-0-pro-250528' },
    );

    expect(body.model).toBe('doubao-seedance-1-0-pro-250528');
    expect(body.content).toHaveLength(1);

    const text = (body.content[0] as { text: string }).text;
    expect(text.startsWith('雨夜街头，女孩撑伞回头')).toBe(true);
    expect(text).toContain('--duration 5');
    expect(text).toContain('--ratio 16:9');
    expect(text).toContain('--resolution 480p');
    expect(text).toContain('--seed 12345');
    expect(text).toContain('--watermark false');
  });

  it('I2V：图片作为独立元素并带 role，首尾帧都可表达', () => {
    const body = buildSeedanceSubmitBody(baseRequest, {
      model: 'm',
      imageUrls: { first_frame: 'data:image/png;base64,AAA', last_frame: 'https://x/b.jpg' },
    });

    const images = body.content.filter((item) => item.type === 'image_url');
    expect(images).toHaveLength(2);
    expect(images.map((item) => (item as { role: string }).role)).toEqual([
      'first_frame',
      'last_frame',
    ]);
  });

  it('不传图时不产生空元素（避免上游因空 url 报 400）', () => {
    const body = buildSeedanceSubmitBody(baseRequest, { model: 'm', imageUrls: { first_frame: '' } });
    expect(body.content.filter((item) => item.type === 'image_url')).toHaveLength(0);
  });

  it('覆盖项优先于推导值', () => {
    const body = buildSeedanceSubmitBody(
      { ...baseRequest, resolution: { width: 832, height: 480 } },
      { model: 'm', resolutionOverride: '1080p' },
    );
    expect((body.content[0] as { text: string }).text).toContain('--resolution 1080p');
  });
});

describe('取值映射', () => {
  it('分辨率按短边归档', () => {
    expect(resolutionToTier(832, 480)).toBe('480p');
    expect(resolutionToTier(480, 832)).toBe('480p');
    expect(resolutionToTier(1280, 720)).toBe('720p');
    expect(resolutionToTier(1920, 1080)).toBe('1080p');
  });

  it('前端清晰度档的**每一格**都落在预期档位（跨端一致性守卫）', () => {
    // 与 `frontend/src/lib/format.ts` 的 TARGET_SIZES 逐格对齐：
    // 前端表改动而这里没同步（或阈值被挪动）→ 本用例红，避免"界面显示 720p、上游收到 480p"。
    expect(resolutionToTier(832, 480)).toBe('480p');
    expect(resolutionToTier(480, 832)).toBe('480p');
    expect(resolutionToTier(480, 480)).toBe('480p');

    expect(resolutionToTier(1280, 704)).toBe('720p');
    expect(resolutionToTier(704, 1280)).toBe('720p');
    expect(resolutionToTier(704, 704)).toBe('720p');

    expect(resolutionToTier(1920, 1056)).toBe('1080p');
    expect(resolutionToTier(1056, 1920)).toBe('1080p');
    expect(resolutionToTier(1056, 1056)).toBe('1080p');
  });

  it('画幅显式映射：契约新增比例时应当报错而不是静默传错值', () => {
    expect(aspectRatioToUpstream('16:9')).toBe('16:9');
    expect(aspectRatioToUpstream('9:16')).toBe('9:16');
    expect(aspectRatioToUpstream('1:1')).toBe('1:1');
  });

  it('状态映射：未知值一律当 running（绝不能把未知当成功）', () => {
    expect(mapUpstreamStatus('queued')).toBe('queued');
    expect(mapUpstreamStatus('running')).toBe('running');
    expect(mapUpstreamStatus('succeeded')).toBe('succeeded');
    expect(mapUpstreamStatus('failed')).toBe('failed');
    expect(mapUpstreamStatus('cancelled')).toBe('cancelled');
    expect(mapUpstreamStatus('expired')).toBe('cancelled');
    expect(mapUpstreamStatus('brand_new_state')).toBe('running');
    expect(mapUpstreamStatus(undefined)).toBe('running');
  });
});

describe('响应解析', () => {
  it('任务 id 兼容 id / task_id 两种写法，缺失返回 undefined', () => {
    expect(readUpstreamTaskId({ id: 'cgt-1' })).toBe('cgt-1');
    expect(readUpstreamTaskId({ task_id: 'cgt-2' })).toBe('cgt-2');
    expect(readUpstreamTaskId({})).toBeUndefined();
    expect(readUpstreamTaskId(null)).toBeUndefined();
  });

  it('视频地址兼容 content.video_url 与顶层 video_url', () => {
    expect(readUpstreamVideoUrl({ content: { video_url: 'https://v/1.mp4' } })).toBe('https://v/1.mp4');
    expect(readUpstreamVideoUrl({ video_url: 'https://v/2.mp4' })).toBe('https://v/2.mp4');
    expect(readUpstreamVideoUrl({ content: {} })).toBeUndefined();
  });

  it('成功：状态 succeeded + 地址齐全', () => {
    const parsed = parseSeedanceTask({
      id: 'cgt-1',
      status: 'succeeded',
      content: { video_url: 'https://v/1.mp4' },
    });

    expect(parsed.status).toBe('succeeded');
    expect(parsed.videoUrl).toBe('https://v/1.mp4');
    expect(parsed.progressPercent).toBe(100);
  });

  it('**成功但没地址**：必须转成失败并说明原因，不许静默当成功', () => {
    const parsed = parseSeedanceTask({ id: 'cgt-1', status: 'succeeded', content: {} });

    expect(parsed.status).toBe('failed');
    expect(parsed.error?.code).toBe('UPSTREAM_ERROR');
    expect(parsed.error?.message).toContain('video_url');
  });

  it('失败：带上游错误码与描述', () => {
    const parsed = parseSeedanceTask({
      status: 'failed',
      error: { code: 'InvalidParameter', message: 'prompt too long' },
    });

    expect(parsed.status).toBe('failed');
    expect(parsed.error?.code).toBe('UPSTREAM_ERROR');
    expect(parsed.error?.message).toContain('InvalidParameter');
    expect(parsed.error?.message).toContain('prompt too long');
  });

  it('进行中：给区间进度，且永不越过 100', () => {
    expect(parseSeedanceTask({ status: 'queued' }).progressPercent).toBe(5);
    expect(parseSeedanceTask({ status: 'running' }).progressPercent).toBe(45);
    for (const status of ['queued', 'running', 'weird']) {
      expect(parseSeedanceTask({ status }).progressPercent).toBeLessThan(100);
    }
  });

  it('完全不是对象时抛错（让上层按"无法确认"处理，而不是当成功）', () => {
    expect(() => parseSeedanceTask('oops')).toThrow(/无法解析/);
  });
});

describe('HTTP 失败归类（"明确返回"与"结果不明"的分界线）', () => {
  it('401 / 403 → KEY_INVALID（terminal，重试无意义）', () => {
    for (const status of [401, 403]) {
      const result = classifyHttpFailure(status, { error: { code: 'AuthFailed', message: 'bad key' } });
      expect(result.code).toBe('KEY_INVALID');
      expect(result.message).toContain('bad key');
    }
  });

  it('429 → UPSTREAM_ERROR（明确被告知"稍后再来"，可重试）', () => {
    const result = classifyHttpFailure(429, undefined);
    expect(result.code).toBe('UPSTREAM_ERROR');
    expect(result.dispositionOverride).toBeUndefined();
  });

  it('5xx → UPSTREAM_ERROR（响应体可读 = 明确返回）', () => {
    const result = classifyHttpFailure(502, { error: { code: 'InternalError', message: 'boom' } });
    expect(result.code).toBe('UPSTREAM_ERROR');
    expect(result.dispositionOverride).toBeUndefined();
  });

  it('其余 4xx → UPSTREAM_ERROR 但显式标 terminal（原样重试只会重复失败）', () => {
    const result = classifyHttpFailure(400, { error: { code: 'InvalidParameter', message: 'ratio 不支持' } });
    expect(result.code).toBe('UPSTREAM_ERROR');
    expect(result.dispositionOverride).toBe('terminal');
    expect(result.message).toContain('ratio 不支持');
  });
});
