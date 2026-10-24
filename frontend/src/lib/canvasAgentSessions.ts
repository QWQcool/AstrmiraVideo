import { browserStorage, readLocal, removeLocal, STORAGE_KEYS, writeLocal } from './storage';

/**
 * 画布助手会话持久化（S9-B；对齐即梦"画布 Agent 会话可开新会话/回看"的观察）。
 *
 * 口径三条：
 * 1. **按画布项目隔离**（键 = 前缀 + projectId）——与便签/编排同一条纪律：会话属于这张图；
 * 2. **只存问答文本**（role/text/model/usage/freeform），不存方案卡/分镜表/展开结果——
 *    那些是"待确认的操作状态"，刷新后残留一个旧方案卡反而危险（模型/画布可能已变）；
 * 3. **上限 60 条**（FIFO 裁剪最旧），超出即裁——聊天记录不是档案系统。
 */

const PREFIX = STORAGE_KEYS.canvasAgentSessionPrefix;
const MAX_MESSAGES = 60;

export interface StoredAgentMessage {
  role: 'user' | 'assistant';
  text: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number };
  freeform?: boolean;
}

export function loadAgentSession(projectId: string): StoredAgentMessage[] {
  const raw = readLocal(browserStorage(), `${PREFIX}${projectId}`);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (item): item is StoredAgentMessage =>
        typeof item === 'object' &&
        item !== null &&
        ((item as StoredAgentMessage).role === 'user' ||
          (item as StoredAgentMessage).role === 'assistant') &&
        typeof (item as StoredAgentMessage).text === 'string',
    );
    return valid.slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

export function saveAgentSession(projectId: string, messages: readonly StoredAgentMessage[]): void {
  const trimmed = messages.slice(-MAX_MESSAGES);
  try {
    writeLocal(browserStorage(), `${PREFIX}${projectId}`, JSON.stringify(trimmed));
  } catch {
    /* 配额满 / 隐私模式：会话退化为本次内存态，不阻塞对话 */
  }
}

export function clearAgentSession(projectId: string): void {
  removeLocal(browserStorage(), `${PREFIX}${projectId}`);
}
