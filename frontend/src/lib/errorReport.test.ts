import { describe, expect, it } from 'vitest';
import {
  buildCrashReport,
  buildRuntimeErrorNotice,
  describeThrown,
  isBenignRuntimeNoise,
  stackOf,
} from './errorReport';
import { getLanguage, setLanguage } from './i18n';

/**
 * 崩溃报告的纯函数部分（台账 B61 · 片 A）。
 *
 * 为什么这些用例值得写：兜底层**只会在别人已经出事时被执行**。
 * 如果它自己在那一刻抛错（比如对非 Error 的抛出物取 `.message` 得到 undefined、
 * 或者把 undefined 渲染到面板上），用户看到的就是**白屏换成了另一个白屏**。
 * 所以这里逐条钉住"抛出来的东西不是 Error"的各种情形。
 *
 * ## 语言迁移第七批：文案进字典后，这些断言**一字未改**
 * 迁移的纪律是"**不改文案**"，所以下面那些中文原句就是验收标尺 ——
 * 改一个标点都会红。为此每个用例都**显式传 `language: 'zh'` / `'zh'`**：
 * 靠全局默认值（`getLanguage()`）会让"某个用例先改了语言"悄悄影响后面的用例，
 * 而这类失败在报告里看起来像"文案错了"，追因成本极高。
 * （"缺省真的取当前语言"这件事另有一组专门盯，见文件末尾。）
 */

const NOW = new Date(2026, 9, 10, 16, 0, 0).getTime();
const ZH = { label: '画布', hash: '#/canvas', now: NOW, language: 'zh' as const };
const EN = { label: 'Canvas', hash: '#/canvas', now: NOW, language: 'en' as const };

/** 中文文案一个字都不许漏进英文界面（"半中半英"比只有中文更糟） */
const CJK = /[\u4e00-\u9fa5]/;

describe('describeThrown：把任何抛出物变成一句人话', () => {
  it('Error → 用 message（不是栈）', () => {
    expect(describeThrown(new Error('节点数据缺失'), 'zh')).toBe('节点数据缺失');
  });

  it('message 为空的 Error → 退回 name（至少说明是哪类错误）', () => {
    expect(describeThrown(new TypeError(''), 'zh')).toBe('TypeError');
  });

  it('字符串抛出 → 原样（这是 `throw "xxx"` 的情形）', () => {
    expect(describeThrown('上游返回了空数组', 'zh')).toBe('上游返回了空数组');
  });

  it('空字符串 → 明确写出来，而不是在面板上留一片空白', () => {
    expect(describeThrown('', 'zh')).toBe('(空的字符串)');
    // 这一句是**文案**（渲染进面板的），所以跟着语言走
    expect(describeThrown('', 'en')).toBe('(empty string)');
  });

  it('对象 / 数组 → JSON（Promise 拒绝一个对象时最常见的形态）', () => {
    expect(describeThrown({ code: 'E_UPSTREAM', status: 502 }, 'zh')).toBe('{"code":"E_UPSTREAM","status":502}');
    expect(describeThrown([1, 2], 'zh')).toBe('[1,2]');
  });

  it('循环引用（JSON.stringify 会抛）→ 退回 String()，绝不因为拼报告而二次崩溃', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(describeThrown(cyclic, 'zh')).toBe('[object Object]');
  });

  it('undefined / null / 函数 / Symbol → String()，不出现 "undefined" 之类的裸值混进 JSON 分支', () => {
    expect(describeThrown(undefined, 'zh')).toBe('undefined');
    expect(describeThrown(null, 'zh')).toBe('null');
    expect(describeThrown(() => 1, 'zh')).toContain('=>');
    expect(describeThrown(Symbol('boom'), 'zh')).toBe('Symbol(boom)');
  });
});

describe('stackOf：栈要截断、没有栈就返回空', () => {
  it('截断到指定行数并注明总行数（运维只要顶层几帧）', () => {
    const error = new Error('boom');
    error.stack = ['Error: boom', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
    const head = stackOf(error, 3, 'zh');
    expect(head).toHaveLength(4); // 3 帧 + 一行"已截断"
    expect(head.slice(0, 3)).toEqual(['Error: boom', 'a', 'b']);
    expect(head[3]).toContain('共 10 行');
  });

  it('没有栈（非 Error 抛出物）→ 空数组，而不是 ["undefined"]', () => {
    expect(stackOf('字符串抛出', undefined, 'zh')).toEqual([]);
    expect(stackOf(undefined, undefined, 'zh')).toEqual([]);
  });

  it('空栈字符串 → 空数组', () => {
    const error = new Error('boom');
    error.stack = '';
    expect(stackOf(error)).toEqual([]);
  });

  it('"已截断"那一行也是文案（英文界面下不该冒出一行中文）', () => {
    const error = new Error('boom');
    error.stack = ['Error: boom', 'a', 'b'].join('\n');
    const head = stackOf(error, 1, 'en');
    expect(head[1]).toContain('3 lines total');
    expect(head[1]).not.toMatch(CJK);
  });
});

describe('buildCrashReport：面板要说清三件事', () => {
  it('标题指出**坏在哪**（用区域的人话名）', () => {
    const report = buildCrashReport({ ...ZH, error: new Error('x') });
    expect(report.title).toBe('画布出错了');
  });

  it('说明里必须同时有"其余界面可用"与"不是你的数据坏了"（后者是"要不要打电话"的分界线）', () => {
    const report = buildCrashReport({ ...ZH, error: new Error('x') });
    expect(report.summary).toContain('其余界面仍可用');
    expect(report.summary).toContain('不代表你的数据出了问题');
  });

  it('报告含位置 / 视图 / 时间 / 消息四行（报障要能把人带到现场）', () => {
    const report = buildCrashReport({ ...ZH, error: new Error('节点数据缺失'), userAgent: 'UA/1.0' });
    expect(report.details).toContain('位置：画布');
    expect(report.details).toContain('视图：#/canvas');
    expect(report.details).toContain('时间：');
    expect(report.details).toContain('消息：节点数据缺失');
    expect(report.details).toContain('浏览器：UA/1.0');
  });

  it('hash 为空时写 "(无 hash)"，而不是留空（否则那一行看起来像被截断了）', () => {
    const report = buildCrashReport({ ...ZH, hash: '', error: new Error('x') });
    expect(report.details).toContain('视图：(无 hash)');
  });

  it('非 Error 抛出物也能出报告（且不含"栈"段）', () => {
    const report = buildCrashReport({ ...ZH, error: { weird: true } });
    expect(report.details).toContain('消息：{"weird":true}');
    expect(report.details).not.toContain('栈（前几帧）');
  });

  it('userAgent 缺失（Node / 精简环境）时不写那一行', () => {
    const report = buildCrashReport({ ...ZH, error: new Error('x'), userAgent: '' });
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
describe('buildRuntimeErrorNotice：措辞不能误导', () => {
  it('标题说"有一处代码出错了"，**不冒充**"你这个视图坏了"（它可能发生在别处）', () => {
    const notice = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('x') });
    expect(notice.title).toBe('界面里有一处代码出错了');
    expect(notice.title).not.toContain('画布');
  });

  it('说明里必须给"怎么办"（刷新）与"数据没事"（成片/任务在服务端）', () => {
    const notice = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('x') });
    expect(notice.summary).toContain('刷新一次');
    expect(notice.summary).toContain('服务端');
  });

  it('必须如实写明**只在本机提示、没有上报**（用户选的是 D52 的"只本地提示"）', () => {
    const notice = buildRuntimeErrorNotice({ ...ZH, source: 'rejection', error: new Error('x') });
    expect(notice.summary).toContain('只出现在这台机器上');
    expect(notice.details).toContain('没有上报到服务器');
  });

  it('两类来源在报告里可区分（报障时"是不是 Promise 没接住"是个关键线索）', () => {
    const script = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('x') });
    const rejection = buildRuntimeErrorNotice({ ...ZH, source: 'rejection', error: new Error('x') });
    expect(script.details).toContain('脚本错误');
    expect(rejection.details).toContain('未处理的 Promise 拒绝');
  });

  it('报告含来源 / 视图 / 时间 / 消息（与崩溃面板同一套报障要素）', () => {
    const notice = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('boom'), userAgent: 'UA/1.0' });
    expect(notice.details).toContain('视图：#/canvas');
    expect(notice.details).toContain('时间：');
    expect(notice.details).toContain('消息：boom');
    expect(notice.details).toContain('浏览器：UA/1.0');
  });

  it('hash 为空写 "(无 hash)"；非 Error 抛出物（Promise 拒绝一个对象）也能出报告且无栈段', () => {
    const notice = buildRuntimeErrorNotice({ ...ZH, source: 'rejection', error: { code: 502 }, hash: '' });
    expect(notice.details).toContain('视图：(无 hash)');
    expect(notice.details).toContain('消息：{"code":502}');
    expect(notice.details).not.toContain('栈（前几帧）');
  });

  it('签名 = 去重的前提：**同一条错误重复抛 → 同签名**（否则提示条会被刷屏）', () => {
    const first = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('loop') });
    const second = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('loop') });
    expect(first.signature).toBe(second.signature);
  });

  it('但来源不同、消息不同 → 签名不同（该各提示一次）', () => {
    const script = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('same') });
    const rejection = buildRuntimeErrorNotice({ ...ZH, source: 'rejection', error: new Error('same') });
    const other = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('another') });

    expect(script.signature).not.toBe(rejection.signature);
    expect(script.signature).not.toBe(other.signature);
  });

  it('**签名不含栈**：同消息在不同位置抛出也合成一条（循环里抛 200 次不能弹 200 条）', () => {
    const here = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('循环里的错误') });
    const elsewhere = new Error('循环里的错误');
    elsewhere.stack = 'Error: 循环里的错误\n    at tick (app.js:1:1)';
    const moved = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: elsewhere });

    expect(moved.signature).toBe(here.signature);
    // 代价如实登记：少弹的那几条只在"另有 N 次同类"里留一个数字
    expect(moved.details).toContain('at tick (app.js:1:1)');
  });

  it('签名也**不含语言**（切成英文后同一条错误不该再弹一次）', () => {
    const zh = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('same') });
    const en = buildRuntimeErrorNotice({ ...EN, source: 'script', error: new Error('same') });
    expect(en.signature).toBe(zh.signature);
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
      ...ZH,
      source: 'script',
      error: new Error('ResizeObserver loop completed with undelivered notifications.'),
    });
    const real = buildRuntimeErrorNotice({ ...ZH, source: 'script', error: new Error('真错误') });
    expect(noisy.benign).toBe(true);
    expect(real.benign).toBe(false);
  });
});

/**
 * 语言迁移第七批新增：**英文这一侧**。
 *
 * 为什么不能只靠"字典里有键"就收工：键存在 ≠ 那三句承诺在英文里说全了。
 * 这里用**同一批断言的三条核心**（怎么说错在哪 / 怎么办 / 只在本机）+ 一条
 * **零中文**的机械检查 —— 后者防的是最难看的一种回归：英文界面里夹着半句中文。
 */
describe('英文（V8.51）：三句承诺必须说全，且整段零中文', () => {
  it('崩溃面板：标题 / "其余界面可用" / "不是你的数据坏了"', () => {
    const report = buildCrashReport({ ...EN, error: new Error('boom'), userAgent: 'UA/1.0' });
    expect(report.title).toBe('Canvas failed to render');
    expect(report.summary).toContain('rest of the app still works');
    expect(report.summary).toContain('does not mean your data is broken');
  });

  it('崩溃面板：详情四行字段名都译了（中英混拼的报障文本最难读）', () => {
    const report = buildCrashReport({ ...EN, hash: '', error: new Error('boom') });
    expect(report.details).toContain('Where: Canvas');
    expect(report.details).toContain('View: (no hash)');
    expect(report.details).toContain('When: ');
    expect(report.details).toContain('Message: boom');
    expect(report.details).not.toMatch(CJK);
  });

  it('运行期通知：刷新 / 服务端 / 只在本机（D52 的三句，一句都不许少）', () => {
    const notice = buildRuntimeErrorNotice({ ...EN, source: 'rejection', error: new Error('boom') });
    expect(notice.summary).toContain('refreshing the page');
    expect(notice.summary).toContain('on the server');
    expect(notice.summary).toContain('only appears on this machine');
    expect(notice.details).toContain('Unhandled promise rejection');
    expect(notice.details).toContain('nothing is reported');
    expect(notice.details).not.toMatch(CJK);
    expect(notice.title).not.toMatch(CJK);
    // 标题**不许指认**某个视图（"你的这块坏了"是撒谎）—— 英文里同样只用泛指
    expect(notice.title).not.toContain('Canvas');
  });
});

/**
 * 缺省行为：调用方**不传** `language` 时，取的是**当前语言**。
 *
 * 这条是"注入"的另一半 —— 只测"传了 language 会生效"会漏掉真正发生在运行时的路径
 * （`ErrorBoundary` / `runtimeErrorNotice` 都不传 language）。
 * 它动的是运行期缓存，所以**自己改自己还原**（`finally`），不留给后面的用例。
 */
describe('缺省取当前语言（运行时的真实路径）', () => {
  it('不传 language → 跟随 setLanguage 的结果', () => {
    const saved = getLanguage();
    try {
      setLanguage('en');
      expect(buildCrashReport({ label: 'Canvas', hash: '#/canvas', error: new Error('x') }).title).toBe(
        'Canvas failed to render',
      );
      expect(buildRuntimeErrorNotice({ source: 'script', error: new Error('x'), hash: '' }).title).toBe(
        'A piece of the interface hit an error',
      );
    } finally {
      setLanguage(saved);
    }
  });
});
