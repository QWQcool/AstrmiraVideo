import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 遥测补丁守卫（B34 · P2；合规边界见 docs/UPSTREAM.md #13）。
 *
 * 为什么值得一条测试：补丁是靠 pnpm `patchedDependencies` 在安装期打的，
 * **版本一升 / lockfile 一变就可能静默失效**（表现不是报错，而是终端用户 IP 又被 POST 到 remotion.pro）。
 * 这里做源码级结构断言：补丁标记不存在就红，逼着人「要么重新打补丁、要么明确决定加回遥测」。
 */
describe('@remotion/web-renderer 遥测补丁', () => {
  it('sendUsageEvent 已被短路为 no-op（pnpm patchedDependencies 生效）', () => {
    const file = path.resolve(
      process.cwd(),
      'node_modules/@remotion/web-renderer/dist/esm/index.mjs',
    );
    const source = readFileSync(file, 'utf8');
    expect(source).toContain('var sendUsageEvent = async () => Promise.resolve(undefined);');
    expect(source).toContain('[astrmira] 遥测已短路');
  });
});
