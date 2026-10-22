import {
  createCanvasNode,
  type AgentPlan,
  type AgentPlanStep,
  type CanvasDoc,
  type CanvasDocEdge,
  type CanvasDocNode,
  type CanvasNodeType,
  type CanvasReferenceRole,
  type SkillManifest,
  type SkillParams,
} from '@astrmira/shared';

const ROLE_MAP: Record<
  Extract<AgentPlanStep, { kind: 'add-reference' }>['role'],
  CanvasReferenceRole
> = {
  firstFrame: 'first-frame',
  lastFrame: 'last-frame',
  referenceImage: 'reference-image',
  referenceVideo: 'reference-video',
  audio: 'reference-audio',
};

function stripAssetRef(ref: string): string {
  return ref.startsWith('asset:') ? ref.slice('asset:'.length) : ref;
}

function mergeParams(...items: (SkillParams | undefined)[]): SkillParams {
  const merged: SkillParams = {};
  for (const item of items) {
    if (item === undefined) continue;
    if (item.aspectRatio !== undefined) merged.aspectRatio = item.aspectRatio;
    if (item.resolutionTier !== undefined) merged.resolutionTier = item.resolutionTier;
    if (item.durationSec !== undefined) merged.durationSec = item.durationSec;
  }
  return merged;
}

function nodeTypeFor(skill: SkillManifest): CanvasNodeType {
  const image = skill.modes.includes('t2i');
  const video = skill.modes.some((mode) => mode !== 't2i');
  if (image && !video) return 'image';
  if (video) return 'video';
  return 'text';
}

function addNode(
  plan: AgentPlan,
  skills: readonly SkillManifest[],
  start: { x: number; y: number },
  now: number,
  index: number,
  skillStep?: Extract<AgentPlanStep, { kind: 'apply-skill' }>,
): CanvasDocNode | null {
  const skill =
    skillStep === undefined ? undefined : skills.find((item) => item.id === skillStep.skillId);
  if (skillStep !== undefined && skill === undefined) return null;

  const refs = plan.steps
    .filter((step): step is Extract<AgentPlanStep, { kind: 'add-reference' }> =>
      step.kind === 'add-reference',
    )
    .map((step, order) => ({
      assetId: stripAssetRef(step.ref),
      role: ROLE_MAP[step.role],
      order,
    }));
  const globalParams = plan.steps
    .filter((step): step is Extract<AgentPlanStep, { kind: 'set-params' }> =>
      step.kind === 'set-params',
    )
    .reduce<SkillParams>((acc, step) => mergeParams(acc, step.params), {});
  const params = mergeParams(skill?.params, skillStep?.params, globalParams);
  const type = skill === undefined ? 'text' : nodeTypeFor(skill);
  const title = skill?.name ?? plan.summary.slice(0, 48);
  const prompt =
    skill === undefined
      ? plan.summary
      : [skill.prompt, skillStep?.prompt].filter((item) => item !== undefined).join('\n\n');

  const node = createCanvasNode({
    id: `agent-node-${now}-${index}`,
    type,
    x: start.x + index * 380,
    y: start.y,
    title,
    createdFrom: 'skill',
    now,
  });
  node.data.draft.prompt = prompt;
  node.data.draft.references = refs;
  node.data.draft.settings = {
    ...(type === 'image' || type === 'video'
      ? { mode: type === 'image' ? ('t2i' as const) : ('t2v' as const) }
      : {}),
    ...(params.aspectRatio === undefined ? {} : { aspectRatio: params.aspectRatio }),
    ...(params.durationSec === undefined ? {} : { durationSec: params.durationSec }),
  };
  node.data.draft.updatedAt = now;
  return node;
}

export interface BuiltAgentCanvas {
  nodes: CanvasDocNode[];
  edges: CanvasDocEdge[];
  /** 计划里引用了但当前 catalog 找不到的技能；调用方应如实提示，不静默生成半份计划。 */
  missingSkillIds: string[];
}

/**
 * S7-C2：把 Agent 计划映射成**画布草稿节点**，不提交生成。
 *
 * - `apply-skill` → 一个图片/视频草稿节点；
 * - `add-reference` → 所有节点的稳定引用（`asset:` 去前缀，`task:` 保留）；
 * - `set-params` → 作为全局参数覆盖；
 * - 只有 note、没有技能步骤 → 一个文本节点，保留摘要；
 * - 多个节点按计划顺序连成 `dependency` 边，表示“先做这个，再做那个”。
 *
 * 这是显式映射，不是执行计划；节点没有任务/批次，必须由用户自己点生成。
 */
export function buildAgentCanvasPlan(
  plan: AgentPlan,
  skills: readonly SkillManifest[],
  start: { x: number; y: number },
  now: number = Date.now(),
): BuiltAgentCanvas {
  const skillSteps = plan.steps.filter(
    (step): step is Extract<AgentPlanStep, { kind: 'apply-skill' }> =>
      step.kind === 'apply-skill',
  );
  const missingSkillIds = skillSteps
    .filter((step) => !skills.some((skill) => skill.id === step.skillId))
    .map((step) => step.skillId);

  const nodes: CanvasDocNode[] = [];
  if (skillSteps.length === 0) {
    const node = addNode(plan, skills, start, now, 0);
    if (node !== null) nodes.push(node);
  } else {
    skillSteps.forEach((step, index) => {
      const node = addNode(plan, skills, start, now, index, step);
      if (node !== null) nodes.push(node);
    });
  }

  const edges: CanvasDocEdge[] = nodes.slice(1).map((node, index) => ({
    id: `edge-agent-${now}-${index}`,
    from: nodes[index]!.id,
    to: node.id,
    kind: 'dependency',
  }));

  return { nodes, edges, missingSkillIds };
}

/** 把构建结果追加进文档（不覆盖已有节点）。 */
export function appendAgentCanvasPlan(
  doc: CanvasDoc,
  built: BuiltAgentCanvas,
  now: number = Date.now(),
): CanvasDoc {
  if (built.nodes.length === 0) return doc;
  return {
    ...doc,
    nodes: [...doc.nodes, ...built.nodes],
    edges: [...doc.edges, ...built.edges],
    updatedAt: now,
  };
}
