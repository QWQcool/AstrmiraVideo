import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AudioGenerateRequestSchema,
  ErrorResponseSchema,
  GenerateResponseSchema,
  audioRequestToGenerateRequest,
  normalizeProjectId,
} from '@astrmira/shared';
import type { ProviderType, VideoProvider } from '@astrmira/shared';
import { createErrorResponse } from '../errors.js';
import type { JobQueue } from '../queue/JobQueue.js';
import type { CooldownStore } from '../security/rateLimit.js';
import type { ProjectStore } from '../store/projects.js';
import type { TaskStore } from '../store/taskStore.js';
import { fingerprintRequest, trackFor } from './generate.js';

/**
 * `POST /api/audio`（V2.103 / Phase 2 · 声音；CONTRACT §30）。
 *
 * ## 它为什么是"薄路由"
 * 音频产物要走**既有队列与画廊**：排队、本地单卡互斥、终态事件、历史分页、容量淘汰
 * 全部复用。所以这里只做三件事 —— **校验音频语义 → 翻译成队列认识的信封 → 入队**。
 * 真正的生成在 `providers/audio/AudioProvider` 里，状态机器与视频轨完全一样
 * （`GET /api/tasks/:id` 轮询，终态带 `outputAudioUrl`）。
 *
 * ## 两条与生成路由**刻意不同**的地方
 * 1. **不挂 60s 冷却**：一次剪辑往往会连出"旁白 + 配乐"两条，冷却会把第二条挡成 429；
 *    防重复靠幂等键（同一段文本 + 同一引擎 + 同一音色 = 同一条任务），不靠时间窗。
 * 2. **提示词上限用音频的**（`text` ≤ 1000 / `prompt` ≤ 500），不是画面的 2000 ——
 *    音频模型对超长输入的表现是截断而不是报错，那比拒绝更难排查。
 */

export interface AudioRoutesDeps {
  store: TaskStore;
  queue: JobQueue;
  resolveProvider: (id: ProviderType) => VideoProvider | null;
  /** 传了就校验 projectId 存在（与生成路由同口径）；生产装配必须传 */
  projects?: ProjectStore;
  /**
   * 保留：与生成路由共用同一个冷却存储，但本路由**不调用**它。
   * 明确放在这里是为了让下一个人看到"不挂冷却"是决定而不是遗漏。
   */
  cooldown?: CooldownStore;
}

export const createAudioRoutes =
  (deps: AudioRoutesDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/api/audio',
      {
        schema: {
          body: AudioGenerateRequestSchema,
          response: {
            200: GenerateResponseSchema,
            400: ErrorResponseSchema,
            404: ErrorResponseSchema,
            503: ErrorResponseSchema,
          },
        },
      },
      async (request, reply) => {
        const body = request.body;

        const projectId = normalizeProjectId(body.projectId);
        if (deps.projects !== undefined && deps.projects.get(projectId) === null) {
          return reply
            .code(404)
            .send(createErrorResponse('PROJECT_NOT_FOUND', `项目不存在：${projectId}`));
        }

        // 翻译成信封（纯函数；`aspectRatio` 固定 16:9，音频不读它 —— 见 shared/audio.ts 文件头）
        const envelope = audioRequestToGenerateRequest(body);

        const provider = deps.resolveProvider(envelope.provider);
        if (provider === null) {
          // 没配 Key / 连不上 ComfyUI / 引擎根本没装 —— 一律如实 503，绝不降级到"另一个引擎"
          return reply.code(503).send(
            createErrorResponse(
              'PROVIDER_UNAVAILABLE',
              `音频引擎未配置或未启用：${envelope.provider}` +
                (envelope.provider === 'mimo-tts'
                  ? '（需要 MIMO_API_KEY）'
                  : '（需要 COMFYUI_AUDIO_BASE 指向本机 ComfyUI）'),
            ),
          );
        }

        const idempotencyKey = fingerprintRequest(envelope);

        // 幂等重放优先：同一段文本重复点两次 = 同一条任务（不重复花钱）
        const existing = deps.store.findTaskIdByIdempotencyKey(idempotencyKey);
        if (existing !== null) return { taskId: existing };

        const taskId = randomUUID();
        await deps.queue.submit({
          taskId,
          track: trackFor(envelope.provider),
          request: envelope,
          idempotencyKey,
          projectId,
          submitting: true,
        });

        return { taskId };
      },
    );
  };
