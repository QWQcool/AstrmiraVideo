/**
 * **外壳**（侧栏 / 顶栏 / 常驻视图区域 / 凭据提示）的文案字典。
 *
 * ## 键命名规范（后续各域照这个来）
 * `<域>.<子域>.<用途>`，段内 camelCase；**中文是基准语言** ——
 * 其余语言的键集合必须与它**完全一致**（`dict/index.ts` 用 `Record<MessageKey, string>`
 * 做**编译期**检查，比单测更早一步）。
 *
 * ## 为什么放在单独文件而不是一个巨大的字典里
 * 迁移是**分批**做的（外壳 → 创作 → 画布 → …），一个文件一个域，
 * 谁的界面在改就动谁的那一份 —— 避免"每加一条文案都要在 800 行文件里找位置"。
 *
 * ## 英文文案的三条口径
 * 1. **写英文，不是写中文的拼音**（`'视频库'` → `'Video Library'`，不是 `'Shipin Ku'`）；
 * 2. **专有名词不译**：`AstrmiraVideo` / `ComfyUI` / `Seedance` / `BYOK` 原样；
 * 3. **量词与语序随英文走**：中文"有 3 条失败请求"在英文里是 `'3 failed requests'`，
 *    所以模板写成 `'{count} failed requests'`（而不是把中文语序硬套）。
 */

export const SHELL_ZH = {
  // ── 导航（视图注册表的 `titleKey`；英文名与 eyebrow 刻意不完全相同 —— 导航要"看得懂"）──
  'shell.nav.create': '创作',
  'shell.nav.workbench': '工作台 · 专业',
  'shell.nav.overview': '总览',
  'shell.nav.library': '视频库',
  'shell.nav.canvas': '画布',
  'shell.nav.costs': '成本台账',
  'shell.nav.recipes': '配方库',
  'shell.nav.logs': '操作日志',
  'shell.nav.edit': '剪辑台',

  // ── 侧栏 ──
  'shell.nav.aria': '一级视图',
  'shell.nav.failedRequests': '有 {count} 条失败请求',
  'shell.foot.byok': '凭据设置',
  'shell.foot.theme': '主题',
  'shell.rail.expand': '展开侧栏',
  'shell.rail.collapse': '收起侧栏',

  // ── 主题档位（`lib/theme.ts` 的 `THEME_LABEL_KEYS`）──
  'shell.themePref.system': '跟随系统',
  'shell.themePref.dark': '星尘',
  'shell.themePref.day': '日间',

  // ── 顶栏 ──
  'shell.header.openNav': '打开导航',
  'shell.header.closeNotice': '关闭提示',

  // ── 顶栏：项目上下文（`ProjectSwitcher`；V2.11 / B47）──
  'shell.project.label': '当前项目',
  'shell.project.defaultSuffix': '{name} · 默认',
  'shell.project.manage': '项目管理',
  'shell.project.manageTitle': '新建 / 改名 / 删除项目',
  'shell.project.unknown': '（未知项目）',
  'shell.project.current': '当前：{name}',
  'shell.project.counts': ' · {tasks} 片 / {assets} 素材',
  'shell.project.close': '关闭项目管理',
  'shell.project.newPlaceholder': '新项目名（如：2026 双十一 · 主推片）',
  'shell.project.create': '新建',
  'shell.project.renamePlaceholder': '改名（仅当前项目）',
  'shell.project.rename': '改名',
  'shell.project.deleteNote': '删除后不可恢复（项目内的任务与素材不会消失，只是不再归属它）。',
  'shell.project.confirmDelete': '确认删除',
  'shell.project.cancel': '取消',
  'shell.project.deleteTitleUnknown': '当前项目未知',
  'shell.project.deleteTitleNotEmpty': '只有空项目可删：默认项目与仍有任务/素材的项目不可删',
  'shell.project.deleteAction': '删除当前项目',
  'shell.project.deleteDisabledDefault': '默认项目不可删（老数据与未指定项目的落点）',
  'shell.project.deleteDisabledNonEmpty': '项目非空：请先在项目内清理任务与素材',
  'shell.project.created': '已创建并切换到「{name}」',
  'shell.project.renamed': '已改名为「{name}」',
  'shell.project.deleted': '已删除「{name}」，已切回默认项目',
  'shell.service.bad': '后端未连通',
  'shell.service.probing': '探测中',
  'shell.service.ok': '服务在线',

  // ── 区域名（`ErrorBoundary` 的 label：崩了要说清是哪一块崩了）──
  // `app` = `main.tsx` 那一层（兜的是**壳自身**渲染抛错，那时连侧栏都没了）——
  // 它是"最后一道"的 label，崩了只能说"界面"，因为已经没有一个具体视图可指认。
  'shell.region.workbench': '工作台',
  'shell.region.create': '创作入口',
  'shell.region.app': '界面',

  // ── 凭据（保存 / 清除 / 测试连接）──
  'shell.byok.saved': '凭据已{sink}：视频轨{video} · 文本扩写{text}。',
  'shell.byok.sinkLocal': '明文保存在本机（仅限信任设备）',
  'shell.byok.sinkSession': '仅本次会话有效',
  'shell.byok.filled': '已填',
  'shell.byok.empty': '未填',
  'shell.byok.cleared': '已清除本地凭据；服务端不保存任何 Key。',
  'shell.verify.noVideoKey': '未填写视频轨 Key：无法校验',
  'shell.verify.noTextKey': '未填写文本轨 Key：无法校验',
  'shell.verify.failed': '校验失败：{reason}',

  // ── 未知视图兜底（`views/UnknownView.tsx`；语言迁移第十五批）──
  // 这一页的每一句都在解释"**为什么不悄悄重定向**"—— 那是它的存在理由，别简化。
  'shell.unknown.title': '这个视图不存在',
  'shell.unknown.before': '地址栏里的 ',
  'shell.unknown.after': ' 不在视图注册表里。',
  'shell.unknown.body': '它没有被静默重定向——因为"悄悄跳到别处"会让人以为自己点错了。',
  'shell.unknown.home': '回到首页',

  /** 项目下拉里那一行（`lib/projects.ts`）：名字 + 用量，一眼能比较 */
  'shell.project.item': '{name}（{tasks} 片 · {assets} 素材）',

  // ── 语言切换入口（V2.38 上线；侧栏底部，与主题并排）──
  // 标签说的是"**界面**语言"：本产品还有**提示词语言**（后端那份，是独立轴，见 `dict/edit.ts`），
  // 不写清就容易让人以为"切成英文 → 生成的提示词也变英文"（那件事不归这个开关管）。
  'shell.foot.language': '界面语言',
};

export const SHELL_EN = {
  'shell.nav.create': 'Create',
  'shell.nav.workbench': 'Workbench · Pro',
  'shell.nav.overview': 'Overview',
  'shell.nav.library': 'Video Library',
  'shell.nav.canvas': 'Canvas',
  'shell.nav.costs': 'Cost Ledger',
  'shell.nav.recipes': 'Recipe Library',
  'shell.nav.logs': 'Activity Log',
  'shell.nav.edit': 'Editing Desk',

  'shell.nav.aria': 'Primary views',
  'shell.nav.failedRequests': '{count} failed requests',
  'shell.foot.byok': 'Credentials',
  'shell.foot.theme': 'Theme',
  'shell.rail.expand': 'Expand sidebar',
  'shell.rail.collapse': 'Collapse sidebar',

  'shell.themePref.system': 'System',
  'shell.themePref.dark': 'Starlight',
  'shell.themePref.day': 'Daylight',

  'shell.header.openNav': 'Open navigation',
  'shell.header.closeNotice': 'Dismiss notice',

  'shell.project.label': 'Current project',
  'shell.project.defaultSuffix': '{name} · default',
  'shell.project.manage': 'Projects',
  'shell.project.manageTitle': 'Create / rename / delete projects',
  'shell.project.unknown': '(unknown project)',
  'shell.project.current': 'Current: {name}',
  'shell.project.counts': ' · {tasks} renders / {assets} assets',
  'shell.project.close': 'Close project management',
  'shell.project.newPlaceholder': 'New project name (e.g. 2026 launch · hero cut)',
  'shell.project.create': 'Create',
  'shell.project.renamePlaceholder': 'New name (current project only)',
  'shell.project.rename': 'Rename',
  'shell.project.deleteNote':
    'Deletion cannot be undone (tasks and assets inside are not deleted, they just stop belonging to it).',
  'shell.project.confirmDelete': 'Delete',
  'shell.project.cancel': 'Cancel',
  'shell.project.deleteTitleUnknown': 'Current project unknown',
  'shell.project.deleteTitleNotEmpty':
    'Only empty projects can be deleted: the default project and any project holding tasks/assets cannot',
  'shell.project.deleteAction': 'Delete current project',
  'shell.project.deleteDisabledDefault':
    'The default project cannot be deleted (legacy data and jobs without a project land there)',
  'shell.project.deleteDisabledNonEmpty': 'Project is not empty: clear its tasks and assets first',
  'shell.project.created': 'Created and switched to “{name}”',
  'shell.project.renamed': 'Renamed to “{name}”',
  'shell.project.deleted': 'Deleted “{name}” and switched back to the default project',
  'shell.service.bad': 'Backend offline',
  'shell.service.probing': 'Checking…',
  'shell.service.ok': 'Service online',

  'shell.region.workbench': 'Workbench',
  'shell.region.create': 'Create',
  'shell.region.app': 'Interface',

  'shell.byok.saved': 'Credentials {sink}: video track {video} · text expansion {text}.',
  'shell.byok.sinkLocal': 'stored in plain text on this device (trusted devices only)',
  'shell.byok.sinkSession': 'valid for this session only',
  'shell.byok.filled': 'set',
  'shell.byok.empty': 'not set',
  'shell.byok.cleared': 'Local credentials cleared; the server never stores any key.',
  'shell.verify.noVideoKey': 'No video-track key entered — nothing to check',
  'shell.verify.noTextKey': 'No text-track key entered — nothing to check',
  'shell.verify.failed': 'Check failed: {reason}',

  'shell.unknown.title': 'This view does not exist',
  'shell.unknown.before': 'The address bar value ',
  'shell.unknown.after': ' is not in the view registry.',
  'shell.unknown.body':
    'It was not silently redirected — quietly jumping elsewhere would make you think you clicked wrong.',
  'shell.unknown.home': 'Back home',

  'shell.project.item': '{name} ({tasks} clips · {assets} assets)',

  'shell.foot.language': 'Interface language',
};
