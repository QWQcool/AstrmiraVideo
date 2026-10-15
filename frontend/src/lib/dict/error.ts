/**
 * **兜底层**（B61：视图级 + window 级两层）的文案。
 *
 * ## 口径只有一条，但很硬
 * 这两层对用户的承诺是**同一件事**：*"这是前端的问题，你的数据没事，而且这条提示只在你本机。"*
 * 中英两边都必须把这三句说全 —— 少任何一句，用户就会开始怀疑自己的成片是不是丢了
 * （而那恰恰是这条提示最不该引起的事）。
 *
 * ## 本文件目前只有 `ErrorBoundary` 自己的三个词
 * 崩溃面板与运行期通知的**正文**（标题 / 摘要 / 技术细节）在 `lib/errorReport.ts` 里拼装，
 * 那部分随它的批次一起迁（那里还有一份 29 例的单测在盯着措辞）。
 */

export const ERROR_ZH = {
  'error.boundary.retry': '重试渲染',
  'error.boundary.backToCreate': '回到创作入口',
  'error.boundary.details': '技术细节（报障时复制这一段）',
};

export const ERROR_EN = {
  'error.boundary.retry': 'Try rendering again',
  'error.boundary.backToCreate': 'Back to Create',
  'error.boundary.details': 'Technical details (copy this when reporting)',
};
