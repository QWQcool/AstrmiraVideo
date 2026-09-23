/**
 * 「插入骨架到提示词」的行为（V9 · B8；CONTRACT §11-1 口径）。
 *
 * 三条约定：
 * 1. **逐字**：插入的就是配方卡里的 `skeleton` 原文，不改一个字（AC5 的单测钉住）；
 * 2. **追加而不是替换**：用户可能已经在提示词里写了主体描述，配方是"骨架"——
 *    覆盖掉用户的话是数据丢失，比"插不进去"更糟；
 * 3. **框为空就直接写入**：不留一个孤零零的空行。
 *
 * 做成纯函数是为了能单测：这段逻辑决定了"用户写的东西会不会被吃掉"。
 */
export function appendSkeleton(prompt: string, skeleton: string): string {
  const existing = prompt.trimEnd();
  if (existing.trim() === '') return skeleton;
  return `${existing}\n\n${skeleton}`;
}
