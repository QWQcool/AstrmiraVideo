import { describe, expect, it } from 'vitest';
import { buildCrashReport, describeThrown, stackOf } from './errorReport';

/**
 * 崩溃报告的纯函数部分（V2.24 / 台账 B61 · 片 A）。
 *
 * 为什么这些用例值得写：兜底层**只会在别人已经出事时被执行**。
 * 如果它自己在那一刻抛错（比如对非 Error 的抛出物取 `.message` 得到 undefined、
 * 或者把 undefined 渲染到面板上），用户看到的就是**白屏换成了另一个白屏**。
 * 所以这里逐条钉住"抛出来的东西不是 Error"的各种情形。
 */

const BASE = { label: '画布', hash: '#/canvas', now: new Date(2026, 9, 10, 16, 0, 0).getTime() };

describe('describeThrown：把任何抛出物变成一句人话', () => {
  it('Error → 用 message（不是栈）', () => {
    expect(describeThrown(new Error('节点数据缺失'))).toBe('节点数据缺失');
  });

  it('message 为空的 Error → 退回 name（至少说明是哪类错误）', () => {
    expect(describeThrown(new TypeError(''))).toBe('TypeError');
  });

  it('字符串抛出 → 原样（这是 `throw "xxx"` 的情形）', () => {
    expect(describeThrown('上游返回了空数组')).toBe('上游返回了空数组');
  });

  it('空字符串 → 明确写出来，而不是在面板上留一片空白', () => {
    expect(describeThrown('')).toBe('(空的字符串)');
  });

  it('对象 / 数组 → JSON（Promise 拒绝一个对象时最常见的形态）', () => {
    expect(describeThrown({ code: 'E_UPSTREAM', status: 502 })).toBe('{"code":"E_UPSTREAM","status":502}');
    expect(describeThrown([1, 2])).toBe('[1,2]');
  });

  it('循环引用（JSON.stringify 会抛）→ 退回 String()，绝不因为拼报告而二次崩溃', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(describeThrown(cyclic)).toBe('[object Object]');
  });

  it('undefined / null / 函数 / Symbol → String()，不出现 "undefined" 之类的裸值混进 JSON 分支', () => {
    expect(describeThrown(undefined)).toBe('undefined');
    expect(describeThrown(null)).toBe('null');
    expect(describeThrown(() => 1)).toContain('=>');
    expect(describeThrown(Symbol('boom'))).toBe('Symbol(boom)');
  });
});

describe('stackOf：栈要截断、没有栈就返回空', () => {
  it('截断到指定行数并注明总行数（运维只要顶层几帧）', () => {
    const error = new Error('boom');
    error.stack = ['Error: boom', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
    const head = stackOf(error, 3);
    expect(head).toHaveLength(4); // 3 帧 + 一行"已截断"
    expect(head.slice(0, 3)).toEqual(['Error: boom', 'a', 'b']);
    expect(head[3]).toContain('共 10 行');
  });

  it('没有栈（非 Error 抛出物）→ 空数组，而不是 ["undefined"]', () => {
    expect(stackOf('字符串抛出')).toEqual([]);
    expect(stackOf(undefined)).toEqual([]);
  });

  it('空栈字符串 → 空数组', () => {
    const error = new Error('boom');
    error.stack = '';
    expect(stackOf(error)).toEqual([]);
  });
});

describe('buildCrashReport：面板要说清三件事', () => {
  it('标题指出**坏在哪**（用区域的人话名）', () => {
    const report = buildCrashReport({ ...BASE, error: new Error('x') });
    expect(report.title).toBe('画布出错了');
  });

  it('说明里必须同时有"其余界面可用"与"不是你的数据坏了"（后者是"要不要打电话"的分界线）', () => {
    const report = buildCrashReport({ ...BASE, error: new Error('x') });
    expect(report.summary).toContain('其余界面仍可用');
    expect(report.summary).toContain('不代表你的数据出了问题');
  });

  it('报告含位置 / 视图 / 时间 / 消息四行（报障要能把人带到现场）', () => {
    const report = buildCrashReport({ ...BASE, error: new Error('节点数据缺失'), userAgent: 'UA/1.0' });
    expect(report.details).toContain('位置：画布');
    expect(report.details).toContain('视图：#/canvas');
    expect(report.details).toContain('时间：');
    expect(report.details).toContain('消息：节点数据缺失');
    expect(report.details).toContain('浏览器：UA/1.0');
  });

  it('hash 为空时写 "(无 hash)"，而不是留空（否则那一行看起来像被截断了）', () => {
    const report = buildCrashReport({ ...BASE, hash: '', error: new Error('x') });
    expect(report.details).toContain('视图：(无 hash)');
  });

  it('非 Error 抛出物也能出报告（且不含"栈"段）', () => {
    const report = buildCrashReport({ ...BASE, error: { weird: true } });
    expect(report.details).toContain('消息：{"weird":true}');
    expect(report.details).not.toContain('栈（前几帧）');
  });

  it('userAgent 缺失（Node / 精简环境）时不写那一行', () => {
    const report = buildCrashReport({ ...BASE, error: new Error('x'), userAgent: '' });
    expect(report.details).not.toContain('浏览器：');
  });
});
