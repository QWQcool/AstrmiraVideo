import type { ProviderType, VideoProvider } from '@astrmira/shared';
import { resolveOutputsDir } from '../server/staticOutputs.js';
import { FixtureLocalProvider } from './fixture/FixtureLocalProvider.js';
import { VolcanoSeedanceProvider } from './VolcanoSeedanceProvider.js';
import { SEEDANCE_DEFAULT_BASE_URL, SEEDANCE_DEFAULT_MODEL } from './seedanceProtocol.js';
import { createFaultInjectedProvider, resolveFaultPlanFromEnv } from './withFaultInjection.js';

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
  /** 资产 id → 上游可访问地址（云端 provider 需要） */
  resolveAssetUrl?: (assetId: string) => Promise<string | null>;
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

function createCloudProvider(ctx: ProviderResolutionContext): VideoProvider {
  const baseUrl = process.env.VOLCANO_BASE_URL?.trim();

  return new VolcanoSeedanceProvider({
    taskId: ctx.taskId,
    providerKey: resolveProviderKey(ctx),
    model: process.env.VOLCANO_MODEL_NAME ?? SEEDANCE_DEFAULT_MODEL,
    baseUrl: baseUrl === undefined || baseUrl === '' ? SEEDANCE_DEFAULT_BASE_URL : baseUrl,
    outputDir: resolveOutputsDir(),
    ...(ctx.resolveAssetUrl === undefined ? {} : { resolveAssetUrl: ctx.resolveAssetUrl }),
  });
}

const REGISTRY: Record<ProviderType, ProviderFactory> = {
  // OI-2 夹具（S1 已实现）
  'fixture-local': () => (isFixtureProviderEnabled() ? fixtureProvider() : null),
  // OI-1 素材 provider：未实现，属 PLAN §9 台账 B7
  'stock-local': () => null,
  // 云端轨（S5b 落地）：每任务一份实例，凭据由调度器注入
  'cloud-volcano-seedance': (ctx) => createCloudProvider(ctx),
  // host 本地轨：未实现（到达路径 = 配 env + 重启，见 providers/statusProbe.ts）
  'local-minimax-h3': () => null,
};

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
  const base = testOverrides.has(id) ? (testOverrides.get(id) ?? null) : REGISTRY[id](context);
  if (base === null) return null;
  return applyEnvFaultInjection(base);
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

/** 当前真正可用（已实现且未被门控关闭）的 provider 列表 —— 供能力位下发使用 */
export function listAvailableProviders(): VideoProvider[] {
  return (Object.keys(REGISTRY) as ProviderType[])
    .map((id) => getProvider(id))
    .filter((provider): provider is VideoProvider => provider !== null);
}
