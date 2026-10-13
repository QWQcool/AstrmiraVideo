import { afterEach, describe, expect, it } from 'vitest';
import { getProvider } from './registry.js';

/**
 * `host-comfyui` 的**注册门控**（CONTRACT §19-1 / A1 片 B / D53）。
 *
 * 为什么这几条值得单独测：门控写错的后果不是"报错"，而是**静默地多一个入口**——
 * 比如把外网地址也放行，就等于给部署者的内网开了一个 SSRF 探测面；
 * 而"未配却返回一个实例"会让界面显示"本地 ComfyUI 可用"，用户提交后才发现连不上。
 * （覆盖率阈值先发现了这一条：新加的分支没人测，函数覆盖率掉到 80% < 90%。）
 */

const ORIGINAL = process.env.COMFYUI_BASE_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.COMFYUI_BASE_URL;
  else process.env.COMFYUI_BASE_URL = ORIGINAL;
});

describe('registry · host-comfyui 门控', () => {
  it('未配 COMFYUI_BASE_URL → null（**不假装可用**）', () => {
    delete process.env.COMFYUI_BASE_URL;
    expect(getProvider('host-comfyui')).toBeNull();
  });

  it('空字符串等同于未配（`.env` 里留了个空值是最常见的写法）', () => {
    process.env.COMFYUI_BASE_URL = '   ';
    expect(getProvider('host-comfyui')).toBeNull();
  });

  it('回环地址 → 拿到实例', () => {
    process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
    expect(getProvider('host-comfyui')?.id).toBe('host-comfyui');
  });

  it('RFC1918 内网地址也允许（ComfyUI 常常装在另一台机器上）', () => {
    process.env.COMFYUI_BASE_URL = 'http://192.168.1.20:8188';
    expect(getProvider('host-comfyui')?.id).toBe('host-comfyui');
  });

  it('**外网地址一律拒绝**（同一个 env 写错就当作没配 —— 那是 SSRF 面，不是"方便"）', () => {
    process.env.COMFYUI_BASE_URL = 'http://comfy.example.com:8188';
    expect(getProvider('host-comfyui')).toBeNull();
  });

  it('非 http(s) 协议也拒绝（file:// 之类）', () => {
    process.env.COMFYUI_BASE_URL = 'file:///D:/ComfyUI';
    expect(getProvider('host-comfyui')).toBeNull();
  });
});
