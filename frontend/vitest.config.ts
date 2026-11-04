import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * 固定测试环境的语言（见 `src/test/setup.ts` 的头注释）。
     *
     * 没有这一行时，同一份断言在开发机（zh-CN）绿、在 CI 的 runner（en-US）红 ——
     * 2026-11-04 第一次把前端单测纳入 CI 就撞上了。
     */
    setupFiles: ['./src/test/setup.ts'],
  },
});
