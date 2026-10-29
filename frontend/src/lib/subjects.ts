import { z } from 'zod';
import {
  SubjectCreateSchema,
  SubjectListResponseSchema,
  SubjectPatchSchema,
  SubjectResponseSchema,
  DeleteSubjectResponseSchema,
  subjectReferenceOf,
  type CanvasNodeType,
  type CanvasReference,
  type CanvasReferenceMode,
  type Subject,
  type SubjectCreateInput,
  type SubjectPatchInput,
} from '@astrmira/shared';
import { addReferencesToDraft } from './canvasReferences';

/**
 * 主体库的前端一层（CONTRACT §21-18 / V2.86 / D-3）。
 *
 * ## 为什么"加主体"不是一个新动作
 * 主体**不是**新的参考类型，它压成一条普通参考（`assetId + role + order`）再加一个
 * `subjectId` 溯源标签。所以这里直接复用 `addReferencesToDraft` 的槽位规则 ——
 * 若各自实现一套，"从主体加"和"从资产库加"迟早对同一节点给出不同结果。
 *
 * ## 三条口径
 * 1. **没有素材就不能加**（`no-asset`）：先让用户去挑图，而不是加一条空参考；
 * 2. **重复不新建**：同一个素材已在节点里 → 只补 `subjectId`（`linked`），不产生第二条；
 * 3. **槽位满了如实说**（`unsupported`）：不静默丢弃，也不强行覆盖已有的首/尾帧。
 */

const API = '/api/subjects';

export function fetchSubjects(signal?: AbortSignal): Promise<{ subjects: Subject[] }> {
  return request('GET', API, SubjectListResponseSchema, undefined, signal);
}

export function createSubject(input: SubjectCreateInput): Promise<{ subject: Subject }> {
  return request('POST', API, SubjectResponseSchema, SubjectCreateSchema.parse(input));
}

export function patchSubject(
  subjectId: string,
  patch: SubjectPatchInput,
): Promise<{ subject: Subject }> {
  return request(
    'PATCH',
    `${API}/${encodeURIComponent(subjectId)}`,
    SubjectResponseSchema,
    SubjectPatchSchema.parse(patch),
  );
}

export function deleteSubject(subjectId: string): Promise<z.infer<typeof DeleteSubjectResponseSchema>> {
  return request('DELETE', `${API}/${encodeURIComponent(subjectId)}`, DeleteSubjectResponseSchema);
}

/**
 * 轻量请求器（不引入 `lib/api.ts` 的那一套：那里的 `ApiError` 会带契约诊断文案，
 * 而主体库的失败对用户只有两种可行动作 —— 重试 / 看看服务是否在线）。
 *
 * 这里仍把**服务端返回的原因**透出来：`{code, message}` 由调用方显示，
 * 不自己编一句"操作失败"。
 */
async function request<S extends z.ZodType>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  schema: S,
  body?: unknown,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const response = await fetch(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const shaped = z.object({ code: z.string(), message: z.string() }).safeParse(payload);
    throw new Error(
      shaped.success
        ? `${shaped.data.code}：${shaped.data.message}`
        : `HTTP ${response.status}（${path}）`,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error(`响应不符合契约（${path}）：${parsed.error.issues[0]?.message ?? ''}`);
  return parsed.data;
}

export type SubjectAttachReason = 'no-asset' | 'unsupported';

export interface SetSubjectAnchorInput {
  /** 定妆图：普通资产 id 或 	ask:<taskId> */
  assetId: string;
  /** 由哪条任务生成（手动指定时不给） */
  taskId?: string;
}

/**
 * 设 / 换主体锚点（V2.99 / N9）。
 *
 * 为什么不在服务端代提交生成：引擎选择与凭据都在客户端（BYOK、多实例），
 * 服务端代跑就得复制一整套选择逻辑，还会在云端轨上**替用户花钱**。
 */
export function setSubjectAnchor(
  subjectId: string,
  input: SetSubjectAnchorInput,
): Promise<{ subject: Subject }> {
  return patchSubject(subjectId, {
    anchorAssetId: input.assetId,
    ...(input.taskId === undefined ? {} : { anchorTaskId: input.taskId }),
    anchorSource: input.taskId === undefined ? 'manual' : 'generated',
  });
}

export interface AttachSubjectResult {
  references: CanvasReference[];
  /** 新增了一条参考 */
  added: boolean;
  /** 素材已在节点里，只补了 subjectId（不新增条目） */
  linked: boolean;
  /** 这次用的是定妆图还是回落的第一张参考（界面必须标出来） */
  used: 'anchor' | 'fallback';
  /** 没加成时的原因（调用方必须如实显示，不能什么都不做） */
  reason?: SubjectAttachReason;
}

/**
 * 把一个主体加到节点的参考里。
 *
 * `referenceMode` 必须是节点当前的模式（图片节点只有 `omni-reference` 能收多图；
 * 否则 `addReferencesToDraft` 会如实拒绝 → 这里返回 `unsupported`，界面提示"先切到全能参考"）。
 */
export function attachSubjectToReferences(
  existing: readonly CanvasReference[],
  subject: Subject,
  nodeType: CanvasNodeType,
  referenceMode?: CanvasReferenceMode,
): AttachSubjectResult {
  // V2.99：**优先用定妆图**（有锚点就用锚点，没有才回落第一张参考）
  const picked = subjectReferenceOf(subject);
  if (picked === null) {
    return { references: [...existing], added: false, linked: false, used: 'fallback', reason: 'no-asset' };
  }
  const assetId = picked.assetId;
  const used = picked.kind;

  const at = existing.findIndex((item) => item.assetId === assetId);
  if (at !== -1) {
    return {
      references: existing.map((item, index) =>
        index === at ? { ...item, subjectId: subject.id } : item,
      ),
      added: false,
      linked: true,
      used,
    };
  }

  const result = addReferencesToDraft(
    existing,
    [{ ref: assetId, kind: 'image' }],
    nodeType,
    referenceMode === undefined ? {} : { referenceMode },
  );
  if (result.added === 0) {
    return { references: [...existing], added: false, linked: false, used, reason: 'unsupported' };
  }

  return {
    references: result.references.map((item) =>
      item.assetId === assetId ? { ...item, subjectId: subject.id } : item,
    ),
    added: true,
    linked: false,
    used,
  };
}

/** 节点里这些参考分别来自哪些主体（界面用来显示「未知主体」/ 主体名） */
export function subjectIdsInReferences(references: readonly CanvasReference[]): string[] {
  return [...new Set(references.flatMap((item) => (item.subjectId === undefined ? [] : [item.subjectId])))];
}

/** `subjectId` → 主体名；库里没有 → null（调用方显示「未知主体」，不静默当成不存在） */
export function subjectName(subjects: readonly Subject[], subjectId: string): string | null {
  return subjects.find((item) => item.id === subjectId)?.name ?? null;
}
