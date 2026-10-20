/**
 * **总览域**的文案（语言迁移第十四批：`views/OverviewView.tsx`，V9 · B3）。
 *
 * ## 这一页的口径纪律（写在数据层，但文案必须配合它，别把口径说丢）
 * 四张卡的数字由 `lib/overviewStats.ts` 的纯函数算（那份单测在盯分母与除零）：
 * 成功率的**分母是"最近 50 条里的终态任务"**，不是"全部历史" —— 所以卡脚那句
 * "最近 50 条里的 N 条终态任务"**是口径本身**，不能简化成"成功率"三个字。
 * 没有终态任务时显示"还没有终态任务"（而不是 0%："还没有数据"与"全失败"是两回事）。
 *
 * ## 那句空态在别处还有一份（刻意不合并）
 * "还没有成片。到 生成工作台 提交第一条任务吧。" 在**视频库**是**纯文本**（一个键），
 * 在这里**中间夹着一个链接**（三段）。同一句话的两种渲染形态 ——
 * 强行合并会让其中一处要么丢链接、要么多出拼接碎片，所以**各写一份**。
 */

export const OVERVIEW_ZH = {
  'overview.title': '总览',
  'overview.refresh.loading': '读取中…',
  'overview.refresh.label': '刷新',
  'overview.load.error': '读取失败',

  // ── 四张卡 ──
  'overview.kpi.today': '今日生成',
  'overview.kpi.unit': '条',
  'overview.kpi.todayFoot': '今日 0:00 起（本地时区）',
  'overview.kpi.successRate': '成功率',
  'overview.kpi.successFootNone': '还没有终态任务',
  'overview.kpi.successFootSome': '最近 50 条里的 {count} 条终态任务',
  'overview.kpi.inFlight': '队列中',
  'overview.kpi.inFlightFoot': '等待或生成中',
  'overview.kpi.storage': '存储占用',
  'overview.kpi.storageFoot': '成片 {videos} 支 · 素材 {assets} 张',
  'overview.kpi.storageLink': '去清理 →',

  // ── 最近成片 ──
  'overview.shots.title': '最近成片',
  'overview.shots.all': '查看全部 →',
  // 中间夹着指向工作台的链接 → 拆三段（见文件头）
  'overview.shots.emptyBefore': '还没有成片。到 ',
  'overview.shots.emptyLink': '创作页',
  'overview.shots.emptyAfter': ' 提交第一条任务吧。',
  'overview.shots.noCover': '无封面',

  // ── 最近操作 ──
  'overview.feed.title': '最近操作',
  'overview.feed.all': '全部 →',
  'overview.feed.empty': '还没有操作记录（只记写操作与失败请求）。',
};

export const OVERVIEW_EN = {
  'overview.title': 'Overview',
  'overview.refresh.loading': 'Loading…',
  'overview.refresh.label': 'Refresh',
  'overview.load.error': 'Could not load',

  'overview.kpi.today': 'Generated today',
  'overview.kpi.unit': 'items',
  'overview.kpi.todayFoot': 'Since 00:00 today (local time zone)',
  'overview.kpi.successRate': 'Success rate',
  'overview.kpi.successFootNone': 'No settled tasks yet',
  'overview.kpi.successFootSome': '{count} settled tasks out of the latest 50',
  'overview.kpi.inFlight': 'In queue',
  'overview.kpi.inFlightFoot': 'Waiting or generating',
  'overview.kpi.storage': 'Storage used',
  'overview.kpi.storageFoot': '{videos} clips · {assets} assets',
  'overview.kpi.storageLink': 'Clean up →',

  'overview.shots.title': 'Recent clips',
  'overview.shots.all': 'See all →',
  'overview.shots.emptyBefore': 'No clips yet. Head to the ',
  'overview.shots.emptyLink': 'Create page',
  'overview.shots.emptyAfter': ' and submit your first task.',
  'overview.shots.noCover': 'No cover',

  'overview.feed.title': 'Recent activity',
  'overview.feed.all': 'All →',
  'overview.feed.empty': 'No activity yet (only write operations and failed requests are logged).',
};
