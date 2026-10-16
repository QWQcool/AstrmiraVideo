/**
 * **成本台账域**的文案（语言迁移第十三批：`views/CostsView.tsx` + `lib/costView.ts`）。
 *
 * ## 这一页的文案有契约撑腰，别顺手"润色"
 * 成本页最容易犯的错是"只显示一个金额"（一个孤零零的 `¥128` 会被读成"就这么多了"）。
 * 所以**三个数字必须成组出现**：已结算 N 条 / 未结算 N 条（老任务，未计入金额）/
 * 结果不明 N 条（**可能已经花了钱**）—— 这是契约 §13 的要求，不是界面偏好。
 * 翻译时每一条都要保持"数字 + 它的口径"绑在一起。
 *
 * ## ⚠️ 未收敛的边界（如实登记）
 * 页脚的**免责声明**（`summary.disclaimer`）与每个桶的 `bucket.label` 都是
 * **服务端下发的文案**，界面**原样显示**（一处措辞一处维护；"以账单为准"那句话不允许被改弱）。
 * 它们是"内容"，跟随服务端语言策略 —— 本批不动，也不该在前端复制一份
 * （复制就会出现"界面上两句话意思不一样"）。
 */

export const COSTS_ZH = {
  'costs.title': '成本台账',
  'costs.refresh.loading': '读取中…',
  'costs.refresh.label': '刷新',
  'costs.scope.aria': '统计范围',
  'costs.scope.project': '当前项目',
  'costs.scope.projectNamed': '当前项目 · {name}',
  'costs.scope.allProjects': '全部项目',
  'costs.range.aria': '时间区间',
  'costs.load.error': '读取失败',

  // ── 四张卡（口径必须跟着数字走）──
  'costs.kpi.estimate': '预估花费',
  'costs.kpi.tasks': '区间内任务',
  'costs.kpi.tasksFoot': '成功任务（含未结算）',
  'costs.kpi.unsettled': '未结算',
  'costs.kpi.unsettledFootNone': '全部任务都有成本记录',
  'costs.kpi.unsettledFootSome': 'V2.12 之前的老任务',
  'costs.kpi.uncertain': '结果不明',
  'costs.kpi.uncertainFoot': '可能已产生费用（不在金额里）',
  'costs.kpi.unit': '条',

  // ── 区间档位（`lib/costView.ts` 的键表）──
  'costs.range.today': '今日',
  'costs.range.last7d': '近 7 天',
  'costs.range.last30d': '近 30 天',
  'costs.range.all': '全部',

  // ── 头部与桶的明细（`lib/costView.ts` 拼装）──
  // 分隔符 `' · '` 是**语言无关**的（空格 + 中点 + 空格），所以留在代码里、不进字典。
  'costs.headline.priced': '已结算 {count} 条',
  'costs.headline.unsettled': '未结算 {count} 条',
  'costs.headline.truncated': '⚠️ 已截断（仅部分之和）',
  'costs.headline.unsettledNote':
    '另有 {count} 条成功任务没有成本记录（V2.12 之前的老任务），未计入上方金额。',
  'costs.headline.uncertainNote':
    '⚠️ {count} 条任务结果不明（已提交未确认）——**可能已经产生费用**，但它不在上方金额里。',
  'costs.bucket.line': '{amount} · {count} 条',
  'costs.bucket.unsettled': '含 {count} 条未结算',
  'costs.bucket.empty': '区间内没有成功任务。',

  // ── 预算 ──
  'costs.budget.title': '月度预算',
  'costs.budget.text': '本月已用 {used} / 预算 {budget}（{percent}%）',
  'costs.budget.over': '本月预估已超出预算（按公开价目估算，实际以方舟账单为准）。',

  // ── 三个桶 ──
  'costs.byProject.title': '按项目',
  'costs.byProject.note': '金额为预估（公开价目 × 上游计费式）',
  'costs.byDay.title': '按天',
  'costs.byDay.note': '服务端本地时区',
  'costs.byModel.title': '按模型档位',
  'costs.byModel.note': '自定义接入点按 2.0 标准口径估算',
};

export const COSTS_EN = {
  'costs.title': 'Cost ledger',
  'costs.refresh.loading': 'Loading…',
  'costs.refresh.label': 'Refresh',
  'costs.scope.aria': 'Scope',
  'costs.scope.project': 'Current project',
  'costs.scope.projectNamed': 'Current project · {name}',
  'costs.scope.allProjects': 'All projects',
  'costs.range.aria': 'Time range',
  'costs.load.error': 'Could not load',

  'costs.kpi.estimate': 'Estimated spend',
  'costs.kpi.tasks': 'Tasks in range',
  'costs.kpi.tasksFoot': 'Succeeded tasks (including unpriced)',
  'costs.kpi.unsettled': 'Unpriced',
  'costs.kpi.unsettledFootNone': 'Every task has a cost record',
  'costs.kpi.unsettledFootSome': 'Tasks from before V2.12',
  'costs.kpi.uncertain': 'Unknown result',
  'costs.kpi.uncertainFoot': 'May already have cost money (not included above)',
  'costs.kpi.unit': 'items',

  'costs.range.today': 'Today',
  'costs.range.last7d': 'Last 7 days',
  'costs.range.last30d': 'Last 30 days',
  'costs.range.all': 'All',

  'costs.headline.priced': '{count} priced',
  'costs.headline.unsettled': '{count} unpriced',
  'costs.headline.truncated': '⚠️ truncated (partial sum only)',
  'costs.headline.unsettledNote':
    '{count} more succeeded tasks have no cost record (tasks from before V2.12) and are not included in the amount above.',
  'costs.headline.uncertainNote':
    '⚠️ {count} tasks have an unknown result (submitted but unconfirmed) — **they may already have cost money**, and they are not in the amount above.',
  'costs.bucket.line': '{amount} · {count} items',
  'costs.bucket.unsettled': '{count} unpriced included',
  'costs.bucket.empty': 'No succeeded tasks in this range.',

  'costs.budget.title': 'Monthly budget',
  'costs.budget.text': 'Used this month {used} / budget {budget} ({percent}%)',
  'costs.budget.over':
    'This month is over budget (estimated from public pricing; the Ark bill is authoritative).',

  'costs.byProject.title': 'By project',
  'costs.byProject.note': 'Amounts are estimates (public pricing × upstream billing formula)',
  'costs.byDay.title': 'By day',
  'costs.byDay.note': "The service host's local time zone",
  'costs.byModel.title': 'By model tier',
  'costs.byModel.note': 'Custom endpoints are estimated at the 2.0 standard rate',
};
