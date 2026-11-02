/**
 * 跨标签页的"谁在编辑这块画布"（V2.109 / 台账 B85 片 B）。
 *
 * ## 为什么只做"提示"，不做"锁"
 * 服务端已经有 `revision` 乐观锁：后写者会拿到 409。但 409 只能让前端"重载并丢弃本地修改"，
 * 也就是说**两个标签同时编辑同一块画布时，后写者的改动一定会丢**。
 * 真正能避免的办法只有两个：跨标签写锁（会卡住人，且有"标签崩了锁不释放"的问题），
 * 或者在线协作（不做，见 D60）。所以这里做**第三条**：让人在动手前就知道"另一个标签也开着"。
 *
 * 诚实的表述：这是**提示**，不是保护 —— 文案里必须写清"后保存的会覆盖"，不能让用户以为安全。
 *
 * ## 这一层只有"判定"，没有生命周期
 * 频道的建立/关闭、心跳定时器都放在视图的 effect 里（跟着 `projectId` 一起生灭），
 * 这里保持纯函数 —— 第一版把信标写成类，结果"频道还活着但状态没更新"排查了很久；
 * 少一层对象生命周期，就少一处能对不上的地方。
 */

export const CANVAS_TAB_CHANNEL = 'astrmira.canvas.tabs';
/** 一条心跳多久算过期（3 个周期 + 余量，避免偶尔卡顿就误报"对方走了"） */
export const PEER_TTL_MS = 12_000;
/** 心跳周期 */
export const PEER_HEARTBEAT_MS = 4_000;

export interface CanvasPeerMessage {
  /** 哪个标签页（每个标签自己生成一次，不落盘） */
  tabId: string;
  /** 在编辑哪块画布 */
  projectId: string;
  /** 发送时刻（毫秒） */
  at: number;
}

/**
 * 从通信记录里挑出**此刻仍在编辑这块画布的其他标签**（排除自己、排除过期、按 tabId 去重取最新）。
 *
 * 纯函数：时间、自身 id、目标画布都从参数来，测试不需要真时钟也不需要真频道。
 */
export function activePeers(
  messages: readonly CanvasPeerMessage[],
  now: number,
  selfTabId: string,
  projectId: string,
): CanvasPeerMessage[] {
  const latest = new Map<string, CanvasPeerMessage>();
  for (const message of messages) {
    if (message.tabId === selfTabId) continue;
    if (message.projectId !== projectId) continue;
    if (now - message.at > PEER_TTL_MS) continue;
    const previous = latest.get(message.tabId);
    if (previous === undefined || message.at > previous.at) latest.set(message.tabId, message);
  }
  return [...latest.values()];
}

/** 频道来的一条消息是否是合法的同伴心跳（视图里先在入口挡掉脏数据，再进 `activePeers`） */
export function isPeerMessage(value: unknown): value is CanvasPeerMessage {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<CanvasPeerMessage>;
  return (
    typeof candidate.tabId === 'string' &&
    candidate.tabId !== '' &&
    typeof candidate.projectId === 'string' &&
    typeof candidate.at === 'number'
  );
}
