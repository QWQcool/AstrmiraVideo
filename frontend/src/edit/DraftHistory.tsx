import { useCallback, useEffect, useState } from 'react';
import {
  DRAFT_HISTORY_LIMIT,
  clearEditDraftHistory,
  listEditDraftHistory,
  pushEditDraftHistory,
  saveEditDraft,
  type DraftSnapshot,
} from './draft';
import type { EditStore } from './store';
import { useEditStore } from './store';

/**
 * 草稿版本历史（V2.21 / 台账 B66；设计参考 n8n 的版本历史，独立实现）。
 *
 * ## 它解决什么
 * 在此之前只有**一份草稿**，而草稿是**随编辑覆盖**的 —— "上周那版更好，回去"在结构上不可能。
 * 现在：自动（节流）快照 + 手动「存一个版本」+ 一键恢复（**恢复前先把当前存一份**，防呆）。
 *
 * ## 三条口径
 * 1. **不新增存储机制**：仍然只动 localStorage（键名在 `lib/storage.ts` 登记），
 *    服务端不知道草稿的存在（零契约、零上传）；
 * 2. **恢复前先保底**：`force` 存一份当前状态 —— 恢复错了还能回去（与备份恢复同一纪律）；
 * 3. **读不出来的快照跳过但计数**：老快照过迁移函数，坏的**如实说**，不假装历史是完整的。
 */
function formatRelative(savedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} 小时前`;
  return `${Math.round(seconds / 86400)} 天前`;
}

function clipCount(snapshot: DraftSnapshot): number {
  return snapshot.project.tracks.reduce((sum, track) => sum + track.clips.length, 0);
}

export function DraftHistory({
  sourceTaskId,
  store,
}: {
  sourceTaskId: string;
  store: EditStore;
}) {
  const project = useEditStore(store, (s) => s.project);
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<DraftSnapshot[]>([]);
  const [broken, setBroken] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** 相对时间每次打开时刷新一次（不做定时器：这个面板不需要秒级新鲜度） */
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback((): void => {
    const result = listEditDraftHistory(sourceTaskId);
    setSnapshots(result.snapshots);
    setBroken(result.broken);
    setNow(Date.now());
  }, [sourceTaskId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const snapshotNow = (): void => {
    const saved = pushEditDraftHistory(sourceTaskId, project, { force: true });
    setFeedback(saved ? '已存一个版本' : '与最新一份相同，未重复保存');
    refresh();
  };

  const restore = (snapshot: DraftSnapshot): void => {
    // 防呆：先把**当前**状态存一份（force）——否则"恢复错了"就再也回不来
    pushEditDraftHistory(sourceTaskId, project, { force: true });
    store.replaceProject(snapshot.project, '已从历史版本恢复');
    // 恢复结果也要落草稿（否则刷新后又回到旧的那份）
    saveEditDraft(sourceTaskId, snapshot.project);
    setFeedback('已恢复该版本（当前状态也存了一份）');
    refresh();
  };

  return (
    <div className="ed-hist">
      <button
        type="button"
        className="wb-btn"
        data-testid="ed-hist-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ⏱ 草稿历史
      </button>

      {open ? (
        <div className="ed-hist-pop" data-testid="ed-hist-pop" role="dialog" aria-label="草稿历史">
          <div className="ed-hist-head">
            <span className="ed-hist-title">草稿历史</span>
            <button type="button" className="cr-link" aria-label="关闭" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <p className="wb-note">
            自动快照最多 {DRAFT_HISTORY_LIMIT} 份（编辑时节流保存）。历史只存在**这台浏览器**里，
            不上传服务端。
          </p>

          <div className="ed-hist-actions">
            <button type="button" className="wb-btn" data-testid="ed-hist-save" onClick={snapshotNow}>
              ＋ 存一个版本
            </button>
            <button
              type="button"
              className="wb-btn"
              disabled={snapshots.length === 0}
              onClick={() => {
                clearEditDraftHistory(sourceTaskId);
                setFeedback('历史已清空（当前草稿保留）');
                refresh();
              }}
            >
              清空历史
            </button>
          </div>

          {feedback === null ? null : (
            <p className="wb-note ed-hist-feedback" data-testid="ed-hist-feedback">
              {feedback}
            </p>
          )}

          {broken === 0 ? null : (
            <p className="wb-note cv-insp-warn">
              ⚠ 有 {broken} 份早期快照读不出来（版本过旧或已损坏），已跳过 —— 其余照常可用。
            </p>
          )}

          {snapshots.length === 0 ? (
            <p className="wb-note">还没有历史快照：点「＋ 存一个版本」或继续编辑（会自动存）。</p>
          ) : (
            <ul className="ed-hist-list">
              {snapshots.map((snapshot) => (
                <li key={snapshot.savedAt} className="ed-hist-item">
                  <span className="ed-hist-time">{formatRelative(snapshot.savedAt, now)}</span>
                  <span className="wb-note">{clipCount(snapshot)} 个片段</span>
                  <button
                    type="button"
                    className="wb-btn"
                    data-testid="ed-hist-restore"
                    onClick={() => restore(snapshot)}
                  >
                    恢复
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
