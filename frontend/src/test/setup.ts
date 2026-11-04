import { beforeAll } from 'vitest';

/**
 * 测试环境的**语言必须固定**（2026-11-04）。
 *
 * 来由：这批单测的断言写的是中文文案（`zh` 字典是唯一真相），而界面语言的默认值
 * 会跟随 `navigator.language` —— Node 的 `navigator.language` 又来自 ICU 的默认 locale：
 * 开发机是 `zh-CN`、GitHub runner 是 `en-US`。于是同一份测试**本地绿、CI 红**，
 * 报错长这样：`expected 'Prompt is empty' to contain '提示词为空'`。
 *
 * 这不是"文案测错了"，是**测试依赖了环境**。把语言钉死，测试才在哪儿跑都一样；
 * 真要测多语言，用 `detectLanguage({ navigatorLanguage })` 显式注入（`i18n.test.ts` 就是这么做的）。
 */
beforeAll(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'zh-CN', languages: ['zh-CN'] },
    configurable: true,
    writable: true,
  });
});
