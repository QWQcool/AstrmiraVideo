import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * 必须串行执行测试文件：集成测试通过 `process.env`（`DATA_DIR` / `OUTPUT_DIR` / `FAULT_INJECT`）
     * 指定运行时配置，而 env 是**进程级**的——并行文件会互相覆盖，产生"任务 404"这类伪失败。
     */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
