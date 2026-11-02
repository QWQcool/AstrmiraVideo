import type { CanvasDoc } from '@astrmira/shared';

/**
 * "另存为一块新画布"（V2.110 / 台账 B85 片 C）。
 *
 * ## 它救的是什么
 * 冲突之后的唯一动作是"重载"；如果重载发现**这份画布已经在别处被删了**（404），
 * 旧行为只是报一句错，界面上还留着用户的节点，但**再也存不回去**（墓碑会拒绝复活）。
 * 那时候用户手里唯一还有价值的东西就是内存里这份文档 —— 这里把它原样搬到新 projectId 上。
 *
 * ## 只改身份，不动内容
 * 节点/连线 id 在文档内部唯一即可，不需要重编；`revision` 必须回到 1（新文档），
 * `createdAt` 取当下（它确实是刚创建的）。
 */
export function rescueAsNewCanvas(
  doc: CanvasDoc,
  projectId: string,
  name: string,
  now: number = Date.now(),
): CanvasDoc {
  return {
    ...doc,
    projectId,
    name,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** 给副本起个不空洞的名字（"原名（副本）"），避免两个画布在列表里同名 */
export function rescueName(original: string): string {
  const trimmed = original.trim();
  const base = trimmed === '' ? '画布' : trimmed;
  return `${base}（副本）`;
}
