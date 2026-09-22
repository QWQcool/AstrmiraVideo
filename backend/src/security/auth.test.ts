import { describe, expect, it } from 'vitest';
import {
  ALWAYS_PUBLIC_PATHS,
  assertAuthConfiguredForProduction,
  createAuthHook,
  isLoopbackIp,
  resolveAuthToken,
} from './auth.js';

/**
 * 最小鉴权（PLAN §7-4，AC9 的鉴权半边）。
 * 两层免鉴权口径必须与 PLAN §7-4 完全一致：回环来源全部 + 任何来源的 /api/health。
 */

/** 最小 request/reply 桩（只用到 url / ip / headers / code / send） */
function fakeRequest(overrides: { url: string; ip: string; authorization?: string }) {
  return {
    url: overrides.url,
    ip: overrides.ip,
    socket: { remoteAddress: overrides.ip },
    headers: overrides.authorization === undefined ? {} : { authorization: overrides.authorization },
  } as unknown as Parameters<ReturnType<typeof createAuthHook>>[0];
}

function fakeReply() {
  const state = { statusCode: 200, payload: undefined as unknown };
  const reply = {
    code(code: number) {
      state.statusCode = code;
      return reply;
    },
    async send(payload: unknown) {
      state.payload = payload;
      return reply;
    },
  };
  return { reply: reply as unknown as Parameters<ReturnType<typeof createAuthHook>>[1], state };
}

describe('isLoopbackIp（回环判定）', () => {
  it('识别 IPv4 / IPv6 / IPv4-mapped 回环', () => {
    for (const ip of ['127.0.0.1', '127.0.0.5', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackIp(ip), `${ip} 应判为回环`).toBe(true);
    }
  });

  it('公网与内网地址一律不判为回环（避免把内网当本地放行）', () => {
    for (const ip of ['203.0.113.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '0.0.0.0']) {
      expect(isLoopbackIp(ip), `${ip} 不应判为回环`).toBe(false);
    }
  });
});

describe('ENV 解析与生产护栏', () => {
  it('PUBLIC_API_TOKEN 空白视为未配置', () => {
    expect(resolveAuthToken({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveAuthToken({ PUBLIC_API_TOKEN: '   ' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveAuthToken({ PUBLIC_API_TOKEN: ' s3cret ' } as NodeJS.ProcessEnv)).toBe('s3cret');
  });

  it('生产环境未配置 Token → 启动即拒绝（不允许匿名刷付费接口）', () => {
    expect(() =>
      assertAuthConfiguredForProduction({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(/生产环境必须配置 PUBLIC_API_TOKEN/);
  });

  it('生产环境已配置 Token 时通过；非生产环境不检查', () => {
    expect(() =>
      assertAuthConfiguredForProduction({
        NODE_ENV: 'production',
        PUBLIC_API_TOKEN: 'x',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() => assertAuthConfiguredForProduction({} as NodeJS.ProcessEnv)).not.toThrow();
  });
});

describe('鉴权钩子（两层免鉴权）', () => {
  const hook = createAuthHook('s3cret');

  it('① 回环来源：所有路径都免鉴权（含 /api/generate）', async () => {
    const { reply, state } = fakeReply();

    await hook(fakeRequest({ url: '/api/generate', ip: '127.0.0.1' }), reply);

    expect(state.statusCode).toBe(200);
    expect(state.payload).toBeUndefined();
  });

  it('② 任何来源的 /api/health 均免鉴权（存活探针）', async () => {
    const { reply, state } = fakeReply();

    await hook(fakeRequest({ url: '/api/health', ip: '203.0.113.9' }), reply);

    expect(state.statusCode).toBe(200);
    expect(state.payload).toBeUndefined();
    expect(ALWAYS_PUBLIC_PATHS).toEqual(['/api/health']);
  });

  it('公网来源 + 无令牌 → 401（复用 KEY_MISSING）', async () => {
    const { reply, state } = fakeReply();

    await hook(fakeRequest({ url: '/api/generate', ip: '203.0.113.9' }), reply);

    expect(state.statusCode).toBe(401);
    expect(state.payload).toMatchObject({ code: 'KEY_MISSING', disposition: 'terminal' });
  });

  it('公网来源 + 错误令牌 → 401；正确令牌 → 放行', async () => {
    const wrong = fakeReply();
    await hook(
      fakeRequest({ url: '/api/generate', ip: '203.0.113.9', authorization: 'Bearer nope' }),
      wrong.reply,
    );
    expect(wrong.state.statusCode).toBe(401);

    const right = fakeReply();
    await hook(
      fakeRequest({ url: '/api/generate', ip: '203.0.113.9', authorization: 'Bearer s3cret' }),
      right.reply,
    );
    expect(right.state.statusCode).toBe(200);
    expect(right.state.payload).toBeUndefined();
  });

  it('未配置 Token 时（非生产）不阻断——本地开发零摩擦', async () => {
    const noTokenHook = createAuthHook(undefined);
    const { reply, state } = fakeReply();

    await noTokenHook(fakeRequest({ url: '/api/generate', ip: '203.0.113.9' }), reply);

    expect(state.statusCode).toBe(200);
  });
});
