/**
 * 运行观测页（V2.90 / D-8）的文案。
 *
 * 与 `costs` 域分开：成本回答"花了多少钱"，观测回答"跑得多快、失败在哪些码上"。
 * 两页读的是同一批任务记录，但口径不同 —— 混在一份字典里最容易把话说混。
 */
export const STATS_ZH = {
  'stats.title': '运行观测',
  'stats.subtitle': '数据只来自已有任务记录（不新建埋点表）。耗时是近似的，口径见下方说明。',
  'stats.refresh': '刷新',
  'stats.refreshLoading': '读取中…',
  'stats.error': '读取观测数据失败：{reason}',
  'stats.errorTitle': '读取观测数据失败',
  'stats.empty': '还没有任务记录 —— 跑过一两条之后这里才会有数字。',
  'stats.truncated': '样本已截断：只统计了最近的 {count} 条任务（更早的未计入）。',
  'stats.providers.title': '按引擎',
  'stats.col.provider': '引擎',
  'stats.col.count': '任务',
  'stats.col.success': '成功',
  'stats.col.fail': '失败/取消',
  'stats.col.unfinished': '进行中',
  'stats.col.p50': 'p50 耗时',
  'stats.col.p95': 'p95 耗时',
  'stats.none': '—',
  'stats.codes.title': '失败码分布',
  'stats.codes.empty': '这段时间没有失败任务。',
  'stats.links.title': 'ComfyUI 进度通道',
  'stats.links.none': '本部署还没有建立进度通道（未配置本地实例，或还没跑过本地任务）。没有连接就不显示"已连接"。',
  'stats.links.state.connecting': '连接中',
  'stats.links.state.connected': '已连接',
  'stats.links.state.closed': '已断开',
  'stats.links.opens': '建连 {count} 次',
  'stats.links.reconnects': '重连 {count} 次',
  'stats.cost.title': '成本口径',
  'stats.cost.body':
    '本地轨（ComfyUI）的成本是 0，这是真实值而不是缺数据：算力是自建的，没有按次计费；' +
    '这里也不把电费/折旧折算成金额（那会变成编造的数字）。云端轨的金额见成本台账。',
  'stats.cost.link': '打开成本台账',
} as const;

export const STATS_EN: Record<keyof typeof STATS_ZH, string> = {
  'stats.title': 'Run observability',
  'stats.subtitle': 'Data comes only from existing task records (no new telemetry table). Durations are approximate; see the note below.',
  'stats.refresh': 'Refresh',
  'stats.refreshLoading': 'Loading...',
  'stats.error': 'Could not load observability data: {reason}',
  'stats.errorTitle': 'Could not load observability data',
  'stats.empty': 'No task records yet - numbers appear after a run or two.',
  'stats.truncated': 'Sample truncated: only the latest {count} tasks were summarized (older ones are not counted).',
  'stats.providers.title': 'By engine',
  'stats.col.provider': 'Engine',
  'stats.col.count': 'Tasks',
  'stats.col.success': 'OK',
  'stats.col.fail': 'Failed/cancelled',
  'stats.col.unfinished': 'In flight',
  'stats.col.p50': 'p50',
  'stats.col.p95': 'p95',
  'stats.none': '-',
  'stats.codes.title': 'Failure codes',
  'stats.codes.empty': 'No failed tasks in this range.',
  'stats.links.title': 'ComfyUI progress links',
  'stats.links.none': 'This deployment has no progress link yet (no local instance configured, or no local task has run). We never show "connected" without a connection.',
  'stats.links.state.connecting': 'Connecting',
  'stats.links.state.connected': 'Connected',
  'stats.links.state.closed': 'Closed',
  'stats.links.opens': '{count} opens',
  'stats.links.reconnects': '{count} reconnects',
  'stats.cost.title': 'Cost basis',
  'stats.cost.body':
    'The local track (ComfyUI) costs 0 and that is a real value, not missing data: the compute is self-hosted with no per-run billing; ' +
    'electricity and depreciation are deliberately not converted into money here (that would be an invented number). Cloud spend lives in the cost ledger.',
  'stats.cost.link': 'Open cost ledger',
};
