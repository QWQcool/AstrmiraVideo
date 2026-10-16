import { useState } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { CanvasNote } from '../lib/canvasNotes';
import { useTranslate } from '../lib/i18n';

/**
 * 画布便签（V2.22 / 台账 B67）。
 *
 * 与节点卡（`NodeCard.tsx`）的区别：**它不是数据**，是一段贴在画布上的说明 ——
 * 所以它可编辑、可删除、可拖动，而且**不参与血缘推导**（不引用任何节点 id）。
 *
 * 交互取舍：**默认只读渲染文本**，点一下才变输入框（"点开编辑"），
 * 否则整块 textarea 会吃掉画布的拖动与框选（那是画布的主要操作）。
 *
 * 语言迁移第九批（片 A）：文案走 `canvas.*`（`lib/dict/canvas.ts`）。
 */
export type CanvasNoteNode = Node<{ note: CanvasNote; onText: (id: string, text: string) => void; onDelete: (id: string) => void }, 'note'>;

export function NoteCard({ data }: NodeProps<CanvasNoteNode>) {
  const { note, onText, onDelete } = data;
  const t = useTranslate();
  const [editing, setEditing] = useState(note.text === '');
  /** 编辑期间只存本地（**失焦才提交**）：否则每敲一个字都会重建整张图 */
  const [draft, setDraft] = useState(note.text);

  return (
    <div className="cv-sticky" data-testid="cv-note" data-note-id={note.id}>
      <div className="cv-sticky-head">
        <span className="cv-sticky-glyph" aria-hidden="true">
          🗒
        </span>
        <button
          type="button"
          className="cr-link"
          aria-label={t('canvas.note.deleteAria')}
          data-testid="cv-note-delete"
          onClick={() => onDelete(note.id)}
        >
          ✕
        </button>
      </div>

      {editing ? (
        <textarea
          className="cv-sticky-input"
          data-testid="cv-note-input"
          value={draft}
          autoFocus
          placeholder={t('canvas.note.placeholder')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== note.text) onText(note.id, draft);
          }}
        />
      ) : (
        <button
          type="button"
          className="cv-sticky-text"
          data-testid="cv-note-text"
          title={t('canvas.note.editTitle')}
          onClick={() => {
            setDraft(note.text);
            setEditing(true);
          }}
        >
          {note.text === '' ? t('canvas.note.empty') : note.text}
        </button>
      )}
    </div>
  );
}
