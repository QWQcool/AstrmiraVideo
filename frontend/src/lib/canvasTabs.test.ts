import { describe, expect, it } from 'vitest';
import {
  PEER_TTL_MS,
  activePeers,
  isPeerMessage,
  type CanvasPeerMessage,
} from './canvasTabs';

/**
 * 跨标签"谁在编辑这块画布"（V2.109 / B85 片 B）。
 *
 * 真起两个标签页才能看到横幅，但那不可自动化；把"谁算同伴"抽成纯函数之后，
 * 边界（自己、别的画布、过期、同一标签的重复心跳、脏消息）全都能直接对拍。
 */

function message(tabId: string, projectId: string, at: number): CanvasPeerMessage {
  return { tabId, projectId, at };
}

describe('同伴判定（纯函数）', () => {
  it('排除自己、排除别的画布、排除了就过期', () => {
    const now = 100_000;
    const peers = activePeers(
      [
        message('me', 'p1', now - 500), // 自己
        message('other', 'p2', now - 500), // 别的画布
        message('stale', 'p1', now - PEER_TTL_MS - 1), // 过期
        message('peer', 'p1', now - 1000), // 真的同伴
      ],
      now,
      'me',
      'p1',
    );
    expect(peers.map((entry) => entry.tabId)).toEqual(['peer']);
  });

  it('同一个标签的多次心跳只算一个（取最新）', () => {
    const now = 50_000;
    const peers = activePeers(
      [
        message('peer', 'p1', now - 9000),
        message('peer', 'p1', now - 100),
        message('peer', 'p1', now - 5000),
      ],
      now,
      'me',
      'p1',
    );
    expect(peers).toHaveLength(1);
    expect(peers[0]?.at).toBe(now - 100);
  });

  it('刚好等于 TTL 还活着（过期按"大于"算）', () => {
    const now = 20_000;
    expect(activePeers([message('peer', 'p1', now - PEER_TTL_MS)], now, 'me', 'p1')).toHaveLength(1);
    expect(activePeers([message('peer', 'p1', now - PEER_TTL_MS - 1)], now, 'me', 'p1')).toHaveLength(0);
  });

  it('脏消息在入口就被挡掉（频道是公共的，别人可能往里写) ', () => {
    expect(isPeerMessage({ tabId: 'a', projectId: 'p1', at: 1 })).toBe(true);
    expect(isPeerMessage({ tabId: '', projectId: 'p1', at: 1 })).toBe(false);
    expect(isPeerMessage({ tabId: 'a', projectId: 'p1' })).toBe(false);
    expect(isPeerMessage({ projectId: 'p1', at: 1 })).toBe(false);
    expect(isPeerMessage(null)).toBe(false);
    expect(isPeerMessage('hello')).toBe(false);
  });
});
