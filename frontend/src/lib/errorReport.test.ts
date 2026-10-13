import { describe, expect, it } from 'vitest';
import {
  buildCrashReport,
  buildRuntimeErrorNotice,
  describeThrown,
  isBenignRuntimeNoise,
  stackOf,
} from './errorReport';

/**
 * 崩溃报告的纯函数部分（台账 B61 · 片 A）。
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

/**
 * B61 · 片 B：window 层通知（决策 D52 = 只本地提示，不上报）。
 *
 * 这一层最容易犯的错**不是崩溃，而是撒谎** —— 它会把用户平时看不见的运行时错误
 * 第一次摆到眼前，措辞稍有偏差就会变成误导（"你正在看的这块坏了" / "已经报给我们了"）。
 * 所以下面逐句钉住它的措辞与去重前提。
 */
const RUNTIME_BASE = { hash: '#/canvas', now: BASE.now };

describe('buildRuntimeErrorNotice：措辞不能误导', () => {
  it('标题说"有一处代码出错了"，**不冒充**"你这个视图坏了"（它可能发生在别处）', () => {
    const notice = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('x') });
    expect(notice.title).toBe('界面里有一处代码出错了');
    expect(notice.title).not.toContain('画布');
  });

  it('说明里必须给"怎么办"（刷新）与"数据没事"（成片/任务在服务端）', () => {
    const notice = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('x') });
    expect(notice.summary).toContain('刷新一次');
    expect(notice.summary).toContain('服务端');
  });

  it('必须如实写明**只在本机提示、没有上报**（用户选的是 D52 的"只本地提示"）', () => {
    const notice = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'rejection', error: new Error('x') });
    expect(notice.summary).toContain('只出现在这台机器上');
    expect(notice.details).toContain('没有上报到服务器');
  });

  it('两类来源在报告里可区分（报障时"是不是 Promise 没接住"是个关键线索）', () => {
    const script = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('x') });
    const rejection = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'rejection', error: new Error('x') });
    expect(script.details).toContain('脚本错误');
    expect(rejection.details).toContain('未处理的 Promise 拒绝');
  });

  it('报告含来源 / 视图 / 时间 / 消息（与崩溃面板同一套报障要素）', () => {
    const notice = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('boom'), userAgent: 'UA/1.0' });
    expect(notice.details).toContain('视图：#/canvas');
    expect(notice.details).toContain('时间：');
    expect(notice.details).toContain('消息：boom');
    expect(notice.details).toContain('浏览器：UA/1.0');
  });

  it('hash 为空写 "(无 hash)"；非 Error 抛出物（Promise 拒绝一个对象）也能出报告且无栈段', () => {
    const notice = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'rejection', error: { code: 502 }, hash: '' });
    expect(notice.details).toContain('视图：(无 hash)');
    expect(notice.details).toContain('消息：{"code":502}');
    expect(notice.details).not.toContain('栈（前几帧）');
  });

  it('签名 = 去重的前提：**同一条错误重复抛 → 同签名**（否则提示条会被刷屏）', () => {
    const first = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('loop') });
    const second = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('loop') });
    expect(first.signature).toBe(second.signature);
  });

  it('但来源不同、消息不同 → 签名不同（该各提示一次）', () => {
    const script = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('same') });
    const rejection = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'rejection', error: new Error('same') });
    const other = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('another') });

    expect(script.signature).not.toBe(rejection.signature);
    expect(script.signature).not.toBe(other.signature);
  });

  it('**签名不含栈**：同消息在不同位置抛出也合成一条（循环里抛 200 次不能弹 200 条）', () => {
    const here = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('循环里的错误') });
    const elsewhere = new Error('循环里的错误');
    elsewhere.stack = 'Error: 循环里的错误\n    at tick (app.js:1:1)';
    const moved = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: elsewhere });

    expect(moved.signature).toBe(here.signature);
    // 代价如实登记：少弹的那几条只在"另有 N 次同类"里留一个数字
    expect(moved.details).toContain('at tick (app.js:1:1)');
  });
});

/**
 * 良性噪声（**上线当天真实撞到的**）：`ResizeObserver loop …` 是浏览器自己的通知丢失，
 * 对功能无害，但会以 `error` 事件抛出来。不筛掉它，用户就会收到一条误报 ——
 * 而"提示条开始误报"比"静默"更糟（真出事时用户不看了）。
 */
describe('isBenignRuntimeNoise：浏览器噪声要筛掉，真错误不能误伤', () => {
  it('两种写法的 ResizeObserver 都不是应用缺陷（新老 Chromium 各一种）', () => {
    expect(isBenignRuntimeNoise('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isBenignRuntimeNoise('ResizeObserver loop limit exceeded')).toBe(true);
  });

  it('带前缀也认得（`ErrorEvent.message` 常是 `Uncaught Error: …`）', () => {
    expect(
      isBenignRuntimeNoise('Uncaught Error: ResizeObserver loop completed with undelivered notifications.'),
    ).toBe(true);
  });

  it('真错误**不能**被误伤（白名单是"包含"匹配，所以更要钉住这条）', () => {
    expect(isBenignRuntimeNoise('Cannot read properties of undefined (reading "id")')).toBe(false);
    expect(isBenignRuntimeNoise('Failed to fetch')).toBe(false);
    // 只是"提到了 ResizeObserver"并不等于噪声：我们自己写的观察者回调抛错仍是缺陷
    expect(isBenignRuntimeNoise('ResizeObserver 回调里读到了 undefined')).toBe(false);
  });

  it('通知上带 benign 标记（调用方据此"留控制台、不弹提示"）', () => {
    const noisy = buildRuntimeErrorNotice({
      ...RUNTIME_BASE,
      source: 'script',
      error: new Error('ResizeObserver loop completed with undelivered notifications.'),
    });
    const real = buildRuntimeErrorNotice({ ...RUNTIME_BASE, source: 'script', error: new Error('真错误') });
    expect(noisy.benign).toBe(true);
    expect(real.benign).toBe(false);
  });
});
