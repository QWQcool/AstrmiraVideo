/**
 * 有并发上限的 map。
 *
 * 为什么不是 Promise.all：画布可能同时有几十个 running 任务；全量并发会在
 * 每 2s 轮询时同时打几十个 `/api/tasks/:id`，把服务端和浏览器连接池一起打满。
 * 这里保持“每个任务各自独立结算”，只限制同时在途的数量。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (items.length === 0) return [];

  const results: R[] = [];
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async (): Promise<void> => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index] as T, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}
