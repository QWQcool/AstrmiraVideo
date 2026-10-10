import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  METRICS_DEFAULTS,
  buildAlerts,
  readThresholdsFromEnv,
  resolveThresholds,
  summarizeMetricsStatus,
  summarizeReadiness,
  type MetricCheck,
} from '@astrmira/shared';
import { collectMetrics, collectReadinessChecks, probeWritableDir } from './collect.js';
import { openDatabase, type Db } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';
import { WebhookStore } from '../store/webhooks.js';

/**
 * 可观测（V2.16 / 台账 B53，契约 §16）。
 *
 * 断言侧重**四件容易出错的事**：
 * ① 告警**没越线就不出现**（噪声纪律：常年挂着一条 info 的告警等于没有告警）；
 * ② 阈值解析对**坏 env** 的处理（空串 / NaN 不许把阈值变成 0 —— 那会让告警永远不响）；
 * ③ readiness 的 `required` 语义（依赖故障才降级；凭据/ffmpeg 缺失**不**降级，但如实陈述）；
 * ④ 快照的每个数字**与库里的真实值对得上**（含"队列积压多久"与"存储用了多少"）。
 */

const FIXED_NOW = 1_700_000_000_000;

function check(over: Partial<MetricCheck> & { id: string }): MetricCheck {
  return { ok: true, required: true, detail: '', ...over };
}

describe('§16-① 告警判定（纯函数，没越线就不出现）', () => {
  const quiet = {
    storageUsageRatio: 0.1,
    storageOverThreshold: false,
    webhookPending: 0,
    webhookOldestPendingSec: null,
    webhookFailed: 0,
    runningTasks: 0,
    oldestRunningSec: null,
    databaseBytes: 1024,
  };

  it('一切正常 → 零告警（不是"一条 green"）', () => {
    expect(buildAlerts(quiet)).toEqual([]);
    expect(summarizeMetricsStatus([])).toBe('ok');
  });

  it('存储：warn 线给 warn、critical 线给 critical（同一条只出现一次）', () => {
    const warn = buildAlerts({ ...quiet, storageUsageRatio: METRICS_DEFAULTS.storageWarnRatio });
    expect(warn).toHaveLength(1);
    expect(warn[0]!.id).toBe('storage.warn');
    expect(warn[0]!.severity).toBe('warn');

    const critical = buildAlerts({
      ...quiet,
      storageUsageRatio: METRICS_DEFAULTS.storageCriticalRatio,
    });
    expect(critical.map((a) => a.id)).toEqual(['storage.critical']);
    // 已超阈值（淘汰器真的会动手）→ 必须 critical，即使比例还没到线
    expect(buildAlerts({ ...quiet, storageOverThreshold: true })[0]!.severity).toBe('critical');
  });

  it('Webhook：永久失败与投递积压各给一条（客户系统可能已挂）', () => {
    const alerts = buildAlerts({
      ...quiet,
      webhookFailed: 2,
      webhookPending: 5,
      webhookOldestPendingSec: METRICS_DEFAULTS.webhookPendingWarnSec,
    });
    expect(alerts.map((a) => a.id).sort()).toEqual(['webhook.failed', 'webhook.pending']);
    // 有积压但还很新 → 不告警
    expect(
      buildAlerts({ ...quiet, webhookPending: 5, webhookOldestPendingSec: 10 }).map((a) => a.id),
    ).toEqual([]);
  });

  it('任务卡住：只在"确实有 running 且最老的那条超时"时才报', () => {
    expect(
      buildAlerts({ ...quiet, runningTasks: 1, oldestRunningSec: METRICS_DEFAULTS.taskStuckWarnSec }),
    ).toHaveLength(1);
    // 没有 running（老数据残留）→ 不报
    expect(
      buildAlerts({ ...quiet, runningTasks: 0, oldestRunningSec: METRICS_DEFAULTS.taskStuckWarnSec }),
    ).toEqual([]);
  });

  it('数据库偏大 → 一条 warn；critical 排在 warn 之前', () => {
    const alerts = buildAlerts({
      ...quiet,
      databaseBytes: METRICS_DEFAULTS.databaseWarnBytes,
      storageUsageRatio: METRICS_DEFAULTS.storageCriticalRatio,
    });
    expect(alerts.map((a) => a.id)).toEqual(['storage.critical', 'database.size']);
    expect(alerts[1]!.severity).toBe('warn');
  });

  it('每条告警都带可复核的 value / threshold（否则"越线"无法被验证）', () => {
    for (const alert of buildAlerts({ ...quiet, storageUsageRatio: 0.99, webhookFailed: 3 })) {
      expect(alert.value).not.toBeNull();
      expect(alert.threshold).not.toBeNull();
      expect(alert.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('§16-② 阈值解析（坏 env 不许把阈值变成 0）', () => {
  it('没配 → 全用默认值', () => {
    expect(resolveThresholds()).toEqual(METRICS_DEFAULTS);
    expect(readThresholdsFromEnv({})).toEqual({});
  });

  it('配了合法值 → 覆盖；空串 / NaN / 负数 → **忽略**（回落默认）', () => {
    expect(resolveThresholds({ storageWarnRatio: 0.5 }).storageWarnRatio).toBe(0.5);

    const bad = readThresholdsFromEnv({
      METRICS_STORAGE_WARN_RATIO: '',
      METRICS_STORAGE_CRITICAL_RATIO: 'abc',
      METRICS_WEBHOOK_FAILED_WARN_COUNT: '-1',
      METRICS_DATABASE_WARN_BYTES: '1024',
    });
    expect(bad).toEqual({ databaseWarnBytes: 1024 });
    // 0 是**合法**阈值（"一有就报"），必须与"坏值"区分开
    expect(resolveThresholds({ webhookFailedWarnCount: 0 }).webhookFailedWarnCount).toBe(0);
  });
});

describe('§16-③ readiness 分级（依赖故障才降级）', () => {
  it('required 全过 → ready', () => {
    expect(summarizeReadiness([check({ id: 'a' }), check({ id: 'b' })])).toBe('ready');
  });

  it('required 失败 → degraded（编排器停止导流）', () => {
    expect(summarizeReadiness([check({ id: 'db', ok: false })])).toBe('degraded');
  });

  it('**非 required** 失败不降级（BYOK 部署没配 Key、服务器没装 ffmpeg 都不该判不健康）', () => {
    expect(
      summarizeReadiness([
        check({ id: 'db' }),
        check({ id: 'media.tools', ok: false, required: false }),
        check({ id: 'credentials', ok: false, required: false }),
      ]),
    ).toBe('ready');
  });
});

describe('§16-④ 采集：数字要与库里的真实值对得上', () => {
  let db: Db;
  let dir: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    dir = mkdtempSync(path.join(tmpdir(), 'astrmira-metrics-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    db.close();
  });

  function insertTask(taskId: string, status: string, createdAt: number, track = 'cloud'): void {
    db.prepare(
      `INSERT INTO tasks (task_id, track, provider, status, progress_percent, request_snapshot,
                          warnings, submitting, project_id, created_at, updated_at)
       VALUES (?, ?, 'stub', ?, 0, '{}', '[]', 0, 'default', ?, ?)`,
    ).run(taskId, track, status, createdAt, createdAt);
  }

  it('任务/队列/告警全部来自真实行；阈值原样回显（可复核）', async () => {
    const tasks = new TaskStore(db);
    const webhooks = new WebhookStore(db);
    insertTask('q1', 'queued', FIXED_NOW - 60_000); // 排队 60 秒
    insertTask('r1', 'running', FIXED_NOW - 10_000, 'local');
    insertTask('s1', 'succeeded', FIXED_NOW - 1_000);
    insertTask('f1', 'failed', FIXED_NOW - 2 * 24 * 3600 * 1000); // 窗口外

    const metrics = await collectMetrics({
      tasks,
      webhooks,
      outputsDir: dir,
      maxBytes: 1_000,
      now: () => FIXED_NOW,
      readStorage: async () => ({
        totalBytes: 900, // 0.9 → 越过默认 warn 线（0.85）
        videoBytes: 800,
        videoCount: 1,
        thumbBytes: 100,
        assetBytes: 0,
        assetCount: 0,
      }),
      processInfo: {
        nodeVersion: 'v-test',
        pid: 1,
        cpuCount: 2,
        rssBytes: 1024,
        heapUsedBytes: 512,
        uptimeSec: 42,
      },
    });

    expect(metrics.tasks.byStatus).toEqual({
      queued: 1,
      running: 1,
      succeeded: 1,
      failed: 1,
      cancelled: 0,
    });
    expect(metrics.tasks.running).toEqual({ cloud: 0, local: 1 });
    expect(metrics.tasks.window24h).toEqual({ succeeded: 1, failed: 0, total: 3 }); // f1 在窗口外
    expect(metrics.queue.queued).toBe(1);
    expect(metrics.queue.oldestQueuedAgeSec).toBe(60);
    expect(metrics.storage.usageRatio).toBeCloseTo(0.9, 4);
    expect(metrics.storage.overThreshold).toBe(false); // 900 < 1000（超阈值与"接近阈值"是两件事）
    expect(metrics.alerts.map((a) => a.id)).toEqual(['storage.warn']);
    expect(metrics.status).toBe('degraded');
    expect(metrics.thresholds.storageWarnRatio).toBe(METRICS_DEFAULTS.storageWarnRatio);
    expect(metrics.uptimeSec).toBe(42);
    // 内存库没有文件 → 如实 0（不是 null，也不是假装有值）
    expect(metrics.database).toEqual({ fileBytes: 0, walBytes: 0 });
  });

  it('文件库：database 报出**真实体积**（内存库那条走的是 0 的分支，两条都要有）', async () => {
    // 内存库上 `databaseFileBytes()` 走 catch 分支（`:memory:` 不是文件）→ 全 0；
    // 这里用**真实的文件库**覆盖另一条分支：体积必须 > 0（否则面板上永远是 0，看不出库在长）
    const fileDir = mkdtempSync(path.join(tmpdir(), 'astrmira-metrics-db-'));
    const fileDb = openDatabase(path.join(fileDir, 'app.db'));
    try {
      const metrics = await collectMetrics({
        tasks: new TaskStore(fileDb),
        webhooks: new WebhookStore(fileDb),
        outputsDir: fileDir,
        maxBytes: 1_000,
        now: () => FIXED_NOW,
        readStorage: async () => ({
          totalBytes: 0,
          videoBytes: 0,
          videoCount: 0,
          thumbBytes: 0,
          assetBytes: 0,
          assetCount: 0,
        }),
        processInfo: {
          nodeVersion: 'v-test',
          pid: 1,
          cpuCount: 1,
          rssBytes: 1,
          heapUsedBytes: 1,
          uptimeSec: 1,
        },
      });
      expect(metrics.database.fileBytes).toBeGreaterThan(0);
    } finally {
      fileDb.close();
      rmSync(fileDir, { recursive: true, force: true });
    }
  });

  it('无任务无积压 → status ok、零告警、age 全为 null', async () => {
    const metrics = await collectMetrics({
      tasks: new TaskStore(db),
      webhooks: new WebhookStore(db),
      outputsDir: dir,
      maxBytes: 1_000,
      now: () => FIXED_NOW,
      readStorage: async () => ({
        totalBytes: 0,
        videoBytes: 0,
        videoCount: 0,
        thumbBytes: 0,
        assetBytes: 0,
        assetCount: 0,
      }),
      processInfo: {
        nodeVersion: 'v-test',
        pid: 1,
        cpuCount: 1,
        rssBytes: 1,
        heapUsedBytes: 1,
        uptimeSec: 1,
      },
    });
    expect(metrics.status).toBe('ok');
    expect(metrics.alerts).toEqual([]);
    expect(metrics.queue.oldestQueuedAgeSec).toBeNull();
    expect(metrics.webhooks.oldestPendingAgeSec).toBeNull();
  });
});

describe('§16-⑤「能不能写」必须真写一次', () => {
  it('目录可写 → ok；把"目录"指向一个文件 → 失败且给得出原因', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-probe-'));
    const good = await probeWritableDir(dir, FIXED_NOW);
    expect(good.ok).toBe(true);

    const filePath = path.join(dir, 'not-a-dir');
    writeFileSync(filePath, 'x');
    const bad = await probeWritableDir(filePath, FIXED_NOW);
    expect(bad.ok).toBe(false);
    expect(bad.detail).toContain('不可写');

    rmSync(dir, { recursive: true, force: true });
  });

  it('探针不留垃圾文件（写完就删）', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'astrmira-probe-clean-'));
    await probeWritableDir(dir, FIXED_NOW);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('§16-⑥ readiness 检查项组合', () => {
  let db: Db;
  let dir: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    dir = mkdtempSync(path.join(tmpdir(), 'astrmira-ready-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    db.close();
  });

  it('数据库可读 + 目录可写 → 两项 required 通过；ffmpeg 缺失只如实陈述、不降级', async () => {
    const deps = {
      tasks: new TaskStore(db),
      webhooks: new WebhookStore(db),
      outputsDir: dir,
      maxBytes: 1_000,
      now: () => FIXED_NOW,
      readStorage: async () => ({
        totalBytes: 0,
        videoBytes: 0,
        videoCount: 0,
        thumbBytes: 0,
        assetBytes: 0,
        assetCount: 0,
      }),
      checkMediaTools: async () => ({ ok: false, detail: 'ffprobe 缺失' }),
    };
    const checks = await collectReadinessChecks(deps);
    expect(checks.map((c) => c.id)).toEqual([
      'database',
      'storage.writable',
      'storage.headroom',
      'media.tools',
    ]);
    expect(summarizeReadiness(checks)).toBe('ready');
    expect(checks.find((c) => c.id === 'media.tools')!.ok).toBe(false);
    expect(checks.find((c) => c.id === 'storage.writable')!.ok).toBe(true);
  });

  it('数据库读不了 → required 失败 → degraded，且 detail 带原因', async () => {
    const broken = {
      tasks: {
        countByStatus: () => {
          throw new Error('database is locked');
        },
        countRunning: () => 0,
        countUncertain: () => 0,
        oldestCreatedAt: () => null,
        databaseFileBytes: () => ({ fileBytes: 0, walBytes: 0 }),
      },
      webhooks: new WebhookStore(db),
      outputsDir: dir,
      maxBytes: 1_000,
      now: () => FIXED_NOW,
      readStorage: async () => ({
        totalBytes: 0,
        videoBytes: 0,
        videoCount: 0,
        thumbBytes: 0,
        assetBytes: 0,
        assetCount: 0,
      }),
    };
    const checks = await collectReadinessChecks(broken);
    expect(summarizeReadiness(checks)).toBe('degraded');
    expect(checks[0]!.detail).toContain('database is locked');
  });
});
