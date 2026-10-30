import { providerBaseType, type ProviderBaseType, type ProviderType, type VideoProvider } from '@astrmira/shared';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import type { TaskVideoResolution } from '../store/assets.js';
import { FixtureLocalProvider } from './fixture/FixtureLocalProvider.js';
import { readOptionString } from './providerOptions.js';
import { VolcanoSeedanceProvider } from './VolcanoSeedanceProvider.js';
import { SEEDANCE_DEFAULT_BASE_URL, SEEDANCE_DEFAULT_MODEL } from './seedanceProtocol.js';
import { ComfyUiProvider } from './comfyui/ComfyUiProvider.js';
import { getComfyProgressTracker } from './comfyui/comfyuiProgress.js';
import { DEFAULT_COMFY_SERVER_ID, findComfyServer } from './comfyui/comfyuiServers.js';
import { HttpServiceProvider } from './httpService/HttpServiceProvider.js';
import { findHttpService } from './httpService/httpServiceProfile.js';
import { createFaultInjectedProvider, resolveFaultPlanFromEnv } from './withFaultInjection.js';
import { AudioProvider } from './audio/AudioProvider.js';

/**
 * Provider **唯一注册点**（PLAN §4「Step 2 补充」约束 1）。
 *
 * 铁律：provider 只在这里注册一次；删除一个 provider = 删一行 + 删一个目录。
 * 未实现的能力位返回 `null`——**不假装可用**（PLAN §3 铁律 4：不静默降级）。
 */

/**
 * OI（开发期校验 provider）门控：默认关闭。
 * 生产环境（`NODE_ENV=production`）始终关闭，除非显式 `ENABLE_FIXTURE_PROVIDER=1`。
 */
export function isFixtureProviderEnabled(): boolean {
  const raw = process.env.ENABLE_FIXTURE_PROVIDER;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim() === '1';
  }
  return process.env.NODE_ENV !== 'production';
}

/**
 * OI-2 夹具实例：**按当前的 `OUTPUT_DIR` 惰性构造**。
 *
 * 为什么不能是模块级 `new FixtureLocalProvider()`：它的 outputDir 默认是 `<repo>/outputs`，
 * 而 `/media/*` 服务的是 `resolveOutputsDir()`（env `OUTPUT_DIR` 优先）——两者会分叉，
 * 症状是「任务 succeeded 但播放器 404」（本地 `pnpm dev` 的 cwd 是 `backend/`，
 * 默认值同样分叉）。云端 provider 一直按每次调用读 `resolveOutputsDir()`，夹具此前漏了这条。
 *
 * 惰性而非「import 时读一次」：测试与部署都会在装配前才设 env。
 */
const fixtureProvider = (() => {
  let instance: FixtureLocalProvider | null = null;
  let outputDirOfInstance: string | null = null;

  return (): FixtureLocalProvider => {
    const outputDir = resolveOutputsDir();
    if (instance === null || outputDirOfInstance !== outputDir) {
      instance = new FixtureLocalProvider({ outputDir });
      outputDirOfInstance = outputDir;
    }
    return instance;
  };
})();

/**
 * 取 provider 所需的**每次调用上下文**。
 *
 * 为什么必须有它：B 方案下凭据不落盘、只按任务暂存在进程内存里，
 * 而 provider 实例必须在**调度那一刻**才知道自己属于哪个任务、能用什么凭据。
 * 所以 provider 是"每任务一份"而不是进程级单例 —— 云端轨尤其如此（不同任务可能用不同的 BYOK Key）。
 */
export interface ProviderResolutionContext {
  /** 本任务的服务端 taskId（云端 provider 用它命名成片文件） */
  taskId: string;
  /** B 方案：由 `security/keyVault` 按任务取出的凭据；`undefined` = 无凭据 */
  providerKey?: string;
  /**
   * 本次请求的 `request.options`（CONTRACT §1）。
   *
   * 为什么必须传进来：`options.model` / `options.baseUrl` 是 **BYOK 的一部分** ——
   * 用户在自己的抽屉里选的那一档，才应该是真正发出去的模型。
   * 2026-09-23 线上故障正是"注册点只读 env、请求里的模型无人消费"造成的。
   */
  requestOptions?: Record<string, unknown>;
  /** 资产 id → 上游可访问地址（云端 provider 需要） */
  resolveAssetUrl?: (assetId: string) => Promise<string | null>;
  /** V2.6（B37）：`task:<taskId>` 引用 → 上游可访问地址（云端 provider 需要） */
  resolveTaskVideoUrl?: (taskId: string) => Promise<TaskVideoResolution>;
}

type ProviderFactory = (ctx: ProviderResolutionContext) => VideoProvider | null;

/**
 * 凭据优先级（CONTRACT §2 的双入口，二者顺序不可颠倒）：
 * 1. **请求头带来的用户 BYOK Key**（经 vault 注入）—— 用户明确表达了"用我的额度"；
 * 2. `VOLCANO_API_KEY`（部署者兜底）—— 仅当用户没带时才用，且这正是 `cloud.available:true` 的含义。
 *
 * 顺序颠倒会造成"用户以为在烧自己的 Key，实际烧的是部署者的"，这类问题极难被发现。
 */
function resolveProviderKey(ctx: ProviderResolutionContext): string | null {
  if (ctx.providerKey !== undefined && ctx.providerKey.trim() !== '') return ctx.providerKey.trim();

  const envKey = process.env.VOLCANO_API_KEY?.trim();
  return envKey === undefined || envKey === '' ? null : envKey;
}

/**
 * 模型名的解析：**请求体 > env > 协议层默认**（V2.1 修）。
 *
 * 顺序不可颠倒：请求体里的值是**用户在自己抽屉里选的**（BYOK 的一部分），
 * 让服务端 env 覆盖它，就等于"用户以为在用自己的配置，实际用着部署者的默认值"——
 * 比 `KEY_MISSING` 那类错误难查得多，因为**界面上一切正常**。
 * （2026-09-23 线上故障：用户的 `doubao-seedance-2-0-mini-260615` 被 env 的
 *  `doubao-seedance-video` 覆盖，报 404 且报文里只提后者。）
 */
function resolveEffectiveModel(requested: string | undefined): {
  model: string;
  source: 'request' | 'env' | 'default';
} {
  if (requested !== undefined) return { model: requested, source: 'request' };

  const fromEnv = process.env.VOLCANO_MODEL_NAME?.trim();
  if (fromEnv !== undefined && fromEnv !== '') return { model: fromEnv, source: 'env' };

  return { model: SEEDANCE_DEFAULT_MODEL, source: 'default' };
}

function createCloudProvider(ctx: ProviderResolutionContext): VideoProvider {
  const requestedModel = readOptionString(ctx.requestOptions, 'model');
  const requestedBaseUrl = readOptionString(ctx.requestOptions, 'baseUrl');
  const envBaseUrl = process.env.VOLCANO_BASE_URL?.trim();
  const { model, source } = resolveEffectiveModel(requestedModel);

  return new VolcanoSeedanceProvider({
    taskId: ctx.taskId,
    providerKey: resolveProviderKey(ctx),
    model,
    modelSource: source,
    ...(requestedModel === undefined ? {} : { requestedModel }),
    baseUrl:
      requestedBaseUrl ??
      (envBaseUrl === undefined || envBaseUrl === '' ? SEEDANCE_DEFAULT_BASE_URL : envBaseUrl),
    outputDir: resolveOutputsDir(),
    ...(ctx.resolveAssetUrl === undefined ? {} : { resolveAssetUrl: ctx.resolveAssetUrl }),
    ...(ctx.resolveTaskVideoUrl === undefined
      ? {}
      : { resolveTaskVideoUrl: ctx.resolveTaskVideoUrl }),
  });
}

/**
 * 本地 ComfyUI 的**一个实例**（V2.30 起；**V2.36 起按 id 取实例**）：用户自备引擎与模型（决策 **D53**）。
 *
 * 门控：实例存在且地址合规（回环 / 内网白名单，见 `comfyuiServers.ts`）——
 * 否则 **返回 null，不假装可用**（调用方报 503）。
 * 白名单**逐实例**校验；请求体仍**不允许指定地址**（防 SSRF）——
 * 这一条与云端的"BYOK 可带 baseUrl"刻意不同：云端那个地址是**用户自己的账号端点**，
 * 而本地 ComfyUI 是**部署者的机器**，让请求体指定等于把内网探测面打开。
 *
 * 实例自己的**模板与档位**在这里透传（缺省项各自回落全局 env / 内置默认，见 §19-3）——
 * 多台机器往往跑不同模型、不同显存档，一份全局配置压不住它们。
 */
function createComfyProviderFor(id: string, ctx: ProviderResolutionContext): VideoProvider | null {
  const server = findComfyServer(id);
  // 找不到（拼错 / 那一台没配 / 地址不合规）→ null：走既有的「未注册 → 503」路径，不新增错误码
  if (server === null || !server.available) return null;

  return new ComfyUiProvider({
    id: server.id,
    name: `本地 ComfyUI（${server.label}）`,
    baseUrl: server.url,
    outputDir: resolveOutputsDir(),
    ...(server.template === undefined ? {} : { templateName: server.template }),
    ...(server.tuning === undefined ? {} : { tuning: server.tuning }),
    ...(ctx.resolveAssetUrl === undefined ? {} : { resolveAssetUrl: ctx.resolveAssetUrl }),
    // S9 修正：i2v 首帧引用 `task:<id>`（会话图片步产物）需要 task 通道——与云端 provider 对齐
    ...(ctx.resolveTaskVideoUrl === undefined ? {} : { resolveTaskVideoUrl: ctx.resolveTaskVideoUrl }),
    // V2.82：进度走 WS；按 baseUrl 进程级共享（provider 是每请求新建的）
    progress: getComfyProgressTracker(server.url),
  });
}

/**
 * V2.47（§22）：配置型 HTTP 任务服务的一个实例。
 * 找不到 / 不可用 → null（503）；地址与 token 由 profile 解析时校验，这里不下发、不记录。
 */
function createHttpServiceProviderFor(
  id: string,
  ctx: ProviderResolutionContext,
): VideoProvider | null {
  const server = findHttpService(id);
  if (server === null || !server.available) return null;

  return new HttpServiceProvider({
    id: server.id,
    name: `HTTP 服务（${server.label}）`,
    profile: server.profile,
    outputDir: resolveOutputsDir(),
    taskId: ctx.taskId,
    ...(ctx.resolveAssetUrl === undefined ? {} : { resolveAssetUrl: ctx.resolveAssetUrl }),
    ...(ctx.resolveTaskVideoUrl === undefined
      ? {}
      : { resolveTaskVideoUrl: ctx.resolveTaskVideoUrl }),
  });
}

/**
 * 模板里的占位符曾被部署者当成真值抄进 `.env`（`VOLCANO_MODEL_NAME=doubao-seedance-video`），
 * 于是**所有**提交都在上游 404。模板已经改成注释态，但线上 `.env` 不会自动更新，
 * 所以启动时对"已知的坑值"告一次警 —— 让人在日志里一眼看见，而不是等用户来报错。
 */
const KNOWN_PLACEHOLDER_MODEL_VALUES = ['doubao-seedance-video'];

export function getEnvModelWarning(): string | null {
  const configured = process.env.VOLCANO_MODEL_NAME?.trim();
  if (configured === undefined || configured === '') return null;

  if (KNOWN_PLACEHOLDER_MODEL_VALUES.includes(configured)) {
    return (
      `VOLCANO_MODEL_NAME=${configured} 是文档模板里的**占位符**，不是真实模型 id：` +
      '任何"没带模型"的提交都会在上游 404。请在方舟控制台复制真实 id（或接入点 ep-…），' +
      '或删除该环境变量让内置默认/界面选择生效。'
    );
  }

  return `VOLCANO_MODEL_NAME=${configured}：仅作为"请求未指定模型"时的兜底值（请求里的模型优先级更高）`;
}

const REGISTRY: Record<ProviderBaseType, ProviderFactory> = {
  // OI-2 夹具（S1 已实现）
  'fixture-local': () => (isFixtureProviderEnabled() ? fixtureProvider() : null),
  // OI-1 素材 provider：未实现，属 PLAN §9 台账 B7
  'stock-local': () => null,
  // 云端轨（S5b 落地）：每任务一份实例，凭据由调度器注入
  'cloud-volcano-seedance': (ctx) => createCloudProvider(ctx),
  // ⚠️ **V2.37（D56）：这一档已撤掉** —— 产品面不再提供它（界面 / `/status` / `/selfcheck` 都没有它）。
  // 注册表**保留这一行且返回 `null`** 是刻意的：旧前端产物（浏览器缓存的 dist）与历史请求体
  // 提交它会走既有的「未注册 → 503 PROVIDER_UNAVAILABLE」（**人话**），而不是被 schema 判成 400。
  'local-minimax-h3': () => null,
  // host 本地轨（用户自备 ComfyUI，V2.30 / A1 片 B / D53）：配 COMFYUI_BASE_URL 即启用。
  // **具名实例**（V2.36，`host-comfyui:<name>`）由 `getProvider` 按 id 分流 ——
  // 注册表只放"每类一个工厂"，实例是数据（见 comfyuiServers.ts）。
  'host-comfyui': (ctx) => createComfyProviderFor(DEFAULT_COMFY_SERVER_ID, ctx),
  // V2.47（§22）：配置型 HTTP 任务服务；没有默认实例，只有具名 `http-service:<name>`。
  // 这里保留 null 工厂，让 `ProviderBaseType` 的穷举检查仍成立；实例由 getProvider 分流。
  'http-service': () => null,
  // V2.58（S7-D8）：导入历史不是可生成 provider；这里只让穷举成立。
  imported: () => null,
  // V2.103（Phase 2 · 声音）：两个音频引擎（没配就 null → 503，界面如实不可用）
  'mimo-tts': (ctx) => createMimoProvider(ctx),
  'host-stable-audio': (ctx) => createStableAudioProvider(ctx),
};

/**
 * V2.103（Phase 2 · 声音）：MiMo 云端配音。
 *
 * 凭据**只从 env 读**（`MIMO_API_KEY`，兼容本机习惯的 `MiMo_API_Key`）——
 * 音频轨不是 BYOK 通道：TTS 是"部署者这台机器有没有这条能力"，
 * 而不是"用户带自己的 Key"（带 Key 的音频 BYOK 要另立契约，本轮不做）。
 * 没配 → 返回 null → 503，界面如实不可用。
 */
function createMimoProvider(_ctx: ProviderResolutionContext): VideoProvider | null {
  const key = process.env.MIMO_API_KEY?.trim() || process.env.MiMo_API_Key?.trim() || '';
  if (key === '') return null;
  return new AudioProvider({
    id: 'mimo-tts',
    name: 'MiMo TTS（第三方云）',
    engine: 'mimo-tts',
    outputDir: resolveOutputsDir(),
    mimoKey: key,
  });
}

/**
 * V2.103：本机 Stable Audio（ComfyUI）。地址**必须显式配** `COMFYUI_AUDIO_BASE`。
 *
 * ⚠️ **刻意不回退 `COMFYUI_BASE_URL`**：那是视频轨那台（H3 / MOSS 只有 `diffusion_models`，
 * `models/checkpoints` 是空的）。回退的后果不是报错而是**能力位说"能用"、点了才失败** ——
 * 实测踩到过（2026-10-30 生产）。同一台机器同时跑视频与音频时，把两个 env 写成同一个地址即可，
 * 那是一次显式决定，不是静默复用。
 */
function createStableAudioProvider(_ctx: ProviderResolutionContext): VideoProvider | null {
  const base = process.env.COMFYUI_AUDIO_BASE?.trim() || '';
  if (base === '') return null;
  return new AudioProvider({
    id: 'host-stable-audio',
    name: 'Stable Audio 3 Small（本机 ComfyUI）',
    engine: 'host-stable-audio',
    outputDir: resolveOutputsDir(),
    comfyBaseUrl: base.replace(/\/+$/, ''),
  });
}

/** ⚠️ 测试注入表（生产路径永不写入；见 `__setProviderForTesting`） */
const testOverrides = new Map<ProviderType, VideoProvider | null>();

/** 能力位自检用的空上下文：只问"这个 provider 整体是否已配置"，与凭据无关 */
const PROBE_CONTEXT: ProviderResolutionContext = { taskId: 'probe' };

/**
 * 取 provider 实例；未实现或被门控关闭时返回 `null`（调用方须显式报 `PROVIDER_UNAVAILABLE`）。
 * 不传 `ctx` 时按"自检"语义构造（供能力位下发使用）。
 */
export function getProvider(id: ProviderType, ctx?: ProviderResolutionContext): VideoProvider | null {
  const context = ctx ?? PROBE_CONTEXT;

  if (testOverrides.has(id)) {
    const overridden = testOverrides.get(id) ?? null;
    return overridden === null ? null : applyEnvFaultInjection(overridden);
  }

  // 形状不合法（正常由请求 schema 先挡住）→ 未注册
  const base = providerBaseType(id);
  if (base === null) return null;

  // V2.36：具名实例按 id 取"那一台"；默认实例走注册表（一处逻辑一处真相）。
  // V2.47：http-service 也按具名实例分流（没有默认实例）。
  const provider =
    base === 'host-comfyui' && id !== DEFAULT_COMFY_SERVER_ID
      ? createComfyProviderFor(id, context)
      : base === 'http-service' && id !== 'http-service'
        ? createHttpServiceProviderFor(id, context)
        : REGISTRY[base](context);

  return provider === null ? null : applyEnvFaultInjection(provider);
}

/**
 * env 驱动的故障注入（PLAN §4「Step 2 补充」）：
 * `FAULT_INJECT=1` 时在 provider 与调度器之间插一层包装；生产环境挂载会**直接抛错**。
 */
function applyEnvFaultInjection(provider: VideoProvider): VideoProvider {
  const plan = resolveFaultPlanFromEnv();
  return plan === null ? provider : createFaultInjectedProvider(provider, plan);
}

/** ⚠️ 仅供测试：临时覆盖某个 provider（用于计数桩 / 故障桩） */
export function __setProviderForTesting(id: ProviderType, provider: VideoProvider | null): void {
  testOverrides.set(id, provider);
}

/** ⚠️ 仅供测试：清除所有覆盖 */
export function __clearProviderTestOverrides(): void {
  testOverrides.clear();
}

/*
 * 已删除：`listAvailableProviders()`。
 *
 * 它是 S5 之前的"能力位下发"占位实现，`providers.ts` 落地后**再无调用方**
 * —— 是覆盖率门限把这段死代码找出来的（覆盖率不是为了数字好看，而是为了逼出这种东西：
 * 一个"看起来能用"的导出，下一个人照着它写就会绕开真正的状态端点）。
 */
