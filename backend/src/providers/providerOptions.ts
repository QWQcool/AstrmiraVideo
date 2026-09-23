/**
 * 请求体 `options` 的读取规则（CONTRACT §1）。
 *
 * 契约原话："provider 私有参数。仅对声明支持该字段的 provider 生效，
 * **未识别的键必须被忽略而非报错**"。本文件是"读取"这一步的唯一实现，
 * 避免每个 provider 各写一份（`readStringOption` / `readBooleanOption` 之前散在
 * `VolcanoSeedanceProvider` 与 `FixtureLocalProvider` 里）。
 *
 * ⚠️ 2026-09-23 线上故障的教训：`options.model` / `options.baseUrl` 这两个键
 * **此前根本无人消费**，而注册点只读 env —— 于是"界面上切模型"完全没有效果，
 * 用户以为在用自己填的模型，实际发出去的是服务端 `.env` 里的值。
 * 所以本文件也承担一个不敢再忘的义务：**优先级必须可测**（见 registry.ts 的注释与测试）。
 */

/** 取一个非空字符串选项；空白串按"没填"处理（回落到下一优先级） */
export function readOptionString(
  options: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = options?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** 取一个布尔选项（非布尔一律忽略，不做真值转换） */
export function readOptionBoolean(
  options: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = options?.[key];
  return typeof value === 'boolean' ? value : undefined;
}
