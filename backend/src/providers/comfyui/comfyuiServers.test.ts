import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMFY_SERVER_ID,
  findComfyServer,
  resolveComfyServers,
  type ComfyUiServer,
} from './comfyuiServers.js';

/**
 * 本地 ComfyUI 实例表（V2.36 / CONTRACT §19-1；台账 A1 后续）单测。
 *
 * 盯三件事：
 * 1. **两种写法共存**（`COMFYUI_BASE_URL` 单实例 + `COMFYUI_SERVERS_FILE` 多实例）；
 * 2. **白名单逐实例** —— 一台不合规只影响它自己（这正是多实例相对"一整块配置"的价值）；
 * 3. **文件坏了不静默**（读不出来 / 结构不对 → `problems` 非空，绝不假装"只配了 BASE_URL"）。
 */

function withServersFile(entries: unknown, run: (env: NodeJS.ProcessEnv) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-comfy-servers-'));
  const file = path.join(dir, 'servers.json');
  writeFileSync(file, typeof entries === 'string' ? entries : JSON.stringify(entries, null, 2), 'utf8');
  try {
    run({ COMFYUI_SERVERS_FILE: file } as NodeJS.ProcessEnv);
  } finally {
    // 临时目录留给系统清理：这里不删是因为断言里可能还要读它的错误信息（路径已脱敏）
  }
}

const idOf = (servers: ComfyUiServer[]): string[] => servers.map((server) => server.id);

describe('ComfyUI 实例表 · 解析（V2.36）', () => {
  it('什么都没配 → 没有实例、没有问题（这一档由 /status 如实说"未配置"）', () => {
    const resolved = resolveComfyServers({} as NodeJS.ProcessEnv);
    expect(resolved.servers).toEqual([]);
    expect(resolved.problems).toEqual([]);
  });

  it('只配 COMFYUI_BASE_URL → 一台默认实例（老部署零改动）', () => {
    const { servers } = resolveComfyServers({
      COMFYUI_BASE_URL: 'http://127.0.0.1:8188',
    } as NodeJS.ProcessEnv);
    expect(idOf(servers)).toEqual([DEFAULT_COMFY_SERVER_ID]);
    expect(servers[0]).toMatchObject({
      name: 'default',
      label: '默认引擎',
      available: true,
      url: 'http://127.0.0.1:8188',
    });
  });

  it('地址不合规 → 这一台不可用并给原因（**不回显地址明文**）', () => {
    const { servers } = resolveComfyServers({
      COMFYUI_BASE_URL: 'http://example.com:8188',
    } as NodeJS.ProcessEnv);
    expect(servers[0]?.available).toBe(false);
    expect(servers[0]?.reason).toContain('回环或内网');
    // 脱敏：原因里不得出现完整地址
    expect(servers[0]?.reason ?? '').not.toContain('example.com');
  });

  it('文件里多台 → 各自成 id；label / template / 档位覆盖逐项落到那一台', () => {
    withServersFile(
      [
        {
          name: 'office',
          label: '办公室的 3080',
          url: 'http://127.0.0.1:8188',
          template: 'wan22-ti2v-5b',
          maxPixels: 921600,
          steps: 30,
        },
        { name: 'home', url: 'http://192.168.1.20:8188', fps: 16 },
      ],
      (env) => {
        const { servers, problems } = resolveComfyServers({ ...env, COMFYUI_BASE_URL: 'http://127.0.0.1:9000' } as NodeJS.ProcessEnv);
        expect(problems).toEqual([]);
        // 默认实例在前，具名实例随后 —— 它们是**不同的地址**，不存在谁覆盖谁
        expect(idOf(servers)).toEqual(['host-comfyui', 'host-comfyui:office', 'host-comfyui:home']);

        const office = servers.find((server) => server.id === 'host-comfyui:office');
        expect(office).toMatchObject({
          label: '办公室的 3080',
          template: 'wan22-ti2v-5b',
          tuning: { maxPixels: 921600, steps: 30 },
          available: true,
        });
        const home = servers.find((server) => server.id === 'host-comfyui:home');
        expect(home?.label).toBe('home'); // 没给 label → 用 name
        expect(home?.tuning).toEqual({ fps: 16 });
        expect(home?.template).toBeUndefined(); // 没给模板 → 回落全局 COMFYUI_TEMPLATE
      },
    );
  });

  it('**白名单逐实例**：一台不合规不影响另一台（多实例的核心价值）', () => {
    withServersFile(
      [
        { name: 'ok', url: 'http://10.0.0.5:8188' },
        { name: 'public', url: 'http://example.com:8188' },
      ],
      (env) => {
        const { servers } = resolveComfyServers({ ...env } as NodeJS.ProcessEnv);
        expect(servers.find((server) => server.id === 'host-comfyui:ok')?.available).toBe(true);
        const bad = servers.find((server) => server.id === 'host-comfyui:public');
        expect(bad?.available).toBe(false);
        expect(bad?.reason).toContain('回环或内网');
      },
    );
  });

  it('实例名重复 → 后面那一台标记不可用并说清（静默覆盖会让"配了两台只亮一台"变成谜）', () => {
    withServersFile(
      [
        { name: 'office', url: 'http://127.0.0.1:8188' },
        { name: 'office', url: 'http://127.0.0.1:8189' },
      ],
      (env) => {
        const { servers } = resolveComfyServers({ ...env } as NodeJS.ProcessEnv);
        expect(servers).toHaveLength(2);
        expect(servers[0]?.available).toBe(true);
        expect(servers[1]?.available).toBe(false);
        expect(servers[1]?.reason).toContain('实例名重复');
      },
    );
  });

  it('文件里的 name=default 与 COMFYUI_BASE_URL 撞名 → 同样如实报重复', () => {
    withServersFile([{ name: 'default', url: 'http://127.0.0.1:8189' }], (env) => {
      const { servers } = resolveComfyServers({
        ...env,
        COMFYUI_BASE_URL: 'http://127.0.0.1:8188',
      } as NodeJS.ProcessEnv);
      expect(servers[1]?.available).toBe(false);
      expect(servers[1]?.reason).toContain('实例名重复');
    });
  });

  it('文件读不出来 / 不是 JSON / 结构不对 → problems 非空，**绝不假装"只配了 BASE_URL"**', () => {
    // ① 路径不存在
    const missing = resolveComfyServers({
      COMFYUI_SERVERS_FILE: path.join(tmpdir(), 'astrmira-not-here-9f8e7d', 'servers.json'),
    } as NodeJS.ProcessEnv);
    expect(missing.problems[0]).toContain('COMFYUI_SERVERS_FILE');
    expect(missing.servers).toEqual([]);

    // ② 不是 JSON
    withServersFile('{ 这不是 JSON', (env) => {
      const broken = resolveComfyServers({ ...env } as NodeJS.ProcessEnv);
      expect(broken.problems[0]).toContain('JSON');
      expect(broken.servers).toEqual([]);
    });

    // ③ 结构不对：第 2 项的 url 不是字符串 → 原因里带**第几项**（不然等于没说）
    withServersFile([{ name: 'ok', url: 'http://127.0.0.1:8188' }, { name: 'bad' }], (env) => {
      const broken = resolveComfyServers({ ...env } as NodeJS.ProcessEnv);
      expect(broken.problems[0]).toContain('结构不对');
      expect(broken.problems[0]).toContain('第 2 项');
    });

    // ④ name 形状不合法（它是 provider id 的一部分）
    withServersFile([{ name: '办公室', url: 'http://127.0.0.1:8188' }], (env) => {
      const broken = resolveComfyServers({ ...env } as NodeJS.ProcessEnv);
      expect(broken.problems[0]).toContain('name');
    });
  });

  it('findComfyServer：按 id 取那一台；未知 id → null（→ 既有的"未注册 503"路径）', () => {
    const { servers } = resolveComfyServers({
      COMFYUI_BASE_URL: 'http://127.0.0.1:8188',
    } as NodeJS.ProcessEnv);
    expect(findComfyServer('host-comfyui', servers)?.url).toBe('http://127.0.0.1:8188');
    expect(findComfyServer('host-comfyui:office', servers)).toBeNull();
    expect(findComfyServer('nope', servers)).toBeNull();
  });
});
