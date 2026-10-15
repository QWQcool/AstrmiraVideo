import { describe, expect, it } from 'vitest';
import { EN, ZH } from './index';

/**
 * 字典完整性（L1 收官件 · 第三批：语言迁移第一批 = 外壳）。
 *
 * ## 为什么这些必须由机器盯
 * 每一条的失败形态都是**用户可见的坏**，而且都不会让编译或别的测试变红：
 * - 漏译 / 多译 → 切到英文时那一处显示**键名**（`shell.nav.create`）或残留中文；
 * - 空白文案 → 界面上出现一块**空洞**（看起来像"这里本来就没字"）；
 * - 占位符中英不一致 → 英文句子少一个 `{count}`（数字消失）或多一个（原样显示 `{foo}`）；
 * - 键名不规范 → 半年后没人知道 `navCreate` 与 `shell.nav.create` 是不是一回事。
 *
 * ## 与编译期检查的分工（两边都要）
 * `lib/dict/index.ts` 用 `Record<MessageKey, string>` 盯住"**英文不缺键**"；
 * 但 `EN` 是用 `{...SHELL_EN}` 展开出来的 —— **多写的键**不会触发编译器的
 * "对象字面量未知属性"检查，所以"**不多键**"只能在这里断言。
 */

const KEYS = Object.keys(ZH);
/**
 * 键名规范：`域.用途`，至少两段，段内 camelCase。
 *
 * ⚠️ 段内**允许数字**（但不能以数字开头）：模式名的领域缩写本来就是 `t2v` / `i2v` / `fl2v` ——
 * 禁掉数字会逼着把通用缩写改写成 `t2v` 之外的怪名字。
 */
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const PLACEHOLDER = /\{(\w+)\}/g;
const CJK = /[\u4e00-\u9fa5]/;

function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '').sort();
}

describe('字典完整性（不靠人眼）', () => {
  it('不是空字典（迁完的域必须有内容 —— 空字典会让"迁移完成"这件事看起来也像完成）', () => {
    expect(KEYS.length).toBeGreaterThan(20);
  });

  it('**中英键集完全一致**', () => {
    expect(Object.keys(EN).sort()).toEqual([...KEYS].sort());
  });

  it('每条都有非空文案（空白 = 界面上的一块空洞）', () => {
    for (const key of KEYS) {
      expect(ZH[key as keyof typeof ZH].trim(), `zh.${key}`).not.toBe('');
      expect(EN[key as keyof typeof EN].trim(), `en.${key}`).not.toBe('');
    }
  });

  it('键名规范：`域.用途`，段内 camelCase（至少两段）', () => {
    for (const key of KEYS) {
      expect(key, key).toMatch(KEY_PATTERN);
    }
  });

  it('**占位符中英一一对应**（句式可以不同，变量不能）', () => {
    for (const key of KEYS) {
      expect(placeholdersOf(EN[key as keyof typeof EN]), `en.${key}`).toEqual(
        placeholdersOf(ZH[key as keyof typeof ZH]),
      );
    }
  });

  it('英文里不得出现中文（漏译检测：复制粘贴中文那一份是最常见的漏译）', () => {
    for (const key of KEYS) {
      const value = EN[key as keyof typeof EN];
      expect(CJK.test(value), `en.${key} = ${value}`).toBe(false);
    }
  });
});
