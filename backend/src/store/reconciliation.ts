import { createTaskError } from '../errors.js';
import type { TaskStore } from '../store/taskStore.js';

/**
 * 启动时的**孤儿任务调解**（S5b 新增，补 S2 遗留缺口）。
 *
 * ## 问题
 * `TaskStore.claimOne` 只领取 `status='queued'` 的任务（这是对的，否则重启后会重复提交）。
 * 但由此产生一个缺口：**进程在任务执行中途退出时，那条任务会永远停在 `running`** ——
 * 既不会被重新领取（不是 queued），也没有任何东西把它推到终态，界面上就是"永远 40%"。
 *
 * ## 为什么归到哪个终态不能一刀切
 * 判据是 CONTRACT §5 的 `submitting` 标记与 `upstreamTaskId`：
 *
 * | 现场 | 含义 | 归档 |
 * |---|---|---|
 * | 有 `upstreamTaskId` | 上游**明确受理过**，可能已计费 | `UNCERTAIN_RESULT`（人工核对，禁止重提） |
 * | 无 id 但 `submitting=true` | 提交动作**已发出**但响应丢了，无法排除上游已受理 | `UNCERTAIN_RESULT`（同上） |
 * | 无 id 且 `submitting=false` | 从未进入提交阶段，重试无副作用 | `UPSTREAM_ERROR`（retryable，**但我们不自动重跑**，交给用户决定） |
 *
 * 第三行刻意**不**归还队列：自动重跑等于在用户不知情时再花一次钱。
 * 界面上它是一条可被"复用参数"的失败记录，用户确认后才重新提交。
 *
 * 对 B 方案（Key 不落盘）而言，这个函数是**必需配套**：重启后凭据必然丢失，
 * 有上游 id 的任务本来就再也查不了了 —— 与其让它假装还在跑，不如如实标成"需要人工核对"。
 */
export interface ReconciliationResult {
  /** 归档为「结果不明」的任务（需要人工核对是否已计费） */
  uncertain: string[];
  /** 归档为「可重试失败」的任务（从未提交上游） */
  retryable: string[];
}

export function reconcileOrphanTasks(store: TaskStore, limit = 500): ReconciliationResult {
  const orphans = store.listByStatus('running', limit);
  const result: ReconciliationResult = { uncertain: [], retryable: [] };

  for (const record of orphans) {
    const submitted = record.upstreamTaskId !== undefined || record.submitting;

    if (submitted) {
      store.update(record.taskId, {
        status: 'failed',
        submitting: false,
        error: createTaskError(
          'UNCERTAIN_RESULT',
          '服务在任务执行中途重启：该任务可能已提交上游并产生费用，请到服务商后台核对后手动处理',
        ),
      });
      result.uncertain.push(record.taskId);
      continue;
    }

    store.update(record.taskId, {
      status: 'failed',
      submitting: false,
      error: createTaskError(
        'UPSTREAM_ERROR',
        '服务在任务提交前重启：该任务未触达上游，可安全重新提交（不会产生重复费用）',
      ),
    });
    result.retryable.push(record.taskId);
  }

  return result;
}
