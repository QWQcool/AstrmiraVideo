import { describe, expect, it } from 'vitest';
import type { ComfyUiServerStatus, ProviderStatus } from '@astrmira/shared';
import {
  DEFAULT_COMFY_ENGINE_ID,
  comfyUiEngineOptions,
  isComfyUiEngine,
  providerLabel,
} from './engineOptions';

/**
 * 执行引擎选项（V2.36 多实例）单测。
 *
 * 盯两件事（都会**静默出错**，不会报任何异常）：
 * 1. **几台配置 → 几个选项**（少列一台 = 用户以为那台不存在；多列一台 = 点了必然 503）；
 * 2. **显示名不能吞掉实例名**（多台时都叫"本地 ComfyUI"，用户根本分不清选了哪台）。
 */

function server(overrides: Partial<ComfyUiServerStatus> = {}): ComfyUiServerStatus {
  return {
    id: DEFAULT_COMFY_ENGINE_ID,
    label: '默认引擎',
    available: true,
    ...overrides,
  };
}

function status(servers: ComfyUiServerStatus[], reason?: string): ProviderStatus {
  return {
    cloud: { available: false, provider: 'volcano-seedance', acceptsClientKey: true },
    local: { available: false, provider: 'minimax-h3' },
    comfyui: {
      available: servers.some((item) => item.available),
      provider: 'comfyui',
      servers,
      ...(reason === undefined ? {} : { reason }),
    },
    llm: { available: false, provider: 'openai-compatible', acceptsClientKey: true },
    defaultProvider: 'cloud-volcano-seedance',
  };
}

describe('comfyUiEngineOptions（多实例）', () => {
  it('状态还没拿到（null）→ 仍给一项默认档，并如实说"状态未知"', () => {
    const options = comfyUiEngineOptions(null);
    expect(options).toEqual([
      {
        id: DEFAULT_COMFY_ENGINE_ID,
        label: '本地 ComfyUI',
        configured: false,
        hint: '本地 ComfyUI 状态未知',
      },
    ]);
  });

  it('没配任何一台（servers 为空）→ 一项默认档 + 段级 reason（开关保持可选）', () => {
    const options = comfyUiEngineOptions(status([], '本服务未配置 ComfyUI（缺 COMFYUI_BASE_URL）'));
    expect(options).toHaveLength(1);
    expect(options[0]?.id).toBe(DEFAULT_COMFY_ENGINE_ID);
    expect(options[0]?.hint).toContain('未配置');
  });

  it('只配一台默认实例 → 观感与 V2.35 完全一致（就叫「本地 ComfyUI」）', () => {
    const options = comfyUiEngineOptions(status([server()]));
    expect(options).toHaveLength(1);
    expect(options[0]?.label).toBe('本地 ComfyUI');
    expect(options[0]?.configured).toBe(true);
    expect(options[0]?.hint).toContain('地址合规');
  });

  it('多台 → 逐台一项、顺序保持、**各自带实例名**（否则分不清是哪一台）', () => {
    const options = comfyUiEngineOptions(
      status([
        server({ label: '默认引擎' }),
        server({ id: 'host-comfyui:office', label: '办公室的 3080' }),
        server({ id: 'host-comfyui:home', label: '家里的 5090' }),
      ]),
    );
    expect(options.map((item) => item.id)).toEqual([
      'host-comfyui',
      'host-comfyui:office',
      'host-comfyui:home',
    ]);
    expect(options.map((item) => item.label)).toEqual([
      'ComfyUI · 默认引擎',
      'ComfyUI · 办公室的 3080',
      'ComfyUI · 家里的 5090',
    ]);
  });

  it('只有一台具名实例 → **不能把它的名字吞掉**（不能显示成泛泛的「本地 ComfyUI」）', () => {
    const options = comfyUiEngineOptions(
      status([server({ id: 'host-comfyui:office', label: '办公室的 3080' })]),
    );
    expect(options[0]?.id).toBe('host-comfyui:office');
    expect(options[0]?.label).toBe('ComfyUI · 办公室的 3080');
  });

  it('不合规那一台 → configured:false + 原因照实（不改写、不隐瞒）', () => {
    const options = comfyUiEngineOptions(
      status([
        server({ id: 'host-comfyui:ok', label: 'ok' }),
        server({
          id: 'host-comfyui:public',
          label: 'public',
          available: false,
          reason: '地址不合规：本地引擎只允许回环或内网地址（http / https）',
        }),
      ]),
    );
    expect(options[0]?.configured).toBe(true);
    expect(options[1]?.configured).toBe(false);
    expect(options[1]?.hint).toContain('回环或内网');
  });
});

describe('providerLabel / isComfyUiEngine', () => {
  it('固定档位的显示名', () => {
    expect(providerLabel('cloud-volcano-seedance', null)).toBe('云端 Seedance');
    // V2.37（D56）：这一档已撤 —— 显示名要如实（历史任务 / 旧编排里仍可能出现这个值）
    expect(providerLabel('local-minimax-h3', null)).toBe('本地 MiniMax H3（已撤）');
    expect(providerLabel('fixture-local', null)).toBe('开发期夹具');
  });

  it('具名实例：有 /status 时用实例 label，没有时至少把名字显示出来', () => {
    const withStatus = providerLabel(
      'host-comfyui:office',
      status([server({ id: 'host-comfyui:office', label: '办公室的 3080' })]),
    );
    expect(withStatus).toBe('ComfyUI · 办公室的 3080');
    // 刚改完配置、/status 还没刷新 → 也不能显示空白
    expect(providerLabel('host-comfyui:office', null)).toBe('ComfyUI · office');
  });

  it('未知 id **原样返回**（显示一个 id 也比空白强）', () => {
    expect(providerLabel('something-else', null)).toBe('something-else');
  });

  it('isComfyUiEngine 认"默认 + 具名实例"，不认别的档', () => {
    expect(isComfyUiEngine('host-comfyui')).toBe(true);
    expect(isComfyUiEngine('host-comfyui:office')).toBe(true);
    expect(isComfyUiEngine('local-minimax-h3')).toBe(false);
    expect(isComfyUiEngine('cloud-volcano-seedance')).toBe(false);
  });
});
