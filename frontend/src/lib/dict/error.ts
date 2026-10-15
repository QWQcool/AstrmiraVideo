/**
 * **兜底层**（B61：视图级 + window 级两层）的文案。
 *
 * ## 口径只有一条，但很硬
 * 这两层对用户的承诺是**同一件事**：*"这是前端的问题，你的数据没事，而且这条提示只在你本机。"*
 * 中英两边都必须把这三句说全 —— 少任何一句，用户就会开始怀疑自己的成片是不是丢了
 * （而那恰恰是这条提示最不该引起的事）。
 *
 * ## 这里是两层各自的壳 + `lib/errorReport.ts` 拼的**正文**
 * - 壳：`ErrorBoundary` 的三个按钮词（`error.boundary.*`）；
 * - 正文（语言迁移第七批迁入）：崩溃面板与运行期通知的标题 / 摘要 / 技术细节（`error.report.*` /
 *   `error.runtime.*`）—— 它们在 `lib/errorReport.ts` 里拼装，那里还有一份 **29 例单测**
 *   在逐句盯措辞（迁移**不改文案**，所以那些断言的中文一字未动）。
 *
 * ## 为什么"详情行"的字段名也要译（而不是只译标题）
 * `details` 是让用户**复制给运维**的一段纯文本，它会出现在崩溃面板的 `<pre>` 里 ——
 * 用户看得见。切到英文时若字段名还是"位置：/视图：/消息："，那一段就成了
 * 半中半英的拼接物（比整段中文更难读）。**代价如实登记**：报障文本会跟着界面语言走，
 * 于是"英文界面下的报告"需要看得懂英文的人来读 —— 这是选了双语界面就必须接受的。
 */

export const ERROR_ZH = {
  // ── 视图级兜底面板的按钮（`ErrorBoundary`）──
  'error.boundary.retry': '重试渲染',
  'error.boundary.backToCreate': '回到创作入口',
  'error.boundary.details': '技术细节（报障时复制这一段）',

  // ── 崩溃面板正文（`buildCrashReport`）──
  // `{label}` 是掉进去的那个区域的**人话名**（"画布" / "工作台" / "界面"），
  // 由调用方从 `shell.region.*` 取（`App.tsx` / `main.tsx`），不是写死的字符串。
  'error.report.title': '{label}出错了',
  'error.report.summary':
    '这一块没有渲染出来，其余界面仍可用（左侧导航可以切到别的视图）。' +
    '这是前端兜底层，不代表你的数据出了问题 —— 已完成的成片与任务记录都不受影响。',
  'error.report.noHash': '(无 hash)',

  // ── 报障详情的四行字段名 + 两行可选（栈 / 浏览器）──
  // 它们的读者是"拿到这段文本的运维"，字段名必须能独立看懂（`位置：画布` 比 `画布` 有用得多）。
  'error.report.line.location': '位置：{label}',
  'error.report.line.hash': '视图：{hash}',
  'error.report.line.at': '时间：{at}',
  'error.report.line.message': '消息：{message}',
  'error.report.line.stack': '栈（前几帧）：',
  'error.report.line.userAgent': '浏览器：{ua}',

  // ── 抛出物不是人话时，至少要说明"它是什么形态" ──
  'error.report.emptyString': '(空的字符串)',
  'error.report.stackTruncated': '…（共 {total} 行，已截断）',

  // ── 运行期通知（`buildRuntimeErrorNotice`；`window` 层）──
  // 标题**刻意不指认**某个视图：这条错误可能发生在用户没在看的地方（见 `errorReport.ts` 注释），
  // 说"你的画布坏了"是**撒谎**（用户切走就没事了，而他并不知道）。
  'error.runtime.title': '界面里有一处代码出错了',
  'error.runtime.summary':
    '出错的不一定是你正在看的地方 —— 如果你发现某个按钮或某块内容不动了，刷新一次页面通常就好。' +
    '你的成片与任务记录都在服务端，不受影响。' +
    '这条提示只出现在这台机器上（没有上报）。',
  'error.runtime.source.script': '脚本错误（未被捕获）',
  'error.runtime.source.rejection': '未处理的 Promise 拒绝',
  'error.runtime.line.source': '来源：{source}',
  /**
   * 这一行是 D52（**只本地提示、不上报**）在界面上的**唯一证据** ——
   * 用户看到"出错"两个字时最该问的就是"你把它发哪去了"，所以它必须每次都在。
   */
  'error.runtime.localOnly': '（本提示只出现在本机，没有上报到服务器）',
};

export const ERROR_EN = {
  'error.boundary.retry': 'Try rendering again',
  'error.boundary.backToCreate': 'Back to Create',
  'error.boundary.details': 'Technical details (copy this when reporting)',

  'error.report.title': '{label} failed to render',
  'error.report.summary':
    'This section did not render; the rest of the app still works (use the left navigation to open ' +
    'another view). This is a frontend fallback — it does not mean your data is broken: finished ' +
    'videos and task records are unaffected.',
  'error.report.noHash': '(no hash)',

  'error.report.line.location': 'Where: {label}',
  'error.report.line.hash': 'View: {hash}',
  'error.report.line.at': 'When: {at}',
  'error.report.line.message': 'Message: {message}',
  'error.report.line.stack': 'Stack (first frames):',
  'error.report.line.userAgent': 'Browser: {ua}',

  'error.report.emptyString': '(empty string)',
  'error.report.stackTruncated': '… ({total} lines total, truncated)',

  'error.runtime.title': 'A piece of the interface hit an error',
  'error.runtime.summary':
    'It may not be the part you are looking at — if a button or a section stopped responding, ' +
    'refreshing the page usually fixes it. Your finished videos and task records are on the server ' +
    'and are unaffected. ' +
    'This notice only appears on this machine (nothing is reported).',
  'error.runtime.source.script': 'Script error (uncaught)',
  'error.runtime.source.rejection': 'Unhandled promise rejection',
  'error.runtime.line.source': 'Source: {source}',
  'error.runtime.localOnly': '(This notice appears only on this machine; nothing is reported)',
};
