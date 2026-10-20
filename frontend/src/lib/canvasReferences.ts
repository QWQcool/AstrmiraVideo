import type { CanvasNodeType, CanvasReference } from '@astrmira/shared';
import type { ReferenceKind } from './referenceSources';

/**
 * S5-Ac：把“选中的来源”变成节点的稳定引用。
 *
 * 规则只在一处：
 * - 视频节点最多 1 条参考视频；有参考视频时不再混入图片（v2v 下图片会被忽略）；
 * - 图片按顺序填首帧、尾帧，最多 2 张；已占用槽不覆盖；
 * - 音频不是生成参考，忽略；
 * - 不复制文件，只写 assetId / `task:` + role + order。
 *
 * 返回值把“实际加入”和“被忽略”分开，界面必须如实提示，不能静默吞掉选择。
 */
export interface ReferenceCandidate {
  ref: string;
  kind: ReferenceKind;
}

export interface AddReferencesResult {
  references: CanvasReference[];
  added: number;
  ignored: number;
}

export function allowedKindsForReferenceTarget(
  references: readonly CanvasReference[],
): ReferenceKind[] {
  if (references.some((item) => item.role === 'reference-video')) return ['video'];
  if (
    references.some(
      (item) =>
        item.role === 'first-frame' ||
        item.role === 'last-frame' ||
        item.role === 'reference-image',
    )
  ) {
    return ['image'];
  }
  return ['image', 'video'];
}

export function addReferencesToDraft(
  existing: readonly CanvasReference[],
  candidates: readonly ReferenceCandidate[],
  nodeType: CanvasNodeType,
): AddReferencesResult {
  if (nodeType !== 'video' || candidates.length === 0) {
    return { references: [...existing], added: 0, ignored: candidates.length };
  }

  const references = [...existing];
  const seen = new Set(references.map((item) => item.assetId));
  let hasFirst = references.some((item) => item.role === 'first-frame');
  let hasLast = references.some((item) => item.role === 'last-frame');
  let hasVideo = references.some((item) => item.role === 'reference-video');
  const hasImages = references.some(
    (item) =>
      item.role === 'first-frame' ||
      item.role === 'last-frame' ||
      item.role === 'reference-image',
  );
  let order = references.reduce((max, item) => Math.max(max, item.order), -1) + 1;
  const lock: ReferenceKind | null = hasVideo
    ? 'video'
    : hasImages
      ? 'image'
      : (candidates[0]?.kind ?? null);

  let added = 0;
  let ignored = 0;

  for (const candidate of candidates) {
    if (candidate.kind === 'audio' || seen.has(candidate.ref)) {
      ignored += 1;
      continue;
    }
    if (lock === 'video' && candidate.kind !== 'video') {
      ignored += 1;
      continue;
    }
    if (lock === 'image' && candidate.kind !== 'image') {
      ignored += 1;
      continue;
    }

    if (candidate.kind === 'video') {
      if (hasVideo) {
        ignored += 1;
        continue;
      }
      references.push({ assetId: candidate.ref, role: 'reference-video', order });
      seen.add(candidate.ref);
      hasVideo = true;
      order += 1;
      added += 1;
      continue;
    }

    if (candidate.kind === 'image') {
      if (!hasFirst) {
        references.push({ assetId: candidate.ref, role: 'first-frame', order });
        hasFirst = true;
      } else if (!hasLast) {
        references.push({ assetId: candidate.ref, role: 'last-frame', order });
        hasLast = true;
      } else {
        ignored += 1;
        continue;
      }
      seen.add(candidate.ref);
      order += 1;
      added += 1;
      continue;
    }

    ignored += 1;
  }

  return { references, added, ignored };
}
