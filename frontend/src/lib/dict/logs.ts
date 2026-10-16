/**
 * **操作日志域**的文案（语言迁移第十四批：`views/LogsView.tsx`）。
 *
 * ## 两条与"危险动作"绑在一起的措辞（别改弱）
 * 1. **清空是不可撤销的**：确认文案里必须留着"**此操作不可撤销**"；
 * 2. **清空的作用域必须说清**：有筛选时清的是"**当前筛选条件下的**"，没筛选才是全部 ——
 *    这条口径写在 `handleClear` 的注释里（"避免'以为只清了一批、其实全没了'"），
 *    所以两句话分开成两个键，由代码按是否有筛选来选。
 *
 * ## 一处如实登记
 * 行内的**动作名**（`logActionLabel(entry.action)`）来自 `@astrmira/shared` 的文案表 ——
 * 与配方分类名、剪辑操作名同属"共享包里的域词汇"，**该不该给共享包加一套键是跨包决策**，
 * 与 `dict/library.ts` 文件头登记的是同一件事，留给剪辑台批次一并定。
 */

export const LOGS_ZH = {
  'logs.title': '操作日志',
  'logs.range.aria': '时间范围',
  'logs.range.hour1': '最近 1 小时',
  'logs.range.hour24': '最近 24 小时',
  'logs.range.day7': '最近 7 天',
  'logs.range.all': '全部',

  'logs.records.label': '记录',
  'logs.records.summary':
    '共 {total} 条 · 只记写操作与失败请求（`/media`、`/api/health`、日志页自身不记，避免自我污染）',
  'logs.autoRefresh': '自动刷新 3s',
  'logs.refresh': '刷新',
  'logs.clear': '清空',
  'logs.export': '导出 JSON',

  'logs.filter.action': '动作',
  'logs.filter.allActions': '全部动作',
  'logs.filter.ip': '来源 IP',
  'logs.filter.ipPlaceholder': '精确匹配',
  'logs.filter.errorCode': '错误码',
  'logs.filter.errorCodePlaceholder': '如 UPSTREAM_ERROR',
  'logs.filter.keyword': '关键词',
  'logs.filter.keywordPlaceholder': 'requestId / 路径 / 请求体 / 上游 Request id',

  'logs.empty': '没有匹配的记录。换个时间范围或清掉筛选试试。',
  'logs.pager.prev': '上一页',
  'logs.pager.page': '第 {page} / {max} 页',
  'logs.pager.next': '下一页',
  'logs.row.delete': '删除',
  'logs.detail.requestBody': '请求体',
  'logs.detail.diagnostics': '诊断字段',

  // ── 清空（危险动作：作用域 + 不可撤销，两句都不能含糊）──
  'logs.clear.scopeFiltered': '当前筛选条件下的',
  'logs.clear.scopeAll': '全部',
  'logs.clear.confirm': '确定要清空{scope}操作日志吗？此操作不可撤销。',
  'logs.clear.none': '没有匹配的日志可清空',
};

export const LOGS_EN = {
  'logs.title': 'Activity log',
  'logs.range.aria': 'Time range',
  'logs.range.hour1': 'Last hour',
  'logs.range.hour24': 'Last 24 hours',
  'logs.range.day7': 'Last 7 days',
  'logs.range.all': 'All',

  'logs.records.label': 'Records',
  'logs.records.summary':
    '{total} total · only write operations and failed requests are logged (`/media`, `/api/health` and the log page itself are excluded, so it does not pollute itself)',
  'logs.autoRefresh': 'Auto-refresh 3s',
  'logs.refresh': 'Refresh',
  'logs.clear': 'Clear',
  'logs.export': 'Export JSON',

  'logs.filter.action': 'Action',
  'logs.filter.allActions': 'All actions',
  'logs.filter.ip': 'Source IP',
  'logs.filter.ipPlaceholder': 'Exact match',
  'logs.filter.errorCode': 'Error code',
  'logs.filter.errorCodePlaceholder': 'e.g. UPSTREAM_ERROR',
  'logs.filter.keyword': 'Keyword',
  'logs.filter.keywordPlaceholder': 'requestId / path / request body / upstream Request id',

  'logs.empty': 'No matching records. Try another time range or clear the filters.',
  'logs.pager.prev': 'Previous',
  'logs.pager.page': 'Page {page} / {max}',
  'logs.pager.next': 'Next',
  'logs.row.delete': 'Delete',
  'logs.detail.requestBody': 'Request body',
  'logs.detail.diagnostics': 'Diagnostics',

  'logs.clear.scopeFiltered': 'the currently filtered',
  'logs.clear.scopeAll': 'all',
  'logs.clear.confirm': 'Clear {scope} activity logs? This cannot be undone.',
  'logs.clear.none': 'No matching logs to clear',
};
