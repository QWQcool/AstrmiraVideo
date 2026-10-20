import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ProviderStatusSchema, SelfCheckResponseSchema } from '@astrmira/shared';
import type {
  ComfyUiServerStatus,
  HttpServiceServerStatus,
  ProviderStatus,
  SelfCheckEntry,
  SelfCheckResponse,
} from '@astrmira/shared';
import { getProvider } from '../providers/registry.js';
import { DEFAULT_COMFY_SERVER_ID, resolveComfyServers } from '../providers/comfyui/comfyuiServers.js';
import { resolveHttpServices } from '../providers/httpService/httpServiceProfile.js';

/** 部署者是否向访客开放 host 本地轨（CONTRACT §2：`EXPOSE_HOST_LOCAL_TRACK`，默认 0） */
function isHostLocalTrackExposed(): boolean {
  return process.env.EXPOSE_HOST_LOCAL_TRACK === '1';
}

/** 服务端视角的云端状态：只表示 env 兜底 Key 是否存在（客户端 Key 由前端自行合成） */
function resolveCloudStatus(): ProviderStatus['cloud'] {
  const envKey = process.env.VOLCANO_API_KEY;
  const hasEnvKey = typeof envKey === 'string' && envKey.trim() !== '';

  return hasEnvKey
    ? {
        available: true,
        provider: 'volcano-seedance',
        keySource: 'env',
        acceptsClientKey: true,
        reason: '服务端已配置兜底 Key（env）',
      }
    : {
        available: false,
        provider: 'volcano-seedance',
        acceptsClientKey: true,
        reason: '服务端未配置兜底 Key（BYOK：由客户端随请求头携带）',
      };
}

/**
 * `local` 段（**V2.37：这一档已撤** —— 决策 D56；用户 2026-10-15 拍板）。
 *
 * 为什么**保留字段**而不是从响应里删掉：旧前端产物（浏览器里缓存的 dist）读的是这个字段 ——
 * 保留时它读到一句**人话**（"这一档没有了，本地轨请用 ComfyUI"）；删掉它会读到 `undefined`
 * 而落进"状态未知"分支，那比"这一档已撤"更难懂。
 *
 * `available` **恒为 false**：它确实不可用（注册表里没有实现，提交得到 503）。
 * `tier` 不再出现（`H3_TIER` 支持已随该档删除）。
 *
 * 文案纪律（PLAN §3 铁律 2）不变：reason 不得出现「你的设备 / 你没有显卡」类判断。
 */
function resolveLocalStatus(): ProviderStatus['local'] {
  return {
    available: false,
    provider: 'minimax-h3',
    reason:
      '本地 MiniMax H3 档已撤掉：本地轨请用 host-comfyui（自备 ComfyUI，且 H3 的模型可以在它里面跑）',
  };
}

/**
 * 文本轨能力位（CONTRACT §2 V2.0，PLAN §6-D24）：**纯 BYOK** —— 服务端不设兜底 Key。
 *
 * 所以这里 `available` **恒为 false**，而且这一点必须写清楚：
 * 前端合成实际能力 = `acceptsClientKey && 本地有 LLM Key`。
 * 若把 `available` 当成"能不能用扩写"，就会复刻 V1.6 那个
 * 「用户填了 Key 也用不了」的漏洞（状态端点没有凭据上下文，它不知道访客手里有什么）。
 */
/**
 * 本地 ComfyUI（V2.31 / A1 片 C / CONTRACT §19）：与 `local` 同一套门控。
 *
 * 三条判定，顺序即优先级（都只是**本服务的配置事实**）：
 * 1. 没向访客开放本地轨 → 不可用（**默认如此** —— ComfyUI 跑在部署者的机器上，
 *    不因为"配了地址"就自动对访客开放）；
 * 2. `COMFYUI_BASE_URL` 未配 / 地址不合规（同一份白名单 `isAllowedEngineUrl`）→ 不可用；
 * 3. 都过 → 可用。
 *
 * **不在这里探测模式能力**（那要连用户的 ComfyUI）—— 见 `ComfyUiProviderStatusSchema` 的说明。
 */
function resolveComfyUiStatus(): ProviderStatus['comfyui'] {
  const { servers, problems } = resolveComfyServers();
  const exposed = isHostLocalTrackExposed();
  const notExposed = '本服务未向访客开放本地轨';

  // **不下发地址**：只给 id / label / available / reason（脱敏，§2）
  const described: ComfyUiServerStatus[] = servers.map((server) =>
    exposed
      ? {
          id: server.id,
          label: server.label,
          available: server.available,
          ...(server.reason === undefined ? {} : { reason: server.reason }),
        }
      : { id: server.id, label: server.label, available: false, reason: notExposed },
  );

  // 文件级问题（读不出来 / 结构不对）**排在最前**：它比"某一台不合规"更该被看到
  const head = problems.length === 0 ? '' : `${problems.join('；')}；`;

  if (!exposed) {
    return { available: false, provider: 'comfyui', servers: described, reason: notExposed };
  }
  if (servers.length === 0) {
    return {
      available: false,
      provider: 'comfyui',
      servers: [],
      reason: `${head}本服务未配置 ComfyUI（缺 COMFYUI_BASE_URL 或 COMFYUI_SERVERS_FILE）`,
    };
  }

  const usable = described.filter((server) => server.available).length;
  // 全部不可用时，段级 reason 里**要能直接读到原因**（单实例部署下这里就是唯一入口）——
  // 多台时带第一台的原因并指明其余在 `servers` 里（不去拼一串谁也读不完的话）
  const firstBad = described.find((server) => !server.available);
  const allBad = `${head}本服务配置的 ComfyUI 实例都不可用：${
    firstBad?.reason ?? '原因见各实例'
  }${described.length > 1 ? '（其余实例的原因见 servers）' : ''}`;

  return {
    available: usable > 0,
    provider: 'comfyui',
    servers: described,
    reason:
      usable > 0
        ? `${head}本服务已配置 ${servers.length} 台 ComfyUI（合规 ${usable} 台；能跑哪些模式在提交时判定）`
        : allBad,
  };
}

/**
 * V2.47（§22）：配置型 HTTP 任务服务——配置事实，不探测远端。
 * 地址与 token 一律不下发；只给 id / label / modes / available / reason。
 */
function resolveHttpServicesStatus(): ProviderStatus['httpServices'] {
  const { servers, problems } = resolveHttpServices();
  const head = problems.length === 0 ? '' : `${problems.join('；')}；`;
  const described: HttpServiceServerStatus[] = servers.map((server) => ({
    id: server.id,
    label: server.label,
    modes: server.modes,
    available: server.available,
    ...(server.reason === undefined ? {} : { reason: server.reason }),
  }));

  if (servers.length === 0) {
    return {
      available: false,
      provider: 'http-service',
      servers: [],
      reason: `${head}本服务未配置 HTTP 任务服务（缺 HTTP_SERVICES_FILE）`,
    };
  }

  const usable = described.filter((server) => server.available).length;
  const firstBad = described.find((server) => !server.available);
  return {
    available: usable > 0,
    provider: 'http-service',
    servers: described,
    reason:
      usable > 0
        ? `${head}本服务已配置 ${servers.length} 个 HTTP 服务（可用 ${usable} 个；能力在提交时按 modes 判定）`
        : `${head}本服务配置的 HTTP 服务都不可用：${firstBad?.reason ?? '原因见各实例'}`,
  };
}

function resolveLlmStatus(): ProviderStatus['llm'] {
  return {
    available: false,
    provider: 'openai-compatible',
    acceptsClientKey: true,
    reason: '本服务不提供文本侧兜底 Key（纯 BYOK）：请在设置里填入 LLM Key',
  };
}

/**
 * 本地引擎配置状态（S5 接入启动自检前为固定未配置态）。
 * 契约：CONTRACT §2（V1.8 / V2.0）。
 * 本文件**不得**出现任何具体显卡型号或显存数字（PLAN §6-D27）。
 */
export function buildProviderStatus(): ProviderStatus {
  return {
    cloud: resolveCloudStatus(),
    local: resolveLocalStatus(),
    comfyui: resolveComfyUiStatus(),
    httpServices: resolveHttpServicesStatus(),
    llm: resolveLlmStatus(),
    defaultProvider: 'cloud-volcano-seedance',
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 本地引擎**运行时自检**（V2.34 / 台账 B4 / CONTRACT §20）
//
// 它回答的问题与 `/status` 不同：`/status` 说"你**配了没有**"，这里说"**刚才通不通**"。
// 所以它**真的去连一次** ComfyUI（因此慢几秒），并且只在用户**显式点击**时被调用。
// ────────────────────────────────────────────────────────────────────────────

/**
 * 自检范围（**V2.36 起动态**）：本地 H3 + **每一个**配好的 ComfyUI 实例。
 *
 * 为什么按实例逐条列：多台引擎最需要的可观测性就是"**哪一台连不上**" ——
 * 把三台合成一条"ComfyUI 不可用"，用户还得自己一台台去试。
 *
 * 云端不在范围内：它的"可用"是"有没有 env 兜底 Key"这种配置事实（`/status` 已经答了）。
 */
function selfCheckTargets(): string[] {
  const ids = resolveComfyServers().servers.map((server) => server.id);
  // ⚠️ **一台都没配时不把 ComfyUI 藏起来**：B4 的价值正是"点一下就知道缺什么"。
  // V2.37（D56）：H3 那一项已随该档撤掉 —— 不再检测一个不存在的档位。
  return ids.length === 0 ? [DEFAULT_COMFY_SERVER_ID] : ids;
}

/**
 * 自检的**硬超时**。
 *
 * 为什么必须有：ComfyUI 的地址可能**连得上但不响应**（端口开着、进程卡住），
 * 那种情况下 `fetch` 会一直挂着 —— 一个"检测"按钮转十分钟，比报一句"超时"糟得多。
 * 15s 的依据：`/object_info` 在真机上约 10MB、本地读取在 1s 内（实测），留一个数量级余量。
 */
const SELF_CHECK_TIMEOUT_MS = 15_000;

/**
 * 自检时**强制刷新**能力位的可选能力（duck typing）。
 *
 * 为什么需要：`ComfyUiProvider` 的模型/节点清单有 10 分钟缓存（`/object_info` 很大，
 * 不该每次调用都拉一遍）。但用户点自检往往是"我刚在 ComfyUI 里换了模型" ——
 * 拿 10 分钟前的清单回答他，就没意义了。
 *
 * 为什么是 duck typing 而不是改接口：`VideoProvider.checkHealth()` 的形状属于契约 §4
 * （不得改变接口形状），所以实现方**可以**多接受一个可选参数（TS 下仍满足该接口），
 * 这里探测性地传一次；不认这个参数的实现忽略它、行为不变。
 */
type RefreshableHealth = (options?: { refresh?: boolean }) => Promise<{
  available: boolean;
  reason?: string;
}>;

/** 给任意 promise 套硬超时（超时后**如实**回报，而不是让请求挂着） */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  // 亚秒级的超时值只在测试里出现（跑 15s 的用例不可接受），但消息要照样读得通
  const human = ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}超时（${human} 未响应）`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 未注册时如实说明**为什么** —— 这一档的三种"不可用"原因完全不同，
 * 混成一句"不可用"会让用户去改错的配置项。
 */
function describeUnregistered(id: string): string {
  if (!isHostLocalTrackExposed()) {
    return '本服务未向访客开放本地轨（部署者自用需显式设 EXPOSE_HOST_LOCAL_TRACK=1）';
  }
  // V2.37（D56）：H3 那一档已撤掉 —— 走到这里只可能是"某个 ComfyUI 实例不在表里"
  // V2.36：逐实例说清"是哪一台的问题、问题是什么"（比一句"ComfyUI 不可用"可行动得多）
  const { servers } = resolveComfyServers();
  if (servers.length === 0) {
    return '本服务没有可用的 ComfyUI 后端：缺 COMFYUI_BASE_URL 或 COMFYUI_SERVERS_FILE，或地址不在回环 / 内网白名单内';
  }
  const server = servers.find((item) => item.id === id);
  if (server === undefined) {
    return '这一台不在本服务的实例表里（COMFYUI_SERVERS_FILE 里没有它）';
  }
  return server.reason ?? '这一台不可用（原因见 /api/providers/status 的 comfyui.servers）';
}

async function selfCheckOne(id: string, timeoutMs: number): Promise<SelfCheckEntry> {
  // 自检语义的上下文：只需要"能不能问这个引擎"，与凭据无关（PROBE_CONTEXT 同一条）
  const provider = getProvider(id, { taskId: 'selfcheck' });
  if (provider === null) {
    return { provider: id, available: false, reason: describeUnregistered(id) };
  }

  try {
    const health = await withTimeout(
      (provider.checkHealth as RefreshableHealth)({ refresh: true }),
      timeoutMs,
      '本地引擎自检',
    );
    return {
      provider: id,
      available: health.available,
      ...(health.reason === undefined ? {} : { reason: health.reason }),
    };
  } catch (error) {
    return {
      provider: id,
      available: false,
      reason: `自检失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 跑一次本地引擎运行时自检（CONTRACT §20）。
 *
 * **只读、无副作用**：不提交任务、不写盘、不改任何状态；结果**不缓存**
 * （用户点了就是"现在看一次"）。
 *
 * 两档**并行**且各自 try/catch：一个后端挂着不拖累另一项、一个炸了不影响另一个的结论 ——
 * 这正是自检相对"提交时才发现"的价值（后者一次只暴露一个错误）。
 */
export async function buildSelfCheck(timeoutMs: number = SELF_CHECK_TIMEOUT_MS): Promise<SelfCheckResponse> {
  const entries = await Promise.all(selfCheckTargets().map((id) => selfCheckOne(id, timeoutMs)));
  return { checkedAt: new Date().toISOString(), entries };
}

/**
 * 算力 / 本地引擎状态路由（CONTRACT §5）。
 */
export const providerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/providers/status',
    {
      schema: {
        response: { 200: ProviderStatusSchema },
      },
    },
    async () => buildProviderStatus(),
  );

  app.get(
    '/api/providers/selfcheck',
    {
      schema: {
        response: { 200: SelfCheckResponseSchema },
      },
    },
    async () => buildSelfCheck(),
  );
};
