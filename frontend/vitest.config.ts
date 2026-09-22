import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 前端测试只覆盖纯逻辑（lib / 状态机 / 静态自检），不启浏览器：
    // DOM 行为由 Step 4 的端到端验收覆盖。
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
