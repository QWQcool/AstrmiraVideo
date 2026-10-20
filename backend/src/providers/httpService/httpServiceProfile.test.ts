import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpServicesFileSchema, resolveHttpServices } from './httpServiceProfile.js';

const dirs: string[] = [];

function fileWith(value: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-http-service-'));
  dirs.push(dir);
  const file = path.join(dir, 'services.json');
  writeFileSync(file, JSON.stringify(value), 'utf8');
  return file;
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    name: 'h3-gpu',
    baseUrl: 'http://127.0.0.1:9000',
    modes: ['t2v'],
    submit: {
      path: '/v1/jobs',
      body: { model: 'h3' },
      fields: { prompt: { from: 'prompt' } },
      taskIdField: 'id',
    },
    poll: {
      path: '/v1/jobs/{id}',
      stateField: 'status',
      success: ['succeeded'],
      failed: ['failed'],
    },
    outputs: { video: { path: 'result.video_url', kind: 'video' } },
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('HTTP 任务服务配置（CONTRACT §22 / V2.47）', () => {
  it('未配置 HTTP_SERVICES_FILE → 空列表，不报错', () => {
    expect(resolveHttpServices({})).toEqual({ servers: [], problems: [] });
  });

  it('合法配置 → 具名实例、label、modes、可用', () => {
    const file = fileWith([entry({ label: 'H3 算力服务器' })]);
    const { servers, problems } = resolveHttpServices({ HTTP_SERVICES_FILE: file });
    expect(problems).toEqual([]);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      id: 'http-service:h3-gpu',
      name: 'h3-gpu',
      label: 'H3 算力服务器',
      modes: ['t2v'],
      available: true,
    });
  });

  it('公网地址 → 该实例不可用（白名单只允许回环/内网）', () => {
    const file = fileWith([entry({ baseUrl: 'https://gpu.example.com' })]);
    const { servers } = resolveHttpServices({ HTTP_SERVICES_FILE: file });
    expect(servers[0]?.available).toBe(false);
    expect(servers[0]?.reason).toContain('回环或内网');
  });

  it('tokenEnv 缺失 → 该实例不可用，但不影响其它实例', () => {
    const file = fileWith([
      entry({ name: 'needs-token', tokenEnv: 'MISSING_HTTP_TOKEN' }),
      entry({ name: 'no-token' }),
    ]);
    const { servers } = resolveHttpServices({ HTTP_SERVICES_FILE: file });
    expect(servers[0]).toMatchObject({
      id: 'http-service:needs-token',
      available: false,
    });
    expect(servers[0]?.reason).toContain('MISSING_HTTP_TOKEN');
    expect(servers[1]?.available).toBe(true);
  });

  it('同名实例：后一条标记不可用，不静默覆盖', () => {
    const file = fileWith([entry(), entry({ baseUrl: 'http://127.0.0.1:9001' })]);
    const { servers } = resolveHttpServices({ HTTP_SERVICES_FILE: file });
    expect(servers).toHaveLength(2);
    expect(servers[0]?.available).toBe(true);
    expect(servers[1]?.available).toBe(false);
    expect(servers[1]?.reason).toContain('实例名重复');
  });

  it('taskIdField 没有 poll / file 字段不是 multipart → 结构错误', () => {
    const noPoll = HttpServicesFileSchema.safeParse([
      { ...entry(), poll: undefined },
    ]);
    expect(noPoll.success).toBe(false);

    const badFile = HttpServicesFileSchema.safeParse([
      entry({
        submit: {
          path: '/v1/jobs',
          bodyFormat: 'json',
          fields: { image: { from: 'assets.firstFrameImage', format: 'file' } },
          taskIdField: 'id',
        },
      }),
    ]);
    expect(badFile.success).toBe(false);
  });

  it('普通 headers 里写认证字段 → 拒绝', () => {
    const result = HttpServicesFileSchema.safeParse([
      entry({ headers: { Authorization: 'Bearer leaked' } }),
    ]);
    expect(result.success).toBe(false);
  });

  it('文件不是 JSON / 结构不对 → 文件级 problem（不假装没配）', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-http-service-'));
    dirs.push(dir);
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{not json', 'utf8');
    const broken = resolveHttpServices({ HTTP_SERVICES_FILE: bad });
    expect(broken.servers).toEqual([]);
    expect(broken.problems[0]).toContain('不是合法的 JSON');

    const file = fileWith([{ name: '缺少一切' }]);
    const invalid = resolveHttpServices({ HTTP_SERVICES_FILE: file });
    expect(invalid.problems[0]).toContain('结构不对');
  });
});
