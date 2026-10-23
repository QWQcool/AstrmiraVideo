import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  DEFAULT_PROJECT_ID,
  ErrorResponseSchema,
  HistoryImportRequestSchema,
  HistoryImportResponseSchema,
} from '@astrmira/shared';
import type { TaskProgress, VideoGenerateRequest } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import { createAssetThumbnail, THUMBNAIL_DIR_NAME } from '../pipeline/thumbnail.js';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import type { ProjectStore } from '../store/projects.js';
import { TaskStore, toTaskProgress } from '../store/taskStore.js';

/**
 * `POST /api/history/import`（S7-D8 / P3）
 *
 * 把本站已经上传的 assetId 登记成一条“导入历史”；不是模型生成任务：
 * provider=`imported`、无上游 taskId、无成本、无重试。
 *
 * 安全边界：
 * 1. 只接受资产库里真实存在的 UUID 文件；
 * 2. 不接受任意 URL；
 * 3. 最多一次 20 条；
 * 4. 项目不存在则整批 400（和上传/生成的项目口径一致）。
 */
export interface HistoryImportRoutesDeps {
  store?: TaskStore;
  projects?: ProjectStore;
  outputsDir?: string;
  createThumbnail?: (assetId: string, sourcePath: string) => Promise<string>;
}

const ASSET_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const THUMBS = THUMBNAIL_DIR_NAME;

async function findAssetFile(assetsDir: string, assetId: string): Promise<string | null> {
  const names = await readdir(assetsDir);
  const name = names.find(
    (entry) => entry.startsWith(`${assetId}.`) && !entry.endsWith('.json'),
  );
  return name === undefined ? null : path.join(assetsDir, name);
}

function extensionKind(name: string): 'image' | 'video' | null {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp') return 'image';
  if (ext === '.mp4' || ext === '.mov') return 'video';
  return null;
}

export const createHistoryImportRoutes =
  (deps: HistoryImportRoutesDeps = {}): FastifyPluginAsyncZod =>
  async (app) => {
    const store = deps.store;
    if (store === undefined) throw new Error('history import routes 需要 TaskStore');
    const outputsDir = deps.outputsDir ?? resolveOutputsDir();
    const assetsDir = path.join(outputsDir, 'assets');
    const thumbnailsDir = path.join(outputsDir, THUMBS);
    const createThumbnail =
      deps.createThumbnail ??
      ((assetId: string, sourcePath: string) =>
        createAssetThumbnail({ outputsDir, assetId, sourcePath }));

    app.post(
      '/api/history/import',
      {
        schema: {
          body: HistoryImportRequestSchema,
          response: {
            200: HistoryImportResponseSchema,
            400: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const projectId = request.body.projectId ?? DEFAULT_PROJECT_ID;
        if (deps.projects !== undefined && deps.projects.get(projectId) === null) {
          return reply
            .code(400)
            .send(createErrorResponse('INVALID_REQUEST', `项目不存在：${projectId}`));
        }

        const tasks: TaskProgress[] = [];
        for (const item of request.body.items) {
          if (!ASSET_ID_PATTERN.test(item.assetId)) {
            return reply
              .code(400)
              .send(createErrorResponse('INVALID_REQUEST', `assetId 形状非法：${item.assetId}`));
          }
          const filePath = await findAssetFile(assetsDir, item.assetId);
          if (filePath === null) {
            return reply
              .code(400)
              .send(createErrorResponse('INVALID_REQUEST', `资产不存在：${item.assetId}`));
          }
          const actualKind = extensionKind(filePath);
          if (actualKind === null || actualKind !== item.kind) {
            return reply
              .code(400)
              .send(
                createErrorResponse(
                  'INVALID_REQUEST',
                  `资产类型不匹配：${item.assetId} 不是 ${item.kind}`,
                ),
              );
          }

          const fileName = path.basename(filePath);
          const url = `/media/assets/${fileName}`;
          let thumbnailUrl: string | undefined;
          if (item.kind === 'video') {
            await mkdir(thumbnailsDir, { recursive: true });
            const thumbnailPath = path.join(thumbnailsDir, `${item.assetId}.jpg`);
            let thumbnailReady = false;
            try {
              await access(thumbnailPath);
              thumbnailReady = true;
            } catch {
              try {
                await createThumbnail(item.assetId, filePath);
                thumbnailReady = true;
              } catch {
                /* 缩略图失败不影响历史记录；界面回落到 video 首帧 */
              }
            }
            if (thumbnailReady) thumbnailUrl = `/media/${THUMBS}/${item.assetId}.jpg`;
          }

          const taskId = randomUUID();
          const requestSnapshot: VideoGenerateRequest = {
            prompt: item.prompt ?? item.title ?? '外部导入素材',
            mode: item.kind === 'image' ? 't2i' : 't2v',
            aspectRatio: '16:9',
            provider: 'imported',
            projectId,
            origin: 'create',
          };
          const record = store.insert({
            taskId,
            track: 'local',
            provider: 'imported',
            status: 'succeeded',
            progressPercent: 100,
            requestSnapshot,
            ...(item.kind === 'video'
              ? { outputVideoUrl: url }
              : { outputImageUrl: url }),
            ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
            warnings: [
              `从外部导入${item.source === undefined ? '' : `（${item.source}）`}；不是本服务生成。`,
            ],
            submitting: false,
            projectId,
            ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
          });
          tasks.push(toTaskProgress(record));
        }

        return { tasks };
      },
    );
  };
