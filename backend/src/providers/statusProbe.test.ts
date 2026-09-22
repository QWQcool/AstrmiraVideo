import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  isAllowedEngineHost,
  isAllowedEngineUrl,
  isAllowedWorkdir,
  runLocalEngineSelfCheck,
} from './statusProbe.js';

/**
 * S5a / AC6：本地引擎**配置自检**的口径（CONTRACT §2 V1.8）。
 * 关键纪律：探针不扫描硬件、不替访客判断设备能力、不回显型号与路径。
 */

const TMP_DIR = mkdtempSync(path.join(tmpdir(), 'astrmira-probe-'));

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('isAllowedEngineHost（白名单：仅回环 / RFC1918）', () => {
  it('放行回环与内网', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '127.0.0.53',
      '::1',
      '10.1.2.3',
      '192.168.1.20',
      '172.16.0.9',
      '172.31.255.254',
    ]) {
      expect(isAllowedEngineHost(host), `${host} 应放行`).toBe(true);
    }
  });

  it('拒绝公网与元数据地址（PLAN §7-2 拒绝任意外部地址）', () => {
    for (const host of [
      'example.com',
      '8.8.8.8',
      '172.32.0.1', // 172.16~31 之外
      '169.254.169.254', // 云元数据
      '0.0.0.0',
      '203.0.113.7',
    ]) {
      expect(isAllowedEngineHost(host), `${host} 应拒绝`).toBe(false);
    }
  });
});

describe('isAllowedEngineUrl', () => {
  it('仅接受 http/https 且主机在白名单内', () => {
    expect(isAllowedEngineUrl('http://127.0.0.1:8188')).toBe(true);
    expect(isAllowedEngineUrl('http://192.168.1.5:8188')).toBe(true);
    expect(isAllowedEngineUrl('https://10.0.0.2:8188')).toBe(true);
  });

  it('拒绝公网 / 非法协议 / 垃圾串', () => {
    expect(isAllowedEngineUrl('http://example.com:8188')).toBe(false);
    expect(isAllowedEngineUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedEngineUrl('ftp://127.0.0.1')).toBe(false);
    expect(isAllowedEngineUrl('not-a-url')).toBe(false);
  });
});

describe('isAllowedWorkdir', () => {
  it('放行存在的绝对目录', () => {
    expect(isAllowedWorkdir(TMP_DIR)).toBe(true);
  });

  it('拒绝相对路径与不存在的路径', () => {
    expect(isAllowedWorkdir('relative/dir')).toBe(false);
    expect(isAllowedWorkdir(path.join(TMP_DIR, 'not-here'))).toBe(false);
  });
});

describe('runLocalEngineSelfCheck（配置事实陈述）', () => {
  it('两项都未配置 → available:false + 「本服务未配置本地引擎」', () => {
    const result = runLocalEngineSelfCheck({} as NodeJS.ProcessEnv);

    expect(result.available).toBe(false);
    expect(result.reason).toBe('本服务未配置本地引擎');
    expect(result.tier).toBeUndefined();
  });

  it('配置了存在的 H3_WORKDIR → available:true；档位由 H3_TIER 显式声明', () => {
    const result = runLocalEngineSelfCheck({
      H3_WORKDIR: TMP_DIR,
      H3_TIER: '2',
    } as NodeJS.ProcessEnv);

    expect(result.available).toBe(true);
    expect(result.tier).toBe(2);
  });

  it('未声明 H3_TIER 时 tier 缺省（不由探测推导）', () => {
    const result = runLocalEngineSelfCheck({ H3_WORKDIR: TMP_DIR } as NodeJS.ProcessEnv);

    expect(result.available).toBe(true);
    expect(result.tier).toBeUndefined();
  });

  it('非法 H3_TIER 忽略（不报错、不猜）', () => {
    const result = runLocalEngineSelfCheck({
      H3_WORKDIR: TMP_DIR,
      H3_TIER: '9',
    } as NodeJS.ProcessEnv);

    expect(result.available).toBe(true);
    expect(result.tier).toBeUndefined();
  });

  it('配置了不存在的路径 → available:false + 自检失败说明', () => {
    const result = runLocalEngineSelfCheck({
      H3_WORKDIR: path.join(TMP_DIR, 'missing'),
    } as NodeJS.ProcessEnv);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('自检失败');
    expect(result.reason).toContain('H3_WORKDIR');
  });

  it('配置了公网 ComfyUI 地址 → available:false（拒绝任意外部地址）', () => {
    const result = runLocalEngineSelfCheck({
      COMFYUI_BASE_URL: 'http://example.com:8188',
    } as NodeJS.ProcessEnv);

    expect(result.available).toBe(false);
    expect(result.reason).toContain('COMFYUI_BASE_URL');
  });

  it('回环 ComfyUI 地址可用', () => {
    const result = runLocalEngineSelfCheck({
      COMFYUI_BASE_URL: 'http://127.0.0.1:8188',
    } as NodeJS.ProcessEnv);

    expect(result.available).toBe(true);
  });

  it('脱敏：自检结果不得回显路径明文', () => {
    const failed = runLocalEngineSelfCheck({
      H3_WORKDIR: path.join(TMP_DIR, 'missing-xyz'),
    } as NodeJS.ProcessEnv);
    const ok = runLocalEngineSelfCheck({ H3_WORKDIR: TMP_DIR } as NodeJS.ProcessEnv);

    expect(failed.reason).not.toContain(TMP_DIR);
    expect(ok.reason).not.toContain(TMP_DIR);
  });

  it('文案纪律：不得出现对访问者设备的判断', () => {
    const cases = [
      runLocalEngineSelfCheck({} as NodeJS.ProcessEnv),
      runLocalEngineSelfCheck({ H3_WORKDIR: TMP_DIR } as NodeJS.ProcessEnv),
      runLocalEngineSelfCheck({
        H3_WORKDIR: path.join(TMP_DIR, 'x'),
      } as NodeJS.ProcessEnv),
    ];

    for (const result of cases) {
      expect(result.reason).not.toMatch(/你的设备|你的显存|你没有显卡|不支持你的/);
    }
  });
});
