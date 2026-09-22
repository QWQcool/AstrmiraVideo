import type { ProviderType, VideoProvider } from '@astrmira/shared';
import { FixtureLocalProvider } from './fixture/FixtureLocalProvider.js';
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

const fixtureProvider = new FixtureLocalProvider();

type ProviderFactory = () => VideoProvider | null;

const REGISTRY: Record<ProviderType, ProviderFactory> = {
  // OI-2 夹具（S1 已实现）
  'fixture-local': () => (isFixtureProviderEnabled() ? fixtureProvider : null),
  // OI-1 素材 provider：未实现，属 PLAN §9 台账 B7
  'stock-local': () => null,
  // 云端与 host 本地轨：S5 落地（PLAN §6-D26）
  'cloud-volcano-seedance': () => null,
  'local-minimax-h3': () => null,
};

/** ⚠️ 测试注入表（生产路径永不写入；见 `__setProviderForTesting`） */
const testOverrides = new Map<ProviderType, VideoProvider | null>();

/** 取 provider 实例；未实现或被门控关闭时返回 `null`（调用方须显式报 `PROVIDER_UNAVAILABLE`） */
export function getProvider(id: ProviderType): VideoProvider | null {
  const base = testOverrides.has(id) ? (testOverrides.get(id) ?? null) : REGISTRY[id]();
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
