/**
 * BYOK 凭据的**进程内暂存**（PLAN §6-D23 议题 3 · **B 方案**，用户裁定）。
 *
 * ## 为什么必须有它
 * 队列执行发生在**请求上下文之外**（异步 worker 领任务时请求早已结束），
 * 而云端 provider 既要用凭据提交、又要用凭据轮询。三种解法的取舍：
 * - A 前端每次带 Key：轮询阶段无处可带（轮询由服务端发起）；
 * - C 仅 env 兜底：等于取消 BYOK，与议题 3 的结论冲突；
 * - **B 入队时暂存进程内存、终态即删** ← 本文件。
 *
 * ## 三条铁律（破任何一条都等于把"Key 零留存"的承诺做废）
 * 1. **只在内存**：不落 SQLite、不落文件、不进日志、不随任何响应回传；
 * 2. **终态即清**：任务进 succeeded / failed / cancelled 后立刻删除（dispatcher 的 finally 兜底）；
 * 3. **进程重启即空** —— 这是 B 方案的**已知代价，不是缺陷**：重启后仍在途的任务拿不到凭据，
 *    凡是**已提交上游**的必须如实归 `UNCERTAIN_RESULT`（可能已计费），
 *    未提交的归 `KEY_MISSING`。**绝不猜、绝不自动重提**（防线 7）。
 *
 * ## 为什么用 taskId 作键
 * taskId 是任务全生命周期唯一的名字，入队时分配、调度时可得、终态时可知，
 * 全程不需要把 Key 放进请求体或 job 记录（那会落库）。
 */

export interface KeyVault {
  /**
   * 入队时写入。空串 / 空白视为"客户端没带"，**不写入**（服务端会回落到 env 兜底 Key）。
   */
  set(taskId: string, key: string): void;
  /** 调度时读取；没有则返回 `undefined`（调用方据此区分 KEY_MISSING / 回落 env） */
  get(taskId: string): string | undefined;
  /** 终态清理（幂等） */
  delete(taskId: string): void;
  /** 仅供测试与运维自检：当前暂存条数。**绝不返回 Key 本身** */
  size(): number;
}

export function createKeyVault(): KeyVault {
  const store = new Map<string, string>();

  return {
    set(taskId: string, key: string): void {
      const trimmed = key.trim();
      if (trimmed === '') return;
      store.set(taskId, trimmed);
    },

    get(taskId: string): string | undefined {
      return store.get(taskId);
    },

    delete(taskId: string): void {
      store.delete(taskId);
    },

    size(): number {
      return store.size;
    },
  };
}

/** 进程级单例（装配处使用；测试请自行 `createKeyVault()` 避免串味） */
export const sharedKeyVault: KeyVault = createKeyVault();
