import { describe, expect, it } from 'vitest';
import { createKeyVault } from './keyVault.js';

/**
 * B 方案凭据暂存的约束（S5b）。
 * 重点不是"能存能取"，而是**它的边界**：空白不写入、释放幂等、只暴露条数。
 */

describe('KeyVault（进程内凭据暂存）', () => {
  it('存入后可按 taskId 取回，且只认自己的 taskId', () => {
    const vault = createKeyVault();
    vault.set('t-1', 'sk-aaaaaaaaaaaa');

    expect(vault.get('t-1')).toBe('sk-aaaaaaaaaaaa');
    expect(vault.get('t-2')).toBeUndefined();
  });

  it('首尾空白被裁掉（避免带着换行去发请求）', () => {
    const vault = createKeyVault();
    vault.set('t-1', '  sk-aaaa  ');

    expect(vault.get('t-1')).toBe('sk-aaaa');
  });

  it('空串 / 纯空白视为"客户端没带"，不占据条目（服务端会回落到 env 兜底）', () => {
    const vault = createKeyVault();
    vault.set('t-1', '');
    vault.set('t-2', '   ');

    expect(vault.get('t-1')).toBeUndefined();
    expect(vault.get('t-2')).toBeUndefined();
    expect(vault.size()).toBe(0);
  });

  it('释放是幂等的（dispatcher 的 finally 可能重复触发）', () => {
    const vault = createKeyVault();
    vault.set('t-1', 'sk-aaaa');

    vault.delete('t-1');
    expect(() => vault.delete('t-1')).not.toThrow();
    expect(vault.get('t-1')).toBeUndefined();
    expect(vault.size()).toBe(0);
  });

  it('同名 taskId 覆盖写入（幂等重放不会留下旧凭据）', () => {
    const vault = createKeyVault();
    vault.set('t-1', 'old');
    vault.set('t-1', 'new');

    expect(vault.get('t-1')).toBe('new');
    expect(vault.size()).toBe(1);
  });

  it('自检接口只报条数，本身不提供任何 Key 的枚举能力', () => {
    const vault = createKeyVault();
    vault.set('t-1', 'sk-aaaa');
    vault.set('t-2', 'sk-bbbb');

    expect(vault.size()).toBe(2);
    // 类型层面就没有 list / entries / values 这类方法（此处以断言钉住，防止日后"顺手加一个"）
    expect(Object.keys(vault).sort()).toEqual(['delete', 'get', 'set', 'size']);
  });
});
