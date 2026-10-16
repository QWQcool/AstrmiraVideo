import { CANVAS_PLAN_VERSION, CanvasPlanSchema, type CanvasPlan } from '@astrmira/shared';
import { getLanguage, translate, type MessageKey } from './i18n';

/**
 * 编排文件 `astrmira.canvas-plan`（CONTRACT §11-6 附 / V2.35；台账 A5 片 B 收口）。
 *
 * ## 它是什么
 * 把一份画布编排**导出成一个 JSON 文件**，以及在别处（另一个项目 / 另一台部署 / 另一个人手里）
 * 把它**导入回来**。纯前端生成与读取：**零新路由、零契约调用**（照 §11-4 配方包那一族的写法）。
 *
 * ## 五条口径（与契约逐条对应）
 * 1. **导出的是"计划"，不是"运行记录"**：`plan` 原样带上（含 `runSeq` / `lastTaskId` / `pinnedTaskId`）——
 *    剥离等于悄悄丢信息；但 `notes` 里**如实写明**"产物 ID 只在本机部署有意义"；
 * 2. **不含凭据 / 不含 provider 私有参数**（编排本身就没有，写成显式约定）；
 * 3. **导入 = 新编排身份**（`plan.id` 重新生成，见 `withNewPlanIdentity`）—— 幂等键含 `planId`，
 *    共享 id 会在同一部署里互相命中对方的任务（静默串）；
 * 4. **只做前向兼容**：更新版本的文件**明确拒绝**（"请升级"），没有版本号的按 v1 处理**并留痕**
 *    （与 `migrateEditProject` 同一口径，见 §11-2 附）；
 * 5. **失败给人话原因、不抛、不返回半成品**：解析函数返回 `{ ok: false, reason }`，
 *    调用方决定"提示用户 / 保持原样"，**当前编排一动不动**。
 *
 * ⚠️ 这里的解析**不校验引用的任务是否存在** —— 那是运行那一刻的事（§11-6 第 7 / 8 条会如实跳过并说明）。
 *
 * ## 语言迁移第十八批：这一层`从共享包搬来前端`，原因（"这句话给谁看"）
 * 它原先在 `packages/shared/src/canvasPlanFile.ts`，但**消费者只有前端**
 * （`views/CanvasView.tsx` + 它自己的单测）—— 也就是说，这里每一句 `reason` 都是**给人看的**，
 * 而共享包（纯类型 / 数据层）**没法持有界面文案**（它不能 import 前端字典）。
 * 搬来前端之后，它与**本来就在前端**的编辑层 `lib/canvasPlan.ts` 重新成了对称的一对：
 * 一个管"编排本身"，一个管"编排的文件形态"。
 *
 * ⚠️ **`CANVAS_PLAN_FILE_NOTES` 刻意没迁**（行内有 `i18n-exempt` 标记）：那四条是**产物内容**
 * —— 它们会被**写进导出的 JSON 文件**（接收方按格式读它），与交付包里的 `交付清单.json`、
 * 配方包的 `notes` 同一条口径：**产物不跟界面语言走**（换台机器、换个人打开，文件里的话还是那句话）。
 * 代价如实：它们同时也会显示在导入/导出提示面板里，所以英文界面下那一段是中文
 * （与交付清单的 warnings 同一取舍）。
 */

/** 取文案的本地助手（本层是纯函数，没有 React 订阅；调用它的视图订阅了语言） */
const msg = (key: MessageKey, vars?: Record<string, string | number>): string =>
  translate(getLanguage(), key, vars);

/** 文件标识（接收方据此判断"这是什么文件"；`kind` 不对 = 不是本格式） */
export const CANVAS_PLAN_FILE_KIND = 'astrmira.canvas-plan';

/**
 * 写入文件 `notes` 的**固定注记**（写给接收方的话，含"这份文件不含什么"）。
 *
 * 为什么是常量而不是函数：这些是**关于文件格式本身的事实**（不随导出时机变化）；
 * 而"导入会怎样"（新身份 / 装载语义）属于**导入端的行为**，写进文件反而会在将来变成谎言
 * —— 那部分由导入界面的提示负责（见 CanvasView）。
 *
 * 语言：**产物内容，不跟界面语言走**（理由见文件头）—— 四条各自带 `i18n-exempt` 标记。
 */
export const CANVAS_PLAN_FILE_NOTES: readonly string[] = [
  // i18n-exempt: 写进导出文件的 notes 第 1 条（产物内容，不跟界面语言走）
  '这是画布编排（"打算做什么"），不是运行记录 —— 提交出的任务与成片在服务端的任务表里（视频库 / 事实图）。',
  // i18n-exempt: 写进导出文件的 notes 第 2 条（产物内容）
  '节点上的"上次产物 / 固定"ID 只在本机部署有意义：换一台部署导入后，那些任务不存在，运行时会如实跳过并说明。',
  // i18n-exempt: 写进导出文件的 notes 第 3 条（产物内容）
  '不含凭据与 provider 私有参数（编排本身没有这两样，这里写出来是显式约定）。',
  // i18n-exempt: 写进导出文件的 notes 第 4 条（产物内容）
  '文件里不含媒体文件：换一台部署要真正复现一支片，得把成片一起带上。',
];

export interface CanvasPlanFile {
  kind: typeof CANVAS_PLAN_FILE_KIND;
  /**
   * 格式版本 = `CANVAS_PLAN_VERSION`（**同一个数**）。
   * 为什么合并而不是独立维护：文件装的就是这份编排 —— 将来编排加字段升版本时，
   * 老文件必须能被迁移函数接住（§11-2 附 的迁移链同款）。
   */
  version: number;
  /** epoch ms */
  exportedAt: number;
  /** 写给接收方的话（**含"这份文件不含什么"**；见 `CANVAS_PLAN_FILE_NOTES`） */
  notes: string[];
  /** §11-6 的编排内容，**原样**（含 runSeq / lastTaskId / pinnedTaskId） */
  plan: CanvasPlan;
}

/** 组装一份导出文件（纯函数；`now` 可注入） */
export function buildCanvasPlanFile(plan: CanvasPlan, options: { now?: number } = {}): CanvasPlanFile {
  return {
    kind: CANVAS_PLAN_FILE_KIND,
    version: CANVAS_PLAN_VERSION,
    exportedAt: options.now ?? Date.now(),
    notes: [...CANVAS_PLAN_FILE_NOTES],
    plan,
  };
}

/** 导出文本（缩进 + 尾换行 —— 与配方包同款，人打开文件时是一份能读的 JSON） */
export function canvasPlanFileText(file: CanvasPlanFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ── 导入（解析 / 校验 / 迁移）────────────────────────────────────────────────

export interface CanvasPlanFileReadOk {
  ok: true;
  /** 文件里的编排（**原样**；换新身份是调用方的事，见 `withNewPlanIdentity`） */
  plan: CanvasPlan;
  /** 文件里写给接收方的话（界面要如实展示） */
  notes: string[];
  /** 来自哪个版本（与当前版本相同 = null，表示没迁移过） */
  migratedFrom: number | null;
}

export interface CanvasPlanFileReadFail {
  ok: false;
  /** 给用户看的原因（含"该怎么做"） */
  reason: string;
  /** 来自更新的版本时带上它（调用方可以据此显示 vN > vM） */
  futureVersion?: number;
}

export type CanvasPlanFileReadResult = CanvasPlanFileReadOk | CanvasPlanFileReadFail;

/** 短码（错误原因里引用节点 / 边时的显示口径；完整 id 会把原因刷成一行乱码） */
function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 12)}…`;
}

/**
 * 图结构检查（schema 管不住的部分）。
 *
 * 为什么需要它：`CanvasPlanNodeSchema` / `CanvasPlanEdgeSchema` 只约束"每条记录自洽"，
 * 而**悬挂边 / 重复 id / 自环 / 重复边**是"记录之间的关系"错了 —— 本机的编辑动作
 * （`addPlanEdge` / `removePlanNode`）保证不会产生它们，但**手改过的文件**可能有。
 * 放进来的后果不是"报错"而是"画布上画着一条连不到东西的线 / 环上跑任何一条都可能烧钱"，
 * 所以在导入这一刻就说清（失败给人话原因，不返回半成品）。
 *
 * 语言：这一层返回的是**给人看的句子**（界面直接显示），所以走字典；
 * 列表分隔符也走字典（`、` 是中文标点，英文要用 `, ` —— 那是排版事实）。
 */
export function planStructuralIssues(plan: CanvasPlan): string[] {
  const issues: string[] = [];
  const sep = msg('canvas.file.listSeparator');

  const ids = new Set<string>();
  const duplicated: string[] = [];
  for (const node of plan.nodes) {
    if (ids.has(node.id)) duplicated.push(node.id);
    ids.add(node.id);
  }
  if (duplicated.length > 0) {
    issues.push(msg('canvas.file.issue.duplicateNodes', { ids: duplicated.map(shortId).join(sep) }));
  }

  const dangling: string[] = [];
  const selfLoops: string[] = [];
  const repeated: string[] = [];
  const seen = new Set<string>();
  for (const edge of plan.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      dangling.push(`${shortId(edge.from)}→${shortId(edge.to)}`);
      continue;
    }
    if (edge.from === edge.to) {
      selfLoops.push(shortId(edge.from));
      continue;
    }
    const key = `${edge.from}→${edge.to}`;
    if (seen.has(key)) repeated.push(`${shortId(edge.from)}→${shortId(edge.to)}`);
    seen.add(key);
  }
  if (dangling.length > 0) {
    issues.push(msg('canvas.file.issue.danglingEdges', { ids: dangling.join(sep) }));
  }
  if (selfLoops.length > 0) {
    issues.push(msg('canvas.file.issue.selfLoops', { ids: selfLoops.join(sep) }));
  }
  if (repeated.length > 0) {
    issues.push(msg('canvas.file.issue.repeatedEdges', { ids: repeated.join(sep) }));
  }

  return issues;
}

/**
 * 读一份编排文件（文本）→ 校验 + 迁移。
 *
 * 校验顺序（每一步**先于**下一步 —— 原因要精确到"是哪一类问题"）：
 * ① JSON 能解析；② 顶层是对象；③ `kind` 是本格式；④ 版本（未来版本拒绝 / 无版本号按 v1 留痕）；
 * ⑤ `plan` 过 `CanvasPlanSchema`；⑥ 图结构检查（`planStructuralIssues`）。
 */
export function readCanvasPlanFile(raw: string): CanvasPlanFileReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: msg('canvas.file.reason.notJson') };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: msg('canvas.file.reason.notObject') };
  }

  const draft = parsed as Record<string, unknown>;

  // ③ 标识：**先看 kind**（比"版本号对不对"更前置的问题："这根本不是编排文件"）
  const kind = draft['kind'];
  if (kind !== CANVAS_PLAN_FILE_KIND) {
    return {
      ok: false,
      reason:
        typeof kind === 'string'
          ? msg('canvas.file.reason.notPlanFileKind', {
              kind,
              expected: CANVAS_PLAN_FILE_KIND,
            })
          : msg('canvas.file.reason.notPlanFileNoKind'),
    };
  }

  // ④ 版本：只做前向兼容（照 §11-2 附 的纪律）
  const migrationNotes: string[] = [];
  const rawVersion = draft['version'];
  let version = CANVAS_PLAN_VERSION;
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < 1) {
    // 没有版本号：被手改过 / 早期格式。按 v1 试一遍，**并如实标注**
    migrationNotes.push(msg('canvas.file.note.noVersion'));
    version = 1;
  } else if (rawVersion > CANVAS_PLAN_VERSION) {
    return {
      ok: false,
      futureVersion: rawVersion,
      reason: msg('canvas.file.reason.newerVersion', {
        fileVersion: rawVersion,
        localVersion: CANVAS_PLAN_VERSION,
      }),
    };
  } else {
    version = rawVersion;
  }
  const migratedFrom = version === CANVAS_PLAN_VERSION ? null : version;

  // ── 迁移链（当前只有 v1，所以这里是空的；加版本时在这里补步）──
  // 例：if (version < 2) { draft['plan'] = …; migrationNotes.push('v1 → v2：…') }
  // 走到这里说明迁移链没把它带到当前版本（加版本时忘了补步）—— 明确报错而不是"装作成功"
  if (version !== CANVAS_PLAN_VERSION) {
    return {
      ok: false,
      reason: msg('canvas.file.reason.migrationBroken', {
        fromVersion: version,
        toVersion: CANVAS_PLAN_VERSION,
      }),
    };
  }

  // ⑤ 内容：plan 必须过编排 schema
  const planParsed = CanvasPlanSchema.safeParse(draft['plan']);
  if (!planParsed.success) {
    const first = planParsed.error.issues[0];
    return {
      ok: false,
      reason:
        first === undefined
          ? msg('canvas.file.reason.invalidPlan')
          : msg('canvas.file.reason.invalidPlanDetail', {
              detail: `${first.path.join('.')} ${first.message}`,
            }),
    };
  }

  // ⑥ 图结构
  const issues = planStructuralIssues(planParsed.data);
  if (issues.length > 0) {
    return {
      ok: false,
      reason: msg('canvas.file.reason.badGraph', {
        issues: issues.join(msg('canvas.file.issueSeparator')),
      }),
    };
  }

  const rawNotes = draft['notes'];
  const fileNotes = Array.isArray(rawNotes) ? rawNotes.filter((item): item is string => typeof item === 'string') : [];

  // 迁移留痕在前：它比"文件里写给接收方的话"更该被看到（"这份文件被改动过"）
  return { ok: true, plan: planParsed.data, notes: [...migrationNotes, ...fileNotes], migratedFrom };
}
