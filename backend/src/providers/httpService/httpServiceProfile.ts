import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  GenerationModeSchema,
  HTTP_SERVICE_NAME_PATTERN,
  HTTP_SERVICE_PROVIDER_PREFIX,
  type GenerationMode,
} from '@astrmira/shared';
import { isAllowedEngineUrl } from '../statusProbe.js';

/**
 * 配置型 HTTP 任务服务（CONTRACT §22 / V2.47 / D67 / D71）。
 *
 * 形态参考 infOS/Pictoria 的 ServiceProfile（Apache-2.0，见 docs/INFOS-REVIEW.md），
 * 但只保留本仓需要的最小集合：submit → taskId → poll → outputs（以及可选的 sync / cancel）。
 *
 * 三条纪律：
 * 1. **地址只允许回环 / RFC1918**：这是“部署者自己配的远程引擎”，不是让请求体指定地址的 SSRF 面；
 * 2. **token 只从 env 读**：JSON 里写 token 直接判配置错误；`/status` 不下发地址与 token；
 * 3. **坏配置逐实例标记不可用**：不静默回落成空列表，也不影响同文件里的其它实例。
 */

const NAME = HTTP_SERVICE_NAME_PATTERN;
const AUTH_HEADER_KEYS = /authorization|cookie|api[-_]?key|token|secret/i;

const OutputSchema = z
  .object({
    path: z.string().max(240),
    kind: z.enum(['image', 'video']),
  })
  .strict();

const FieldMappingSchema = z
  .object({
    from: z.string().min(1).max(120),
    format: z.enum(['value', 'text', 'data_url', 'file']).default('value'),
  })
  .strict();

const SubmitSchema = z
  .object({
    path: z.string().min(1).max(2048),
    // 本版只支持 POST submit：GET + body 在 fetch 里本身不合法，
    // 静默忽略字段比明确拒绝更糟；需要 GET 任务接口时再单独设计 query 映射。
    method: z.literal('POST').default('POST'),
    body: z.record(z.string(), z.unknown()).default({}),
    bodyFormat: z.enum(['json', 'multipart']).default('json'),
    fields: z.record(z.string(), FieldMappingSchema).default({}),
    taskIdField: z.string().min(1).max(120).optional(),
  })
  .strict();

const PollSchema = z
  .object({
    path: z.string().min(1).max(2048),
    method: z.enum(['GET', 'POST']).default('GET'),
    stateField: z.string().min(1).max(120),
    success: z.array(z.string().min(1)).min(1),
    failed: z.array(z.string().min(1)).min(1),
  })
  .strict();

const CancelSchema = z
  .object({
    path: z.string().min(1).max(2048),
    method: z.enum(['POST', 'DELETE']).default('POST'),
  })
  .strict();

const HealthSchema = z
  .object({
    path: z.string().min(1).max(2048).default('/health'),
    method: z.literal('GET').default('GET'),
  })
  .strict();

export const HttpServiceEntrySchema = z
  .object({
    name: z.string().regex(NAME, 'name 限 [A-Za-z0-9_-]{1,24}'),
    label: z.string().min(1).max(60).optional(),
    baseUrl: z.string().url(),
    modes: z.array(GenerationModeSchema).min(1).default(['t2v']),
    tokenEnv: z
      .string()
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'tokenEnv 必须是环境变量名')
      .optional(),
    authHeader: z.string().regex(/^[\w-]+$/).default('Authorization'),
    authPrefix: z.string().max(40).default('Bearer '),
    headers: z
      .record(z.string(), z.string())
      .default({})
      .refine(
        (headers) => !Object.keys(headers).some((key) => AUTH_HEADER_KEYS.test(key)),
        '认证字段请使用 tokenEnv，不要写进普通 headers',
      ),
    submit: SubmitSchema,
    poll: PollSchema.optional(),
    cancel: CancelSchema.optional(),
    health: HealthSchema.optional(),
    outputs: z.record(z.string(), OutputSchema).default({}),
    idempotencyHeader: z.string().regex(/^[\w-]+$/).optional(),
    timeoutMs: z.number().int().min(1000).max(3_600_000).default(600_000),
    requestTimeoutMs: z.number().int().min(1000).max(3_600_000).default(60_000),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.submit.taskIdField !== undefined && entry.poll === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['poll'],
        message: '配了 submit.taskIdField 就必须配 poll（否则拿不到结果）',
      });
    }
    if (entry.poll !== undefined && entry.submit.taskIdField === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['submit', 'taskIdField'],
        message: '配了 poll 就必须配 submit.taskIdField（否则不知道轮询哪个 id）',
      });
    }
    if (Object.keys(entry.outputs).length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['outputs'],
        message: '至少配置一个 image 或 video 输出',
      });
    }
    for (const [key, mapping] of Object.entries(entry.submit.fields)) {
      if (mapping.format === 'file' && entry.submit.bodyFormat !== 'multipart') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['submit', 'fields', key],
          message: 'file 字段需要 bodyFormat=multipart',
        });
      }
    }
  });

export type HttpServiceEntry = z.infer<typeof HttpServiceEntrySchema>;
export const HttpServicesFileSchema = z.array(HttpServiceEntrySchema).min(1).max(8);

export interface HttpService {
  id: string;
  name: string;
  label: string;
  profile: HttpServiceEntry;
  modes: GenerationMode[];
  /** 配置事实：地址/凭据 env/结构都过了没（不表示刚才通不通） */
  available: boolean;
  reason?: string;
}

export interface ResolvedHttpServices {
  servers: HttpService[];
  problems: string[];
}

export function httpServiceId(name: string): string {
  return `${HTTP_SERVICE_PROVIDER_PREFIX}${name}`;
}

function configured(entry: HttpServiceEntry, env: NodeJS.ProcessEnv): HttpService {
  const id = httpServiceId(entry.name);
  const label = entry.label ?? entry.name;
  const modes = [...new Set(entry.modes)];

  if (!isAllowedEngineUrl(entry.baseUrl)) {
    return {
      id,
      name: entry.name,
      label,
      profile: entry,
      modes,
      available: false,
      reason: '地址不合规：HTTP 服务只允许回环或内网地址（http / https）',
    };
  }

  if (entry.tokenEnv !== undefined) {
    const token = env[entry.tokenEnv]?.trim();
    if (token === undefined || token === '') {
      return {
        id,
        name: entry.name,
        label,
        profile: entry,
        modes,
        available: false,
        reason: `凭据环境变量未设置（${entry.tokenEnv}）`,
      };
    }
  }

  return { id, name: entry.name, label, profile: entry, modes, available: true };
}

function readServicesFile(file: string): { entries: HttpServiceEntry[] } | { problem: string } {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {
      problem: 'HTTP_SERVICES_FILE 指向的文件读不出来（请确认它存在、路径正确且可读）',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { problem: 'HTTP_SERVICES_FILE 不是合法的 JSON' };
  }

  const result = HttpServicesFileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      problem:
        'HTTP_SERVICES_FILE 结构不对' +
        (first === undefined
          ? ''
          : `：第 ${Number(first.path[0] ?? 0) + 1} 项 ${first.path.slice(1).join('.')} ${first.message}`),
    };
  }
  return { entries: result.data };
}

/**
 * 解析出“这台服务上配了哪些 HTTP 任务服务”（纯函数：读 env + 读一次文件）。
 *
 * 同名项后面的那一条标记不可用（不静默覆盖）；文件级问题放进 `problems`，
 * 由 `/status` 如实带出 —— 不假装“只是没配”。
 */
export function resolveHttpServices(env: NodeJS.ProcessEnv = process.env): ResolvedHttpServices {
  const file = env.HTTP_SERVICES_FILE?.trim();
  if (file === undefined || file === '') {
    return { servers: [], problems: [] };
  }

  const loaded = readServicesFile(file);
  if ('problem' in loaded) return { servers: [], problems: [loaded.problem] };

  const servers: HttpService[] = [];
  const seen = new Set<string>();
  for (const entry of loaded.entries) {
    const server = configured(entry, env);
    if (seen.has(entry.name)) {
      servers.push({
        ...server,
        available: false,
        reason: `实例名重复：${entry.name}（name 必须唯一）`,
      });
      continue;
    }
    seen.add(entry.name);
    servers.push(server);
  }
  return { servers, problems: [] };
}

/** 按 provider id 找实例（registry 用）；找不到 / 不可用 → null → 503 */
export function findHttpService(
  id: string,
  servers: HttpService[] = resolveHttpServices().servers,
): HttpService | null {
  return servers.find((server) => server.id === id) ?? null;
}
