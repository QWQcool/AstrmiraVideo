import type { CanvasDoc } from '@astrmira/shared';

/**
 * 画布保存队列（Step 11-S4-R1a；CONTRACT 暂无变更）。
 *
 * 为什么不用一个 `setTimeout`：切画布/新建时如果还有保存请求在飞，旧响应可能在新文档加载后
 * 才回来，把"新文档已保存"盖成旧状态；而多个请求乱序时，服务端最后收到的可能是更旧的文档。
 * 这里把保存串行化：
 * 1. **同一时刻最多一个 PUT**；保存期间的新修改只记在 `latest`，等当前请求结束再补一次；
 * 2. **只有最新一次修改落盘后才报 `saved`**，旧响应不会让界面误以为干净；
 * 3. `flush()` 供切换/新建前显式等待；`settle()` 供删除前等完在飞请求；`cancel()` 丢弃脏状态；
 * 4. 失败时保留 `latest` 与 dirty，`flush()`/重试可以再发一次。
 *
 * 纯调度器 + 注入 `save`：单测不碰网络，视图只负责把状态映射到顶栏。
 */

export type CanvasSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface CanvasSaveQueueOptions {
  save: (doc: CanvasDoc) => Promise<void>;
  /** 状态回调带 projectId：视图切走后据此忽略旧项目的迟到状态 */
  onState: (state: CanvasSaveState, projectId: string) => void;
  /** 保存失败的具体原因（网络/契约）；视图用来显示可读错误 */
  onError?: (error: unknown) => void;
  delayMs?: number;
}

export interface CanvasSaveQueue {
  schedule(doc: CanvasDoc): void;
  /** 立即保存并等到"干净"或失败；返回 false 时调用方必须阻止切换 */
  flush(): Promise<boolean>;
  /** 等完在飞请求，不启动新的保存（删除前用） */
  settle(): Promise<void>;
  cancel(): void;
  isDirty(): boolean;
}

export function createCanvasSaveQueue({
  save,
  onState,
  onError,
  delayMs = 600,
}: CanvasSaveQueueOptions): CanvasSaveQueue {
  let latest: CanvasDoc | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<boolean> | null = null;
  /** settle 期间不再补存：删除前只等完在飞请求 */
  let settling = false;
  /** cancel 后旧请求仍会完成，但不许再改界面状态 */
  let generation = 0;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const run = async (): Promise<boolean> => {
    if (running !== null) return running;
    if (!dirty || latest === null) return true;

    const doc = latest;
    const myGeneration = generation;
    dirty = false;
    onState('saving', doc.projectId);

    running = (async () => {
      try {
        await save(doc);
        // 保存期间又改了：不要报 saved，回到循环再存一次
        // latest 为 null = 已 cancel（例如删除），不能再把脏状态复活
        if (latest !== null && latest !== doc) dirty = true;
        if (!dirty && myGeneration === generation) onState('saved', doc.projectId);
        return true;
      } catch (error) {
        if (myGeneration === generation) {
          dirty = true;
          onState('error', doc.projectId);
          onError?.(error);
        }
        return false;
      } finally {
        running = null;
      }
    })();

    const ok = await running;
    if (!ok) return false;
    if (dirty && latest !== null && !settling) return run();
    return true;
  };

  return {
    schedule(doc) {
      latest = doc;
      dirty = true;
      onState('dirty', doc.projectId);
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },

    async flush() {
      clearTimer();
      if (running !== null) {
        const ok = await running;
        if (!ok) {
          // 失败保留了 dirty/latest：显式 flush 再试一次
          return run();
        }
      }
      if (!dirty) return true;
      return run();
    },

    async settle() {
      clearTimer();
      settling = true;
      try {
        if (running !== null) await running;
      } finally {
        settling = false;
      }
    },

    cancel() {
      generation += 1;
      clearTimer();
      latest = null;
      dirty = false;
    },

    isDirty() {
      return dirty || running !== null;
    },
  };
}
