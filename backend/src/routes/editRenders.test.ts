import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../index.js';
import { openDatabase } from '../store/db.js';
import { TaskStore } from '../store/taskStore.js';

/**
 * `POST /api/edits/renders`（CONTRACT §11-2；B34 · P4）——浏览器端渲染产物入库。
 *
 * 关键差异（与 §11-3 的服务端 ffmpeg 剪辑）：**服务端不渲染**，只校验 + 归档，
 * 因此这里是**同步成功**路径，可以用真实 HTTP 全量测（无需队列/轮询/ffmpeg 执行）。
 *
 * 断言口径：
 * - 落盘事实优先（成片文件真的在 `outputs/<taskId>.mp4`，封面真的在 `outputs/thumbs/`）；
 * - `origin.project` 原样入库（服务端只存不改——用一次往返比对整份工程 JSON）；
 * - 两代剪辑产物在历史查询里**并存**（`?kind=edit&source=` 同时返回 EDL 与工程记录）。
 */

const TMP_DATA = mkdtempSync(path.join(tmpdir(), 'astrmira-render-data-'));
const TMP_OUT = mkdtempSync(path.join(tmpdir(), 'astrmira-render-out-'));
const CLIPS_DIR = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'clips');

let app: Awaited<ReturnType<typeof buildApp>>;

const REQUEST_SNAPSHOT = {
  prompt: '渲染入库源片',
  mode: 't2v' as const,
  aspectRatio: '16:9' as const,
  provider: 'fixture-local' as const,
};

/** 一段真实 MP4（复用夹具片段：它就在仓库里，且魔数真实） */
function realMp4(): Buffer {
  const file = path.join(CLIPS_DIR, 'base-720p-landscape-5s-audio.mp4');
  if (!existsSync(file)) {
    throw new Error(
      `夹具片段缺失：${file}\n  先执行 \`pnpm test:fixtures\`（CI 由工作流同名步骤负责）。`,
    );
  }
  return readFileSync(file);
}

/** 一份最小但完全合法的多轨工程（一轨一片段） */
function validProject() {
  return {
    version: 1 as const,
    fps: 30,
    width: 1280,
    height: 704,
    tracks: [
      {
        id: 'track-video',
        kind: 'video' as const,
        clips: [
          {
            kind: 'video' as const,
            id: 'clip-1',
            startFrame: 0,
            durationFrames: 90,
            source: { taskId: 'seed-source', url: '/media/seed-source.mp4', durationFrames: 120 },
            trimStartFrames: 0,
            speed: 1,
            volume: 1,
          },
        ],
      },
      { id: 'track-transition', kind: 'transition' as const, clips: [] },
      { id: 'track-caption', kind: 'caption' as const, clips: [] },
      { id: 'track-audio', kind: 'audio' as const, clips: [] },
    ],
  };
}

function multipart(
  file: { filename: string; contentType: string; content: Buffer } | null,
  fields: Record<string, string>,
): { boundary: string; payload: Buffer } {
  const boundary = '----astrmiraRenderBoundary';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }
  if (file !== null) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
    );
    parts.push(file.content);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { boundary, payload: Buffer.concat(parts) };
}

async function postRender(
  file: { filename: string; contentType: string; content: Buffer } | null,
  fields: Record<string, string>,
) {
  const { boundary, payload } = multipart(file, fields);
  return app.inject({
    method: 'POST',
    url: '/api/edits/renders',
    remoteAddress: '198.51.100.77',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
}

beforeAll(async () => {
  process.env.DATA_DIR = TMP_DATA;
  process.env.OUTPUT_DIR = TMP_OUT;

  // 种子：一条"已成功的源任务"（路由的引用完整性校验需要它）
  const db = openDatabase(path.join(TMP_DATA, 'app.db'));
  new TaskStore(db).insert({
    taskId: 'seed-source',
    track: 'cloud',
    provider: 'fixture-local',
    status: 'succeeded',
    progressPercent: 100,
    requestSnapshot: REQUEST_SNAPSHOT,
    outputVideoUrl: '/media/seed-source.mp4',
    warnings: [],
    submitting: false,
  });
  db.close();

  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const dir of [TMP_DATA, TMP_OUT]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* 临时目录残留无碍 */
    }
  }
});

describe('POST /api/edits/renders', () => {
  it('成功：产物落盘 + 任务入库（origin.project 原样往返）+ 封面尽力而为', async () => {
    const project = validProject();
    const response = await postRender(
      { filename: 'render.mp4', contentType: 'video/mp4', content: realMp4() },
      { sourceTaskId: 'seed-source', project: JSON.stringify(project) },
    );
    expect(response.statusCode).toBe(200);
    const { taskId } = response.json() as { taskId: string };

    // 落盘事实（不看响应自证）
    expect(existsSync(path.join(TMP_OUT, `${taskId}.mp4`))).toBe(true);

    // 任务记录：终态 / 剪辑来源 / 工程原样
    const task = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` });
    expect(task.statusCode).toBe(200);
    const progress = task.json() as {
      status: string;
      outputVideoUrl?: string;
      origin?: { kind: string; sourceTaskId: string; project?: unknown };
    };
    expect(progress.status).toBe('succeeded');
    expect(progress.outputVideoUrl).toBe(`/media/${taskId}.mp4`);
    expect(progress.origin?.kind).toBe('edit');
    expect(progress.origin?.sourceTaskId).toBe('seed-source');
    // 工程 JSON 往返一致（服务端只存不改）
    expect(progress.origin?.project).toEqual(project);
  });

  it('历史查询：两代剪辑产物并存 —— ?kind=edit&source= 能查到，默认历史**不含**它', async () => {
    const response = await postRender(
      { filename: 'render2.mp4', contentType: 'video/mp4', content: realMp4() },
      { sourceTaskId: 'seed-source', project: JSON.stringify(validProject()) },
    );
    expect(response.statusCode).toBe(200);

    const edits = await app.inject({
      method: 'GET',
      url: '/api/history?kind=edit&source=seed-source',
    });
    const editItems = (edits.json() as { items: { origin?: { project?: unknown } }[] }).items;
    expect(editItems.length).toBeGreaterThanOrEqual(1);
    expect(editItems.some((item) => item.origin?.project !== undefined)).toBe(true);

    const main = await app.inject({ method: 'GET', url: '/api/history' });
    const mainItems = (main.json() as { items: { taskId: string }[] }).items;
    // 主历史只有**生成产物**（种子任务）；上面入库的渲染产物不得混进来（V9 拍板的口径，V2.5 保持）
    expect(mainItems).toHaveLength(1);
    expect(mainItems[0]!.taskId).toBe('seed-source');
  });

  it('拒绝：缺字段 / 非法 JSON / 工程结构不合法（都是 400）', async () => {
    const missing = await postRender(
      { filename: 'a.mp4', contentType: 'video/mp4', content: realMp4() },
      { sourceTaskId: 'seed-source' },
    );
    expect(missing.statusCode).toBe(400);
    expect((missing.json() as { code: string }).code).toBe('INVALID_REQUEST');

    const badJson = await postRender(
      { filename: 'a.mp4', contentType: 'video/mp4', content: realMp4() },
      { sourceTaskId: 'seed-source', project: '{ 不是 JSON' },
    );
    expect(badJson.statusCode).toBe(400);

    const badShape = await postRender(
      { filename: 'a.mp4', contentType: 'video/mp4', content: realMp4() },
      { sourceTaskId: 'seed-source', project: JSON.stringify({ version: 1, fps: 30 }) },
    );
    expect(badShape.statusCode).toBe(400);
    expect((badShape.json() as { message: string }).message).toContain('工程结构不合法');
  });

  it('拒绝：源任务不存在 / 没有成片（404）', async () => {
    const response = await postRender(
      { filename: 'a.mp4', contentType: 'video/mp4', content: realMp4() },
      { sourceTaskId: 'no-such-task', project: JSON.stringify(validProject()) },
    );
    expect(response.statusCode).toBe(404);
    expect((response.json() as { code: string }).code).toBe('TASK_NOT_FOUND');
  });

  it('拒绝：不是 MP4（魔数嗅探，不看 Content-Type）→ 415', async () => {
    const notMp4 = Buffer.from('这其实是一段文本，不是视频文件', 'utf8');
    const response = await postRender(
      { filename: 'fake.mp4', contentType: 'video/mp4', content: notMp4 },
      { sourceTaskId: 'seed-source', project: JSON.stringify(validProject()) },
    );
    expect(response.statusCode).toBe(415);
    expect((response.json() as { code: string }).code).toBe('INVALID_ASSET');
  });

  it('拒绝：超过 100MB（V2.6 起，与反代请求体上限同口径）→ 413', async () => {
    // 101MB 的"MP4"：体积闸门必须在嗅探之前就拦下（否则要白读一遍内存）
    const huge = Buffer.alloc(101 * 1024 * 1024, 0x41);
    const response = await postRender(
      { filename: 'huge.mp4', contentType: 'video/mp4', content: huge },
      { sourceTaskId: 'seed-source', project: JSON.stringify(validProject()) },
    );
    expect(response.statusCode).toBe(413);
  });
});
