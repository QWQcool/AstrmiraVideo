import { describe, expect, it } from 'vitest';
import { isAllowedEngineHost, isAllowedEngineUrl } from './statusProbe.js';

/**
 * 本地引擎**地址白名单**的口径（CONTRACT §2 / §19-1；PLAN §7-2）。
 *
 * ⚠️ V2.37（D56）：这个文件原先还测「MiniMax H3 档的配置自检」（`runLocalEngineSelfCheck` /
 * `isAllowedWorkdir` / `H3_WORKDIR` / `H3_TIER`）—— **那些函数与它们的用例已随该档撤掉一并删除**。
 * 撤掉的是"一个只有配置约定、没有执行实现的档位"，而**白名单本身一条都没变**
 * （它现在只服务 ComfyUI 实例，见 `comfyuiServers.ts`）。
 *
 * 纪律（不变）：探针不扫描硬件、不替访客判断设备能力、不回显型号与路径明文。
 */

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

  it('大小写与 IPv6 括号：归一后才判断（`LOCALHOST` / `[::1]` 同样放行）', () => {
    expect(isAllowedEngineHost('LOCALHOST')).toBe(true);
    expect(isAllowedEngineHost('[::1]')).toBe(true);
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

  it('**V2.37 之后它服务的是 ComfyUI 实例**（每台各校验一次，见 comfyuiServers.test.ts）', () => {
    // 这条不是新逻辑，而是把"职责变化"钉在测试里：白名单函数仍然只认回环 / 内网，
    // 而"谁在被校验"从"一个 H3 目录 + 一个 ComfyUI 地址"变成了"每一个配置好的 ComfyUI 实例"。
    expect(isAllowedEngineUrl('http://172.20.5.5:8188')).toBe(true);
    expect(isAllowedEngineUrl('http://172.32.5.5:8188')).toBe(false);
  });
});
