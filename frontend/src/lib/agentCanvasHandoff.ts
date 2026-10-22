import { AgentPlanSchema, type AgentPlan } from '@astrmira/shared';

const KEY = 'astrmira.canvas.agent_plan_handoff';

/**
 * S7-C2：Agent 计划 → 画布的一次性交接。
 *
 * 与 `canvasHandoff.ts` 同一纪律：sessionStorage 一次性键，画布消费后删除；
 * 不把计划塞进 URL，不用全局 store 让两个 keepalive 视图互相污染。
 */
export function parseAgentCanvasHandoff(raw: string | null): AgentPlan | null {
  if (raw === null) return null;
  try {
    const parsed = AgentPlanSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function setAgentCanvasHandoff(
  plan: AgentPlan,
  storage: Pick<Storage, 'setItem'> = sessionStorage,
): boolean {
  try {
    storage.setItem(KEY, JSON.stringify(plan));
    return true;
  } catch {
    return false;
  }
}

export function peekAgentCanvasHandoff(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): AgentPlan | null {
  try {
    return parseAgentCanvasHandoff(storage.getItem(KEY));
  } catch {
    return null;
  }
}

export function clearAgentCanvasHandoff(
  storage: Pick<Storage, 'removeItem'> = sessionStorage,
): void {
  try {
    storage.removeItem(KEY);
  } catch {
    // 删除失败不会影响本次消费；下次读取按计划去重（见画布 effect）。
  }
}

export function takeAgentCanvasHandoff(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
): AgentPlan | null {
  const value = peekAgentCanvasHandoff(storage);
  if (value !== null) clearAgentCanvasHandoff(storage);
  return value;
}
