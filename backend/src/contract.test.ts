import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ErrorResponse } from '@astrmira/shared';
import { ERROR_DISPOSITION, listErrorCodes } from './errors.js';
import { buildApp } from './index.js';

/**
 * 契约层测试（S7 / AC1）——把 `docs/CONTRACT.md` 当**输入**来校验实现。
 *
 * 为什么这样做：如果把 CONTRACT 的表格抄成第二份清单，那份清单本身会漂移，
 * 测的是"副本"而不是"契约"。这里直接解析文档，任何一方改了而另一方没跟上都会红。
 *
 * 覆盖：§5 全部路由、§6 全部错误码与处置（双向）。
 */

const CONTRACT_PATH = fileURLToPath(new URL('../../docs/CONTRACT.md', import.meta.url));
const contractText = readFileSync(CONTRACT_PATH, 'utf8');

/** 取出某个二级标题到下一个二级标题之间的正文 */
function section(heading: string): string {
  const start = contractText.indexOf(heading);
  if (start < 0) throw new Error(`CONTRACT.md 缺少章节：${heading}`);
  const next = contractText.indexOf('\n## ', start + 1);
  return next < 0 ? contractText.slice(start) : contractText.slice(start, next);
}

interface ContractRoute {
  method: string;
  path: string;
}

/** 解析 §5 路由表的「方法 + 路径」 */
function parseContractRoutes(): ContractRoute[] {
  const routes: ContractRoute[] = [];
  const lineRe = /^\|\s*`(GET|POST|PUT|DELETE|PATCH)`\s*\|\s*`([^`]+)`/gm;

  for (const match of section('## 5.').matchAll(lineRe)) {
    routes.push({ method: match[1] as string, path: match[2] as string });
  }
  return routes;
}

/** 解析 §6 错误码表的「code → disposition」 */
function parseContractErrorTable(): Map<string, string> {
  const table = new Map<string, string>();
  const lineRe = /^\|\s*`([A-Z_]+)`\s*\|[^|]*\|\s*\*{0,2}`([a-z]+)`/gm;

  for (const match of section('## 6.').matchAll(lineRe)) {
    table.set(match[1] as string, match[2] as string);
  }
  return table;
}

type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;

beforeAll(async () => {
  process.env.DATA_DIR = ':memory:';
  delete process.env.PUBLIC_API_TOKEN;
  delete process.env.CORS_ORIGINS;
  delete process.env.EXPOSE_HOST_LOCAL_TRACK;

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('AC1 · CONTRACT §5 路由覆盖', () => {
  it('路由表能被解析（防解析器失效导致的"恒真"）', () => {
    const routes = parseContractRoutes();

    expect(routes.length).toBeGreaterThanOrEqual(10);
    expect(routes.map((r) => r.path)).toContain('/api/generate');
  });

  it('§5 声明的每条路由都已在应用中注册', () => {
    // 用 hasRoute 而非 printRoutes：后者不列出 @fastify/static 的 wildcard 路由
    for (const route of parseContractRoutes()) {
      const registered = app.hasRoute({
        method: route.method as 'GET',
        url: route.path,
      });

      expect(registered, `CONTRACT §5 的 ${route.method} ${route.path} 未注册`).toBe(true);
    }
  });

  it('未携带 X-LLM-Key 的扩写请求 → 501 + LLM_NOT_CONFIGURED（纯 BYOK，不静默降级）', async () => {
    // V2.0：扩写已实现，但服务端**不设文本侧兜底 Key** —— 没有凭据就是"没配"，
    // 而不是"用服务端的 Key 偷偷替你跑一次"（PLAN §6-D24 / 铁律 4）。
    const res = await app.inject({
      method: 'POST',
      url: '/api/prompt/enhance',
      payload: { originalPrompt: '雨夜街头的中景镜头' },
    });

    expect(res.statusCode).toBe(501);
    const body = res.json() as ErrorResponse;
    expect(body.code).toBe('LLM_NOT_CONFIGURED');
    expect(body.disposition).toBe('terminal');
  });
});

describe('AC1 · CONTRACT §6 错误码与处置（双向）', () => {
  it('错误码表能被解析（防解析器失效）', () => {
    const table = parseContractErrorTable();

    expect(table.size).toBeGreaterThanOrEqual(12);
    expect(table.get('UNCERTAIN_RESULT')).toBe('uncertain');
  });

  it('契约里每个码都在实现映射表中，且处置一致', () => {
    for (const [code, disposition] of parseContractErrorTable()) {
      expect(
        ERROR_DISPOSITION[code as keyof typeof ERROR_DISPOSITION],
        `CONTRACT §6 的 ${code} 未在实现映射表中`,
      ).toBe(disposition);
    }
  });

  it('实现里没有契约之外的码（防止"代码加了、文档没写"）', () => {
    const contractCodes = new Set(parseContractErrorTable().keys());

    for (const code of listErrorCodes()) {
      expect(contractCodes.has(code), `实现中的 ${code} 未写入 CONTRACT §6`).toBe(true);
    }
    expect(listErrorCodes()).toHaveLength(contractCodes.size);
  });

  it('三态穷举：uncertain 有且仅有 UNCERTAIN_RESULT 一个码', () => {
    const uncertain = listErrorCodes().filter((code) => ERROR_DISPOSITION[code] === 'uncertain');

    expect(uncertain).toEqual(['UNCERTAIN_RESULT']);
  });
});

describe('AC1 · 关键响应形状抽样（契约投影）', () => {
  it('/api/health 与 /api/providers/status 返回 200 且字段齐备', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: 'ok', name: expect.any(String) });

    const status = await app.inject({ method: 'GET', url: '/api/providers/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().cloud).toMatchObject({ acceptsClientKey: true });
  });

  it('未实现的 provider → 503 PROVIDER_UNAVAILABLE（不静默降级）', async () => {
    // 云端轨 S5b 起已实现，故用仍未实现的本地轨做这条抽样（铁律：未实现不得静默降级）
    const res = await app.inject({
      method: 'POST',
      url: '/api/generate',
      remoteAddress: '198.51.100.150',
      payload: {
        prompt: '契约抽样',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'local-minimax-h3',
      },
    });

    expect(res.statusCode).toBe(503);
    expect((res.json() as ErrorResponse).code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('不存在的任务 → 404 TASK_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/nope' });

    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrorResponse).code).toBe('TASK_NOT_FOUND');
  });

  it('上传非 multipart → 415 INVALID_ASSET', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/upload',
      remoteAddress: '198.51.100.151',
      payload: { not: 'multipart' },
    });

    expect(res.statusCode).toBe(415);
    expect((res.json() as ErrorResponse).code).toBe('INVALID_ASSET');
  });
});
