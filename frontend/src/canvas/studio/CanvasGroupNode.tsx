import { useState, type ReactNode } from 'react';
import { useTranslate } from '../../lib/i18n';
import { useStudio } from './StudioContext';

/**
 * V2.81：分组框（P3）。
 *
 * 它**不是拖拽容器**：节点坐标不变，框由成员包围盒实时算（见 `canvasGroupBounds`）。
 * 拖动成员 → 组框自动跟着变；这类"派生出来的框"不需要也不应该有自己的位置。
 *
 * 交互只有三条：点标题选中全部成员、双击标题改名、右上角 × 解散（节点保留）。
 */
export interface CanvasGroupNodeData {
  groupId: string;
  title: string;
  memberCount: number;
  color?: string;
}

export function CanvasGroupNode({ data }: { data: CanvasGroupNodeData }): ReactNode {
  const t = useTranslate();
  const studio = useStudio();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.title);

  const commit = () => {
    setEditing(false);
    studio.onRenameGroup(data.groupId, draft);
  };

  return (
    <div
      className="cs-group"
      style={data.color === undefined ? undefined : { borderColor: data.color }}
      // 组框盖住整块区域：不吃指针事件，否则成员节点点不到
      data-testid={`group-${data.groupId}`}
    >
      <div className="cs-group-head">
        {editing ? (
          <input
            className="cs-group-title-input"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setEditing(false);
                setDraft(data.title);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="cs-group-title"
            title={t('canvas.group.selectHint')}
            onClick={(event) => {
              event.stopPropagation();
              studio.onSelectGroup(data.groupId);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setDraft(data.title);
              setEditing(true);
            }}
          >
            {data.title}
            <span className="cs-group-count">{data.memberCount}</span>
          </button>
        )}
        <button
          type="button"
          className="cs-group-run"
          title={t('canvas.group.run')}
          onClick={(event) => {
            event.stopPropagation();
            studio.onRunGroup(data.groupId);
          }}
        >
          {t('canvas.group.runLabel')}
        </button>
        <button
          type="button"
          className="cs-group-close"
          aria-label={t('canvas.group.ungroup')}
          title={t('canvas.group.ungroup')}
          onClick={(event) => {
            event.stopPropagation();
            studio.onRemoveGroup(data.groupId);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
