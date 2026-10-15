import { afterEach, describe, expect, it } from 'vitest';
import { buildProviderStatus } from './providers.js';

/**
 * `/api/providers/status` 的 `comfyui` 段（V2.31 / A1 片 C / CONTRACT §19-1）。
 *
 * 四条判定都是**本服务的配置事实**（不是对访问者设备的判断 —— V1.8/D22 的文案纪律）。
 * 这里逐条钉住，因为写错的后果是**安全**层面的：本地轨默认不向访客开放（`EXPOSE_HOST_LOCAL_TRACK`），
 * 一旦判定顺序写反（"配了地址就可用"），ComfyUI 就跑在部署者的机器上等着公网访客来用。
 */

const ORIGINAL_BASE = process.env.COMFYUI_BASE_URL;
const ORIGINAL_EXPOSE = process.env.EXPOSE_HOST_LOCAL_TRACK;
const ORIGINAL_WORKDIR = process.env.H3_WORKDIR;

afterEach(() => {
  if (ORIGINAL_BASE === undefined) delete process.env.COMFYUI_BASE_URL;
  else process.env.COMFYUI_BASE_URL = ORIGINAL_BASE;
  if (ORIGINAL_EXPOSE === undefined) delete process.env.EXPOSE_HOST_LOCAL_TRACK;
  else process.env.EXPOSE_HOST_LOCAL_TRACK = ORIGINAL_EXPOSE;
  if (ORIGINAL_WORKDIR === undefined) delete process.env.H3_WORKDIR;
  else process.env.H3_WORKDIR = ORIGINAL_WORKDIR;
});

describe('providers/status · comfyui 段', () => {
  it('默认（未开本地轨）→ 不可用，且原因是"未向访客开放本地轨"（**不是**"你的设备不行"）', () => {
    delete process.env.EXPOSE_HOST_LOCAL_TRACK;
    process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
    const status = buildProviderStatus();
    expect(status.comfyui.available).toBe(false);
    expect(status.comfyui.reason).toContain('未向访客开放');
  });

  it('开了本地轨但没配地址 → 不可用，原因点名缺哪个 env', () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    delete process.env.COMFYUI_BASE_URL;
    const status = buildProviderStatus();
    expect(status.comfyui.available).toBe(false);
    expect(status.comfyui.reason).toContain('COMFYUI_BASE_URL');
  });

  it('地址是外网 → 不可用（与 provider 注册点同一份白名单，防 SSRF）', () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    process.env.COMFYUI_BASE_URL = 'http://comfy.example.com:8188';
    const status = buildProviderStatus();
    expect(status.comfyui.available).toBe(false);
    expect(status.comfyui.reason).toContain('回环或内网');
  });

  it('开了本地轨 + 回环地址 → 可用，且**不承诺能不能跑**（模式能力在提交时判定）', () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
    const status = buildProviderStatus();
    expect(status.comfyui.available).toBe(true);
    expect(status.comfyui.reason).toContain('提交时判定');
  });

  it('内网地址同样可用（ComfyUI 装在另一台机器上是常见形态）', () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    process.env.COMFYUI_BASE_URL = 'http://192.168.1.20:8188';
    expect(buildProviderStatus().comfyui.available).toBe(true);
  });

  it('**一个后端一段**：只配 ComfyUI 时，`local`（自装 H3）必须仍是不可用（V2.32 修复）', () => {
    // 这条钉住的是一次真实的误导：此前 `local.available` 只要看到 COMFYUI_BASE_URL 合规就为 true，
    // 于是界面上"本地 MiniMax H3 可用"（假的，那个 provider 没实现、提交必 503）
    // 与"本地 ComfyUI 可用"（真的）会同时亮。
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
    delete process.env.H3_WORKDIR;

    const status = buildProviderStatus();
    expect(status.comfyui.available).toBe(true);
    expect(status.local.available).toBe(false);
    // V2.37（D56）：这一档**已撤掉** —— 它不再是"缺 H3_WORKDIR"，而是"没有了"
    expect(status.local.reason).toContain('已撤掉');
  });

  it('reason 里不得出现硬件型号 / 显存数字（§2 / D27 的文案纪律同样适用于新段）', () => {
    process.env.EXPOSE_HOST_LOCAL_TRACK = '1';
    process.env.COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
    const reason = buildProviderStatus().comfyui.reason ?? '';
    expect(/(RTX|GTX|A100|H100|[0-9]+\s?GB)/i.test(reason)).toBe(false);
  });
});
