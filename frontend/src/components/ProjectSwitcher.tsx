import { useState } from 'react';
import { ApiError, createProject, deleteProject, renameProject } from '../lib/api';
import {
  DEFAULT_PROJECT_ID,
  canDeleteProject,
  findActiveProject,
} from '../lib/projects';
import { useShell } from '../lib/shell';

/**
 * 项目切换器（V2.11 / 台账 B47，契约 §12）——放在顶栏，与"服务在线"徽章同排。
 *
 * ## 为什么是顶栏而不是侧栏
 * 项目是**全局上下文**（它决定你看到什么、提交到哪里），和主题/凭据（个人偏好）不是一类东西；
 * 放在品牌名旁边，保证"我现在在哪个项目里"在第一屏就被回答。
 *
 * ## 三条交互纪律
 * 1. **不用原生对话框**（项目红线：内嵌 webview 里 `prompt` / `confirm` 可能被禁用甚至静默返回）——
 *    新建 / 改名走**内联输入框**，删除走**两步确认**（删除 → 确认删除）；
 * 2. **做不到的事直接禁用并写明原因**：默认项目与仍有内容的项目不可删（与后端同一套规则，
 *    见 `canDeleteProject`）；前端禁用不是安全边界，服务端仍会独立再判一次；
 * 3. **错误就地显示**，不 alert。
 */
export function ProjectSwitcher() {
  const {
    projectId,
    projects,
    setActiveProject,
    refreshProjects,
    projectError,
    reportProjectError,
  } = useShell();

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renameTo, setRenameTo] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = findActiveProject(projects, projectId);

  function describeError(caught: unknown): string {
    if (caught instanceof ApiError) {
      const code = caught.failure.code === undefined ? '' : `【${caught.failure.code}】`;
      return `${code}${caught.failure.message}`;
    }
    return caught instanceof Error ? caught.message : String(caught);
  }

  async function run(action: () => Promise<string | null>): Promise<void> {
    setBusy(true);
    reportProjectError(null);
    try {
      reportProjectError(await action());
    } catch (caught) {
      reportProjectError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const handleCreate = (): void => {
    if (newName.trim() === '' || busy) return;
    void run(async () => {
      const created = await createProject(newName.trim());
      setNewName('');
      refreshProjects();
      // 新建即切过去：用户的意图就是"到新项目里干活"
      setActiveProject(created.project.projectId);
      return `已创建并切换到「${created.project.name}」`;
    });
  };

  const handleRename = (): void => {
    if (renameTo.trim() === '' || busy) return;
    void run(async () => {
      const updated = await renameProject(projectId, renameTo.trim());
      setRenameTo('');
      refreshProjects();
      return `已改名为「${updated.project.name}」`;
    });
  };

  const handleDelete = (): void => {
    if (busy) return;
    void run(async () => {
      const name = active?.name ?? projectId;
      await deleteProject(projectId);
      setConfirmDelete(false);
      refreshProjects();
      // 删掉的正是当前项目 → 回到默认项目（界面绝不能停在"一个不存在的项目"上）
      setActiveProject(DEFAULT_PROJECT_ID);
      return `已删除「${name}」，已切回默认项目`;
    });
  };

  return (
    <div className="proj-switch">
      <select
        className="wb-input proj-select"
        value={projectId}
        aria-label="当前项目"
        onChange={(event) => {
          reportProjectError(null);
          setActiveProject(event.target.value);
        }}
      >
        {/* 清单还没拉到（接口慢 / 失败）时也**不隐藏**当前项目：否则下拉会跳到默认项目上，
            造成"我明明在 A 项目、下拉却显示默认"的错觉 */}
        {projects.length === 0 ? (
          <option value={projectId}>{active?.name ?? projectId}</option>
        ) : null}
        {projects.map((project) => (
          <option key={project.projectId} value={project.projectId}>
            {project.isDefault ? `${project.name} · 默认` : project.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="wb-btn proj-manage"
        aria-expanded={open}
        aria-label="项目管理"
        title="新建 / 改名 / 删除项目"
        onClick={() => {
          setConfirmDelete(false);
          setOpen((prev) => !prev);
        }}
      >
        ⚙
      </button>

      {open ? (
        <div className="proj-pop" role="dialog" aria-label="项目管理">
          <div className="proj-pop-head">
            <span className="wb-note">
              当前：{active?.name ?? '（未知项目）'}
              {active === null ? '' : ` · ${active.taskCount} 片 / ${active.assetCount} 素材`}
            </span>
            <button
              type="button"
              className="proj-pop-close"
              aria-label="关闭项目管理"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className="proj-row">
            <input
              className="wb-input"
              placeholder="新项目名（如：2026 双十一 · 主推片）"
              value={newName}
              maxLength={60}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreate();
              }}
            />
            <button
              type="button"
              className="wb-btn"
              disabled={newName.trim() === '' || busy}
              onClick={handleCreate}
            >
              新建
            </button>
          </div>

          <div className="proj-row">
            <input
              className="wb-input"
              placeholder="改名（仅当前项目）"
              value={renameTo}
              maxLength={60}
              onChange={(event) => setRenameTo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleRename();
              }}
            />
            <button
              type="button"
              className="wb-btn"
              disabled={renameTo.trim() === '' || busy || active === null}
              onClick={handleRename}
            >
              改名
            </button>
          </div>

          <div className="proj-row proj-row-danger">
            {confirmDelete ? (
              <>
                <span className="wb-note">删除后不可恢复（项目内的任务与素材不会消失，只是不再归属它）。</span>
                <button type="button" className="wb-btn" disabled={busy} onClick={handleDelete}>
                  确认删除
                </button>
                <button type="button" className="wb-btn" onClick={() => setConfirmDelete(false)}>
                  取消
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="wb-btn"
                  disabled={active === null || !canDeleteProject(active) || busy}
                  title={
                    active === null
                      ? '当前项目未知'
                      : !canDeleteProject(active)
                        ? '只有空项目可删：默认项目与仍有任务/素材的项目不可删'
                        : '删除当前项目'
                  }
                  onClick={() => setConfirmDelete(true)}
                >
                  删除当前项目
                </button>
                {active !== null && !canDeleteProject(active) ? (
                  <span className="wb-note">
                    {active.isDefault
                      ? '默认项目不可删（老数据与未指定项目的落点）'
                      : '项目非空：请先在项目内清理任务与素材'}
                  </span>
                ) : null}
              </>
            )}
          </div>

          {projectError === null ? null : <p className="wb-note proj-error">{projectError}</p>}
        </div>
      ) : null}
    </div>
  );
}
