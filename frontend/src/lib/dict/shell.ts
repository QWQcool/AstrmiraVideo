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
  'shell.service.bad': '后端未连通',
  'shell.service.probing': '探测中',
  'shell.service.ok': '服务在线',

  // ── 常驻视图的**区域名**（`ErrorBoundary` 的 label：崩了要说清是哪一块崩了）──
  'shell.region.workbench': '工作台',
  'shell.region.create': '创作入口',

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
  'shell.service.bad': 'Backend offline',
  'shell.service.probing': 'Checking…',
  'shell.service.ok': 'Service online',

  'shell.region.workbench': 'Workbench',
  'shell.region.create': 'Create',

  'shell.byok.saved': 'Credentials {sink}: video track {video} · text expansion {text}.',
  'shell.byok.sinkLocal': 'stored in plain text on this device (trusted devices only)',
  'shell.byok.sinkSession': 'valid for this session only',
  'shell.byok.filled': 'set',
  'shell.byok.empty': 'not set',
  'shell.byok.cleared': 'Local credentials cleared; the server never stores any key.',
  'shell.verify.noVideoKey': 'No video-track key entered — nothing to check',
  'shell.verify.noTextKey': 'No text-track key entered — nothing to check',
  'shell.verify.failed': 'Check failed: {reason}',
};
