import { useEffect, useRef, useState } from 'react';
import type { TaskProgress } from '@astrmira/shared';
import { ApiError, fetchTask } from '../lib/api';

/**
 * 任务轮询（CONTRACT §5：前端 2s 间隔）。
 *
 * 三条行为约定：
 * 1. **终态即停**（succeeded / failed / cancelled）——继续轮询没有收益，还会掩盖"已完成"的事实；
 * 2. **契约错误即停**（如 404 TASK_NOT_FOUND）：这不是抖动，是结论；
 * 3. **网络抖动继续重试** ——离线几秒不该让界面判死。
 */
const TERMINAL_STATUSES: readonly string[] = ['succeeded', 'failed', 'cancelled'];

export interface TaskPollingResult {
  task: TaskProgress | null;
  error: ApiError | null;
  /** 首次加载尚未返回（用于区分"还没拉到"与"任务不存在"） */
  loading: boolean;
}

export interface UseTaskPollingOptions {
  intervalMs?: number;
  /** 拿到终态（或契约错误）时回调一次；父组件可用 useCallback 稳定引用 */
  onSettled?: (task: TaskProgress | null) => void;
}

export function useTaskPolling(
  taskId: string | null,
  options: UseTaskPollingOptions = {},
): TaskPollingResult {
  const { intervalMs = 2000 } = options;

  const [task, setTask] = useState<TaskProgress | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(taskId !== null);

  // 回调放 ref：避免父组件每次渲染换函数就把轮询重启一遍
  const settledRef = useRef(options.onSettled);
  useEffect(() => {
    settledRef.current = options.onSettled;
  }, [options.onSettled]);

  useEffect(() => {
    if (taskId === null) {
      setTask(null);
      setError(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    setLoading(true);

    async function tick(): Promise<void> {
      try {
        const next = await fetchTask(taskId as string, controller.signal);
        if (disposed) return;

        setTask(next);
        setError(null);
        setLoading(false);

        if (TERMINAL_STATUSES.includes(next.status)) {
          settledRef.current?.(next);
          return;
        }

        timer = setTimeout(() => void tick(), intervalMs);
      } catch (caught) {
        if (disposed) return;

        setLoading(false);

        if (caught instanceof ApiError) {
          setError(caught);

          // 契约错误（含 404）是结论，不是抖动
          if (caught.failure.kind === 'contract') {
            settledRef.current?.(null);
            return;
          }
        }

        timer = setTimeout(() => void tick(), intervalMs);
      }
    }

    void tick();

    return () => {
      disposed = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [taskId, intervalMs]);

  return { task, error, loading };
}
