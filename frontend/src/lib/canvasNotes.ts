import { STORAGE_KEYS, browserStorage, readLocal, writeLocal, type StorageAccess } from './storage';

/**
 * 画布便签（V2.22 / 台账 B67；设计参考 n8n 的 sticky notes，独立实现）。
 *
 * ## 为什么是便签，而不是"分组"
 * n8n 的分组（container node）解决的是"几十个可执行节点怎么归类"；我们的画布是**只读事实图**
 * （节点 = 已发生的任务/素材），既不能改名也不能复制，分组解决不了我们真正的问题 ——
 * 真正的痛点是"**这张图在讲什么**"：这是客户 A 的广告片链、那是试错留下的废链。
 * 便签（一段贴在画布上的说明）恰好回答这个，而且**零契约、零服务端**。
 *
 * ## 三条口径
 * 1. **按项目隔离**：键名 `astrmira.canvasNotes.<projectId>` —— 便签属于"这个项目的这张图"；
 * 2. **只存文本与位置**：便签**不引用任何节点 id**（引用了就会随节点消失而变悬空），
 *    它是"贴在旁边的话"，不是"挂在节点上的属性"；
 * 3. **坏数据跳过不炸**：逐条校验，坏的丢掉（便签是便利功能，不该因为一条脏数据让画布白屏）。
 */

export interface CanvasNote {
  id: string;
  text: string;
  x: number;
  y: number;
  updatedAt: number;
}

export interface CanvasNotesLoad {
  notes: CanvasNote[];
  /** 被跳过的坏条数（如实告知，不假装读全了） */
  broken: number;
}

export function canvasNotesKey(projectId: string): string {
  return `${STORAGE_KEYS.canvasNotesPrefix}${projectId}`;
}

function isNote(value: unknown): value is CanvasNote {
  if (typeof value !== 'object' || value === null) return false;
  const note = value as Partial<CanvasNote>;
  return (
    typeof note.id === 'string' &&
    note.id !== '' &&
    typeof note.text === 'string' &&
    typeof note.x === 'number' &&
    Number.isFinite(note.x) &&
    typeof note.y === 'number' &&
    Number.isFinite(note.y)
  );
}

export function loadCanvasNotes(
  projectId: string,
  access: StorageAccess = browserStorage(),
): CanvasNotesLoad {
  const raw = readLocal(access, canvasNotesKey(projectId));
  if (raw === null) return { notes: [], broken: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { notes: [], broken: 0 };
  }
  if (!Array.isArray(parsed)) return { notes: [], broken: 0 };

  const notes = parsed.filter(isNote).map((note) => ({
    ...note,
    updatedAt: typeof note.updatedAt === 'number' ? note.updatedAt : 0,
  }));
  return { notes, broken: parsed.length - notes.length };
}

export function saveCanvasNotes(
  projectId: string,
  notes: CanvasNote[],
  access: StorageAccess = browserStorage(),
): void {
  try {
    writeLocal(access, canvasNotesKey(projectId), JSON.stringify(notes));
  } catch {
    /* 配额满 / 隐私模式：便签是便利功能，写不进去就静默降级（不阻塞画布） */
  }
}

/** 新建一张便签（位置由调用方给：通常是当前视口中心附近，避免落在看不见的地方） */
export function createNote(notes: CanvasNote[], at: { x: number; y: number }, now = Date.now()): CanvasNote[] {
  const note: CanvasNote = {
    id: `note-${now}-${Math.round(at.x)}-${Math.round(at.y)}`,
    text: '',
    x: at.x,
    y: at.y,
    updatedAt: now,
  };
  return [...notes, note];
}

export function updateNote(
  notes: CanvasNote[],
  id: string,
  patch: Partial<Pick<CanvasNote, 'text' | 'x' | 'y'>>,
  now = Date.now(),
): CanvasNote[] {
  return notes.map((note) => (note.id === id ? { ...note, ...patch, updatedAt: now } : note));
}

export function removeNote(notes: CanvasNote[], id: string): CanvasNote[] {
  return notes.filter((note) => note.id !== id);
}
