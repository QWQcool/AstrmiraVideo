/**
 * **视频库域**的文案（语言迁移第十二批：`views/LibraryView.tsx` + `lib/libraryFilter.ts`）。
 *
 * ## 这一批顺带收敛了三处"执行位置"的显示名（台账 B11 / V2.27）
 * `executedBy` 的短标签与完整说法原先来自 `@astrmira/shared` 的 `EXECUTED_BY_LABELS` /
 * `EXECUTED_BY_TITLES`，被**三处前端**使用（画布节点卡 / 工作台画廊卡 / 视频库）——
 * 那正是"多处各写一遍必然漂移"的形态，只不过这次的漂移面是**共享包与界面语言之间**：
 * 共享包里是中文常量，英文界面只能显示中文。
 * 现在前端统一走 `common.executedBy.*`（键表在 `lib/format.ts`），
 * 共享包那两个常量**保留**（后端将来仍可用），并由 `lib/format.test.ts` 里一条
 * **逐字比对**的断言钉住"两份中文不许悄悄漂移"。
 *
 * ## ⚠️ 未收敛的边界（如实登记，不是漏做）
 * 视频库还显示几处**来自 `@astrmira/shared` 的中文**，本批**没动**它们：
 * `PLATFORM_PRESETS` 的 `label` / `note` / `basis`（交付面板的规格说明）、
 * `EDIT_OPERATION_LABELS`（剪辑操作名）、`describeEditOrigin()`（剪辑来源的整句话）。
 * 判断依据是本仓既有口径（**内容不进字典**：配方名 / 模板名 / 引擎显示名同一类），
 * 但它们与"内容"又不完全同类 —— **该不该给共享包加一套键**是个**跨包决策**
 * （要动 `packages/shared` 的 API），所以留给**剪辑台批次**一并决定（那批必然碰到
 * `describeEditOrigin` 与 `EDIT_OPERATION_LABELS`）。**别在某一批里单方面改一半。**
 */

export const LIBRARY_ZH = {
  // ── 页头 / 工具条 ──
  'library.title': '视频库',
  'library.refresh.loading': '读取中…',
  'library.refresh.label': '刷新',
  'library.load.error': '读取失败',
  'library.load.retry': '重试',
  'library.tabs.aria': '资产分类',
  'library.tabs.history': '生成历史',
  'library.tabs.canvas': '画布',
  'library.kindFilter.aria': '按媒体类型筛选',
  'library.kind.all': '全部',
  'library.canvas.search': '搜索画布名称',
  'library.canvas.count': '{count} 块画布',
  'library.canvas.empty': '还没有画布。到画布页新建一块吧。',
  'library.canvas.emptyFiltered': '没有匹配的画布：换个关键词。',
  'library.canvas.openAria': '打开画布 {name}',
  'library.canvas.noCover': '暂无封面',
  'library.canvas.badge': '画布',
  'library.canvas.nodes': '{count} 个节点',
  'library.canvas.open': '打开画布',
  'library.canvas.detail': '画布',
  'library.canvas.updatedAt': '更新时间',
  'library.canvas.nodeCount': '节点数',
  'library.canvas.products': '产物',
  'library.canvas.loading': '正在读取画布产物…',
  'library.canvas.noProducts': '这块画布还没有产物。',
  'library.search.placeholder': '搜索提示词…',
  'library.search.aria': '搜索提示词',
  'library.statusFilter.aria': '按状态筛选',
  'library.sort.label': '排序',
  'library.sort.aria': '排序方式',
  'library.count': '{shown} / {total} 条',
  'library.totalSize': ' · 共 {size}',

  // ── 筛选与排序的取值（`lib/libraryFilter.ts` 的键表）──
  'library.sort.timeDesc': '按时间（新→旧）',
  'library.sort.timeAsc': '按时间（旧→新）',
  'library.sort.sizeDesc': '按文件大小（大→小）',
  'library.statusFilter.all': '全部',
  'library.statusFilter.succeeded': '成功',
  'library.statusFilter.failed': '失败',
  'library.statusFilter.active': '进行中',

  // ── 交付包（V2.13 / B49）──
  // ── 删除 ──
  'library.delete.done': '已删除该成片并释放磁盘。',
  'library.delete.failed': '删除失败：{reason}',

  // ── 网格与卡片 ──
  'library.empty.filtered': '没有匹配的成片：换个关键词，或把筛选切回「全部」。',
  'library.empty.none': '还没有成片。到 生成工作台 提交第一条任务吧。',
  'library.card.detailAria': '查看 {id} 的详情',
  'library.card.noCover': '无封面',
  'library.card.editOriginTitle': '剪辑自 {id}',
  'library.card.editOrigin': '剪辑自 {id}',
  'library.card.editTitle': '剪辑',
  'library.card.editDisabledTitle': '失败任务不可剪辑',
  'library.card.editNoVideo': '图片产物不能进剪辑台',
  'library.card.reuseTitle': '复用参数',
  'library.card.downloadTitle': '下载',
  'library.card.deleteTitle': '删除（释放磁盘）',
  'library.card.imported': '外部导入',
  'library.card.importedTitle': '从资产库导入，不是本服务生成',
  'library.import.open': '导入资产',
  'library.import.title': '从资产库导入历史',
  'library.import.hint': '图片/视频会标记为“外部导入”；不生成媒体，也不计入模型成本。',
  'library.import.loading': '正在读取资产库…',
  'library.import.empty': '资产库暂无可导入的图片或视频。',
  'library.import.meta': '{kind} · {size}',
  'library.import.action': '导入到历史',
  'library.import.done': '已导入 {count} 条外部历史',
  'library.import.failed': '导入失败：{reason}',

  // ── 详情抽屉 ──
  'library.drawer.closeAria': '关闭详情',
  'library.drawer.noPlayable': '{status}：没有可播放的成片',
  // V2.40：图片产物（`t2i`）—— 抽屉里显示图片而不是播放器
  'library.drawer.imageAlt': '本次生成的图片产物',
  'library.drawer.kv.prompt': '提示词',
  'library.drawer.kv.mode': '模式',
  'library.drawer.kv.engine': '引擎',
  'library.drawer.kv.model': '模型',
  'library.drawer.kv.createdAt': '创建时间',
  'library.drawer.kv.size': '文件大小',
  'library.drawer.kv.sizeMissing': '—（文件已清理或未产出）',
  'library.drawer.kv.dimension': '实际尺寸',
  'library.drawer.kv.dimensionMissing': '—（未探测到；老任务或文件已清理）',
  'library.drawer.kv.dimensionPlanned': '（计划 {width}×{height}）',
  'library.drawer.kv.status': '状态',
  'library.drawer.edlTitle': '剪辑来源',
  // `{origin}` 是 `describeEditOrigin()` 的返回值（共享包的中文，见文件头的"未收敛边界"）
  'library.drawer.edlOrigin': '剪辑自 {id} —— {origin}',
  'library.drawer.projectProduct': '多轨工程产物（工程随任务落库；点 ✂ 可载入继续编辑）。',
  'library.drawer.noEditRecord': '这条还没有剪辑记录（在视频库里点它的 ✂ 就能开始剪）。',
  'library.drawer.action.reuse': '复用参数',
  'library.drawer.action.edit': '✂ 剪辑',
  'library.drawer.action.download': '下载',
  'library.drawer.action.delete': '删除',

};

export const LIBRARY_EN = {
  'library.title': 'Library',
  'library.refresh.loading': 'Loading…',
  'library.refresh.label': 'Refresh',
  'library.load.error': 'Could not load',
  'library.load.retry': 'Retry',
  'library.tabs.aria': 'Asset categories',
  'library.tabs.history': 'Generation history',
  'library.tabs.canvas': 'Canvases',
  'library.kindFilter.aria': 'Filter by media type',
  'library.kind.all': 'All',
  'library.canvas.search': 'Search canvas names',
  'library.canvas.count': '{count} canvases',
  'library.canvas.empty': 'No canvases yet. Create one on the canvas page.',
  'library.canvas.emptyFiltered': 'No matching canvases: try another keyword.',
  'library.canvas.openAria': 'Open canvas {name}',
  'library.canvas.noCover': 'No cover',
  'library.canvas.badge': 'Canvas',
  'library.canvas.nodes': '{count} nodes',
  'library.canvas.open': 'Open canvas',
  'library.canvas.detail': 'Canvas',
  'library.canvas.updatedAt': 'Updated',
  'library.canvas.nodeCount': 'Nodes',
  'library.canvas.products': 'Products',
  'library.canvas.loading': 'Loading canvas products…',
  'library.canvas.noProducts': 'This canvas has no products yet.',
  'library.search.placeholder': 'Search prompts…',
  'library.search.aria': 'Search prompts',
  'library.statusFilter.aria': 'Filter by status',
  'library.sort.label': 'Sort',
  'library.sort.aria': 'Sort order',
  'library.count': '{shown} / {total} items',
  'library.totalSize': ' · {size} total',

  'library.sort.timeDesc': 'Newest first',
  'library.sort.timeAsc': 'Oldest first',
  'library.sort.sizeDesc': 'Largest file first',
  'library.statusFilter.all': 'All',
  'library.statusFilter.succeeded': 'Succeeded',
  'library.statusFilter.failed': 'Failed',
  'library.statusFilter.active': 'In progress',


  'library.delete.done': 'Deleted this clip and freed the disk space.',
  'library.delete.failed': 'Delete failed: {reason}',

  'library.empty.filtered': 'No matching clips: try another keyword, or switch the filter back to 「All」.',
  'library.empty.none': 'No clips yet. Submit your first task in the generation workbench.',
  'library.card.detailAria': 'View details of {id}',
  'library.card.noCover': 'No cover',
  'library.card.editOriginTitle': 'Edited from {id}',
  'library.card.editOrigin': 'Edited from {id}',
  'library.card.editTitle': 'Edit',
  'library.card.editDisabledTitle': 'Failed tasks cannot be edited',
  'library.card.editNoVideo': 'Image outputs cannot be opened in the video editor',
  'library.card.reuseTitle': 'Reuse parameters',
  'library.card.downloadTitle': 'Download',
  'library.card.deleteTitle': 'Delete (frees disk space)',
  'library.card.imported': 'Imported',
  'library.card.importedTitle': 'Imported from the asset library; not generated by this service',
  'library.import.open': 'Import assets',
  'library.import.title': 'Import assets into history',
  'library.import.hint': 'Images/videos are marked as imported; no media is generated and no model cost is added.',
  'library.import.loading': 'Reading the asset library…',
  'library.import.empty': 'No importable image or video assets.',
  'library.import.meta': '{kind} · {size}',
  'library.import.action': 'Import to history',
  'library.import.done': 'Imported {count} external history item(s)',
  'library.import.failed': 'Import failed: {reason}',

  'library.drawer.closeAria': 'Close details',
  'library.drawer.noPlayable': '{status}: no playable clip',
  'library.drawer.imageAlt': 'The generated still image',
  'library.drawer.kv.prompt': 'Prompt',
  'library.drawer.kv.mode': 'Mode',
  'library.drawer.kv.engine': 'Engine',
  'library.drawer.kv.model': 'Model',
  'library.drawer.kv.createdAt': 'Created',
  'library.drawer.kv.size': 'File size',
  'library.drawer.kv.sizeMissing': '— (file cleaned up or never produced)',
  'library.drawer.kv.dimension': 'Output size',
  'library.drawer.kv.dimensionMissing': '— (not probed; old task or file cleaned up)',
  'library.drawer.kv.dimensionPlanned': ' (planned {width}×{height})',
  'library.drawer.kv.status': 'Status',
  'library.drawer.edlTitle': 'Edit source',
  'library.drawer.edlOrigin': 'Edited from {id} — {origin}',
  'library.drawer.projectProduct':
    'Multi-track project output (the project is stored with the task; click ✂ to load and keep editing).',
  'library.drawer.noEditRecord': 'No edit record for this clip yet (click its ✂ in the library to start).',
  'library.drawer.action.reuse': 'Reuse parameters',
  'library.drawer.action.edit': '✂ Edit',
  'library.drawer.action.download': 'Download',
  'library.drawer.action.delete': 'Delete',

};
