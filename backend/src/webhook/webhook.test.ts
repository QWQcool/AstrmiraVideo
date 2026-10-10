import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_TASK_TERMINAL,
  WEBHOOK_SIGNATURE_HEADER,
  maskWebhookSecret,
} from '@astrmira/shared';
import { openDatabase, type Db } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { WebhookStore } from '../store/webhooks.js';
import { WebhookDispatcher, buildTerminalPayload } from './dispatcher.js';
import { signPayload, verifySignature } from './signature.js';
import { checkWebhookUrl, isBlockedHost, isPrivateIpv4 } from './urlGuard.js';

/**
 * Webhook（V2.15 / 台账 B51 片 A，契约 §15）—— 三个纯函数层 + 投递循环。
 *
 * 投递循环用**真实的本地 HTTP 服务**当接收方（不是 mock fetch）：签名、头、体、重试、
 * 超时这几件事只有真发一次请求才算验过 —— 这也是本项目"渲染说'我转了'不算数、文件说了算"的同一纪律。
 */

const SECRET = 'whsec_0123456789abcdef0123456789abcdef';

describe('§15-① URL 准入（SSRF 防护）', () => {
  it('私网 / 环回 / 链路本地 / 云元数据一律识别', () => {
    expect(isPrivateIpv4('10.1.2.3')).toBe(true);
    expect(isPrivateIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateIpv4('172.32.0.1')).toBe(false); // 172.32 不在 16~31 段内
    expect(isPrivateIpv4('192.168.1.1')).toBe(true);
    expect(isPrivateIpv4('127.0.0.1')).toBe(true);
    expect(isPrivateIpv4('169.254.169.254')).toBe(true); // 云元数据
    expect(isPrivateIpv4('100.64.0.1')).toBe(true); // 运营商级 NAT
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateIpv4('not-an-ip')).toBe(false);
  });

  it('主机名规则：localhost / .localhost / IPv6 环回与唯一本地', () => {
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('api.localhost')).toBe(true);
    expect(isBlockedHost('::1')).toBe(true);
    expect(isBlockedHost('[fd00::1]')).toBe(true);
    expect(isBlockedHost('hooks.example.com')).toBe(false);
  });

  it('checkWebhookUrl：默认拒绝私网，放开开关后可放行（B 端私有部署的真实需求）', () => {
    expect(checkWebhookUrl('http://10.0.0.5/hook').ok).toBe(false);
    expect(checkWebhookUrl('http://10.0.0.5/hook', { allowPrivate: true }).ok).toBe(true);
    expect(checkWebhookUrl('https://hooks.example.com/hook').ok).toBe(true);
  });

  it('只支持 http/https、不许带凭据、不许空 URL', () => {
    expect(checkWebhookUrl('ftp://example.com/x').ok).toBe(false);
    expect(checkWebhookUrl('file:///etc/passwd').ok).toBe(false);
    expect(checkWebhookUrl('https://user:pass@example.com/x').ok).toBe(false);
    expect(checkWebhookUrl('   ').ok).toBe(false);
    expect(checkWebhookUrl('not a url').ok).toBe(false);
    // 报错要说人话（含"该怎么办"）
    const rejected = checkWebhookUrl('http://127.0.0.1:8080/x');
    expect(rejected.ok === false && rejected.reason.includes('WEBHOOK_ALLOW_PRIVATE')).toBe(true);
  });
});

describe('§15-② 签名（HMAC-SHA256）', () => {
  it('签名可被客户侧用同一算法验过；改一个字节就失败', () => {
    const body = JSON.stringify({ taskId: 'abc' });
    const header = signPayload(SECRET, body);
    expect(header.startsWith('sha256=')).toBe(true);
    expect(verifySignature(SECRET, body, header)).toBe(true);
    expect(verifySignature(SECRET, `${body} `, header)).toBe(false);
    expect(verifySignature('whsec_other', body, header)).toBe(false);
  });

  it('长度不一致直接 false（不拿 timingSafeEqual 比不同长度的 Buffer —— 那会抛异常）', () => {
    expect(verifySignature(SECRET, 'x', 'sha256=short')).toBe(false);
    expect(verifySignature(SECRET, 'x', '')).toBe(false);
  });

  it('secret 掩码保留前缀与末 4 位（够辨认、不够验签）', () => {
    const masked = maskWebhookSecret(SECRET);
    expect(masked.startsWith('whsec_01')).toBe(true);
    expect(masked.endsWith('cdef')).toBe(true);
    expect(masked.includes(SECRET)).toBe(false);
    expect(maskWebhookSecret('short').endsWith('…')).toBe(true);
  });
});

describe('§15-③ 终态载荷与投递循环', () => {
  let db: Db;
  let tasks: TaskStore;
  let webhooks: WebhookStore;
  let server: Server | null = null;
  let received: Array<{ headers: Record<string, string | undefined>; body: string }> = [];
  let mode: 'ok' | 'http-500' | 'hang' = 'ok';
  let url = '';
  // 用真实时间当基准：`webhooks.create` 的 `created_at` 走 `Date.now()`（生产语义），
  // 测试的 `now` 必须与它同一量级，否则"订阅创建之前/之后"的判定会失真。
  let now = Date.now();

  async function startReceiver(): Promise<void> {
    received = [];
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += String(chunk);
      });
      request.on('end', () => {
        received.push({ headers: request.headers as Record<string, string | undefined>, body });
        if (mode === 'hang') return; // 故意不响应（超时路径）
        response.writeHead(mode === 'http-500' ? 500 : 200, { 'content-type': 'text/plain' });
        response.end(mode === 'http-500' ? 'boom' : 'ok');
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    url = `http://127.0.0.1:${port}/hook`;
  }

  beforeEach(async () => {
    db = openDatabase(':memory:');
    tasks = new TaskStore(db);
    webhooks = new WebhookStore(db);
    mode = 'ok';
    // ⚠️ 每条用例都把 `now` 拉回真实时间：重试用例会把它往前推 90 秒（模拟退避），
    // 而 `webhooks.create` 用的是真实 `Date.now()` —— 不重置就会出现
    // "任务时间比订阅时间晚了 30 秒"的假象，把 forward-only 的断言带偏（实测踩到过）。
    now = Date.now();
    await startReceiver();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (server === null) return resolve();
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    server = null;
    db.close();
  });

  function seedTerminalTask(taskId = 'task-1'): void {
    tasks.insert({
      taskId,
      track: 'local',
      provider: 'fixture-local',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: {
        prompt: '雨夜街头',
        mode: 't2v',
        aspectRatio: '16:9',
        provider: 'fixture-local',
      } as never,
      warnings: [],
      submitting: false,
      projectId: 'default',
      outputVideoUrl: `/media/${taskId}.mp4`,
      thumbnailUrl: `/media/thumbs/${taskId}.jpg`,
      // 任务时间 = 订阅创建之后（真实世界就是这个顺序：先建订阅，再提交任务）——
      // 订阅是 **forward-only** 的（见 store/webhooks.ts 的 enqueueMissing 注释）
      createdAt: now + 1_000,
    });
  }

  function makeDispatcher(): WebhookDispatcher {
    return new WebhookDispatcher({
      webhooks,
      tasks,
      now: () => now,
      publicBaseUrl: 'https://video.example.com',
      timeoutMs: 200,
    });
  }

  it('终态任务 → 建投递 → 真发请求：签名可验、头与载荷齐（成片给绝对 URL）', async () => {
    seedTerminalTask();
    webhooks.create({ projectId: 'default', url, secret: SECRET, events: [WEBHOOK_EVENT_TASK_TERMINAL] });

    const dispatcher = makeDispatcher();
    await dispatcher.tick();

    expect(received).toHaveLength(1);
    const request = received[0]!;
    expect(request.headers[WEBHOOK_EVENT_HEADER]).toBe(WEBHOOK_EVENT_TASK_TERMINAL);
    expect(verifySignature(SECRET, request.body, request.headers[WEBHOOK_SIGNATURE_HEADER] ?? '')).toBe(true);
    const payload = JSON.parse(request.body);
    expect(payload.taskId).toBe('task-1');
    expect(payload.projectId).toBe('default');
    expect(payload.status).toBe('succeeded');
    expect(payload.outputVideoUrl).toBe('https://video.example.com/media/task-1.mp4');
    expect(payload.deliveryId).toBe(request.headers[WEBHOOK_DELIVERY_HEADER]);
    // 未结算 → 不出现 costYuan（**不是 0**）
    expect('costYuan' in payload).toBe(false);

    const deliveries = webhooks.listDeliveries(
      webhooks.listByProject('default')[0]!.webhookId,
    );
    expect(deliveries[0]!.status).toBe('delivered');
    expect(deliveries[0]!.attempts).toBe(1);
    expect(deliveries[0]!.lastStatusCode).toBe(200);
  });

  it('投递幂等：再跑一轮不会重复投（唯一索引 + NOT EXISTS）', async () => {
    seedTerminalTask();
    webhooks.create({ projectId: 'default', url, secret: SECRET, events: [WEBHOOK_EVENT_TASK_TERMINAL] });
    const dispatcher = makeDispatcher();
    await dispatcher.tick();
    await dispatcher.tick();
    expect(received).toHaveLength(1);
  });

  it('停用的订阅不投（开关的语义必须在扫描层生效）', async () => {
    seedTerminalTask();
    const hook = webhooks.create({
      projectId: 'default',
      url,
      secret: SECRET,
      events: [WEBHOOK_EVENT_TASK_TERMINAL],
    });
    webhooks.update(hook.webhookId, { enabled: false });
    await makeDispatcher().tick();
    expect(received).toHaveLength(0);
    // 也没建流水（否则恢复启用后会补投一堆过期事件）
    expect(webhooks.listDeliveries(hook.webhookId)).toHaveLength(0);
  });

  it('失败 → 退避重试 → 用尽后 failed（不再无限重试）', async () => {
    mode = 'http-500';
    seedTerminalTask();
    const hook = webhooks.create({
      projectId: 'default',
      url,
      secret: SECRET,
      events: [WEBHOOK_EVENT_TASK_TERMINAL],
    });
    const dispatcher = makeDispatcher();

    await dispatcher.tick(); // 第 1 次（失败，排 5s 后）
    let delivery = webhooks.listDeliveries(hook.webhookId)[0]!;
    expect(delivery.status).toBe('pending');
    expect(delivery.attempts).toBe(1);
    expect(delivery.lastStatusCode).toBe(500);
    expect(delivery.nextAttemptAt).toBe(now + 5_000);

    now += 5_000;
    await dispatcher.tick(); // 第 2 次（失败，排 25s 后）
    delivery = webhooks.listDeliveries(hook.webhookId)[0]!;
    expect(delivery.attempts).toBe(2);
    expect(delivery.nextAttemptAt).toBe(now + 25_000);

    now += 25_000;
    await dispatcher.tick(); // 第 3 次（用尽 → failed）
    delivery = webhooks.listDeliveries(hook.webhookId)[0]!;
    expect(delivery.attempts).toBe(3);
    expect(delivery.status).toBe('failed');
    expect(delivery.nextAttemptAt).toBeNull();

    now += 60_000;
    await dispatcher.tick(); // 不再重试
    expect(received).toHaveLength(3);
  });

  it('超时算失败（客户系统慢不该拖住扫描循环）', async () => {
    mode = 'hang';
    seedTerminalTask();
    const hook = webhooks.create({
      projectId: 'default',
      url,
      secret: SECRET,
      events: [WEBHOOK_EVENT_TASK_TERMINAL],
    });
    await makeDispatcher().tick();
    const delivery = webhooks.listDeliveries(hook.webhookId)[0]!;
    expect(delivery.attempts).toBe(1);
    expect(delivery.status).toBe('pending');
    expect(delivery.lastError ?? '').not.toBe('');
  });

  it('删订阅连带删流水（不留指向已删订阅的记录 —— 否则像"还有回调在跑"）', async () => {
    seedTerminalTask();
    const hook = webhooks.create({
      projectId: 'default',
      url,
      secret: SECRET,
      events: [WEBHOOK_EVENT_TASK_TERMINAL],
    });
    await makeDispatcher().tick();
    expect(webhooks.listDeliveries(hook.webhookId)).toHaveLength(1);

    expect(webhooks.remove(hook.webhookId)).toBe(true);
    expect(webhooks.get(hook.webhookId)).toBeNull();
    expect(webhooks.listDeliveries(hook.webhookId)).toEqual([]);
    expect(webhooks.remove(hook.webhookId)).toBe(false); // 再删 → false（路由层转 404）
  });

  it('订阅是 forward-only + 只看回看窗口：创建前的任务不补投，窗口外的也不补', async () => {
    // ① 订阅创建**之前**就终态的任务（真实世界的"历史任务"）→ 不投（否则接入即事件洪峰）
    tasks.insert({
      taskId: 'before-subscription',
      track: 'local',
      provider: 'fixture-local',
      status: 'succeeded',
      progressPercent: 100,
      requestSnapshot: { prompt: '历史任务', mode: 't2v', aspectRatio: '16:9' } as never,
      warnings: [],
      submitting: false,
      projectId: 'default',
      createdAt: now - 60_000,
    });
    // ② 很久以前的任务（超出兜底窗口）→ 也不投
    seedTerminalTask('old-task');
    db.prepare('UPDATE tasks SET created_at = ? WHERE task_id = ?').run(
      now - 30 * 24 * 3600 * 1000,
      'old-task',
    );
    // ③ 订阅创建之后、窗口内的任务 → 投
    seedTerminalTask('fresh-task');
    const hook = webhooks.create({
      projectId: 'default',
      url,
      secret: SECRET,
      events: [WEBHOOK_EVENT_TASK_TERMINAL],
    });

    await makeDispatcher().tick();
    const deliveries = webhooks.listDeliveries(hook.webhookId);
    // 只有 fresh-task 进池（before-subscription 被 forward-only 挡住、old-task 被兜底窗口挡住）
    expect(deliveries.map((delivery) => delivery.taskId)).toEqual(['fresh-task']);
  });

  it('载荷构造是纯函数：未结算不给 costYuan，未配基址时给相对路径', async () => {
    seedTerminalTask();
    const record = tasks.get('task-1')!;
    const payload = buildTerminalPayload({
      delivery: {
        deliveryId: 'd1',
        webhookId: 'w1',
        taskId: 'task-1',
        event: WEBHOOK_EVENT_TASK_TERMINAL,
        status: 'pending',
        attempts: 0,
        lastStatusCode: null,
        lastError: null,
        nextAttemptAt: null,
        deliveredAt: null,
        createdAt: 0,
        updatedAt: 0,
      },
      task: record,
      now: 123,
    });
    expect(payload.outputVideoUrl).toBe('/media/task-1.mp4');
    expect('costYuan' in payload).toBe(false);
    expect(payload.terminatedAt).toBe(123);
  });
});
