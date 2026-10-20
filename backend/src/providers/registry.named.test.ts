import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getProvider } from './registry.js';

/**
 * registry 的**具名实例**分流（CONTRACT §19-1 / §22）。
 *
 * 这两条路径此前只覆盖了默认实例：`host-comfyui` 与 `http-service` 的具名 id
 * （`host-comfyui:<name>` / `http-service:<name>`）没有任何测试，
 * 覆盖率闸门因此把 `registry.ts` 的函数覆盖率卡在 90% 以下（CI 连续红）。
 *
 * 这里不测 provider 的内部实现，只钉住「按 id 找到那一台；找不到就 null」——
 * 门控写错的后果是静默多一个入口或假装可用，而不是抛错。
 */

const ENV_KEYS = ['COMFYUI_SERVERS_FILE', 'HTTP_SERVICES_FILE', 'COMFYUI_BASE_URL', 'FAULT_INJECT'] as const;
const ORIGINAL = new Map<string, string | undefined>();
let dir = '';

beforeEach(() => {
  for (const key of ENV_KEYS) ORIGINAL.set(key, process.env[key]);
  dir = mkdtempSync(join(tmpdir(), 'astrmira-registry-'));
  delete process.env.COMFYUI_BASE_URL;
  delete process.env.FAULT_INJECT;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  ORIGINAL.clear();
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(name: string, value: unknown): string {
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(value), 'utf8');
  return file;
}

describe('registry · 具名实例', () => {
  it('host-comfyui:<name> 从实例文件取到那一台', () => {
    process.env.COMFYUI_SERVERS_FILE = writeJson('comfy.json', [
      { name: 'studio', label: '工作室', url: 'http://127.0.0.1:8188' },
    ]);

    const provider = getProvider('host-comfyui:studio');
    expect(provider?.id).toBe('host-comfyui:studio');
  });

  it('host-comfyui:<name> 找不到时返回 null（不回落默认实例）', () => {
    process.env.COMFYUI_SERVERS_FILE = writeJson('comfy.json', [
      { name: 'studio', url: 'http://127.0.0.1:8188' },
    ]);

    expect(getProvider('host-comfyui:missing')).toBeNull();
  });

  it('http-service:<name> 从服务文件取到那一台', () => {
    process.env.HTTP_SERVICES_FILE = writeJson('http.json', [
      {
        name: 'demo',
        baseUrl: 'http://127.0.0.1:9999',
        modes: ['t2v'],
        submit: { path: '/submit' },
        outputs: { video: { path: 'video_url', kind: 'video' } },
      },
    ]);

    const provider = getProvider('http-service:demo');
    expect(provider?.id).toBe('http-service:demo');
  });

  it('http-service:<name> 找不到时返回 null（没有默认实例）', () => {
    process.env.HTTP_SERVICES_FILE = writeJson('http.json', [
      {
        name: 'demo',
        baseUrl: 'http://127.0.0.1:9999',
        modes: ['t2v'],
        submit: { path: '/submit' },
      },
    ]);

    expect(getProvider('http-service:missing')).toBeNull();
    expect(getProvider('http-service')).toBeNull();
  });
});
