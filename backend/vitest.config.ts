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

    /**
     * 覆盖率（PLAN §9 台账 **B9**「CI 三件套之外的视觉 / 端到端固化、覆盖率、性能基准」）。
     *
     * ## 门限策略：**只给防线载体设文件级阈值，其余一律只报告不卡门**
     * 全域百分比是个很容易自欺的指标：把渲染/装配样板算进去能轻松上 90%，
     * 而真正会出事的那几个文件（错误码映射、幂等、限流、鉴权、凭据、裁切、清理）
     * 掉到 60% 也没人会从总数字里看出来。所以这里的阈值是**逐文件的防退化门**：
     * 数值取"当前实测值向下留 3~6 个点"——目的是"掉了就必须解释"，不是刷数字。
     *
     * 未设阈值的模块（如 `store/assets.ts`、`server/spa.ts`）覆盖率偏低是**已知事实**：
     * 它们的可达路径依赖云端 provider / 生产静态托管，当前没有对应测试；
     * 需要它们时再补测试与阈值，而不是现在造一个好看的总数。
     *
     * 前端**不设覆盖率门**：组件层没有单测（结构性回归由 `scripts/visual-selfcheck.mjs`
     * 的静态断言守），用覆盖率去量它只会产生一个恒低的噪音数字。
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // 纯接口文件（只有类型与签名，没有运行时语句）：统计它只会恒为 0%
        'src/queue/JobQueue.ts',
      ],
      thresholds: {
        // 三态错误码的穷举映射表：防线 7 的语义全靠它，错一个码就是安全事故
        'src/errors.ts': { statements: 80, branches: 55, functions: 100, lines: 80 },
        // 防线 2 / 7：任务持久化 + 幂等 + `submitting` 判据
        'src/store/taskStore.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
        // 防线 5：60s 冷却（键构成 = IP + 凭据指纹）
        'src/security/rateLimit.ts': { statements: 90, branches: 85, functions: 85, lines: 90 },
        // 鉴权的两层免鉴权白名单（回环 + `/api/health`）
        'src/security/auth.ts': { statements: 95, branches: 85, functions: 100, lines: 95 },
        // 「Key 零留存」的读取与掩码半边
        'src/security/credential.ts': { statements: 95, branches: 80, functions: 90, lines: 95 },
        // B 方案凭据暂存：入队前写、终态即清
        'src/security/keyVault.ts': { statements: 95, branches: 95, functions: 95, lines: 95 },
        // 防线 4：32 倍数规整与居中裁切（所有画幅分支都从这里过）
        'src/pipeline/smartCrop.ts': { statements: 90, branches: 85, functions: 100, lines: 90 },
        // 防线 4：图像清洗网关（EXIF 方向 / CMYK→sRGB / 下采样 / 规整 / 拒收分支）
        'src/pipeline/imageSanitize.ts': { statements: 90, branches: 85, functions: 100, lines: 90 },
        // 防线 3：中间帧目录清理
        'src/pipeline/cleanup.ts': { statements: 90, branches: 70, functions: 100, lines: 90 },
        // V1.9：画廊封面抽帧（含"/media/ 路径守卫"——它是唯一接受 provider 返回值当本地路径的地方）
        'src/pipeline/thumbnail.ts': { statements: 90, branches: 80, functions: 100, lines: 90 },
        // 提交入口：幂等键解析 + 冷却判定 + 凭据交接的顺序
        'src/routes/generate.ts': { statements: 90, branches: 80, functions: 100, lines: 90 },
        // 云端协议适配层（上游字段唯一收口处，AC2 时要逐项核对【待验证】）
        'src/providers/seedanceProtocol.ts': { statements: 90, branches: 85, functions: 100, lines: 90 },
      },
    },
  },
});
