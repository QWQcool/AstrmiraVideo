# 文档地图（docs/）

> **一句话规则**：每个知识点**只有一个所有者**；其余地方只能链接过去，不能各写一份。
> 本文是这张表的**唯一位置** —— 新增/合并/废弃文档时改这里，别在根 README 里再抄一份。

## 一、按"你此刻要做什么"找文档

| 我要… | 看这篇 | 它的独占内容 |
| :--- | :--- | :--- |
| **第一次跑起来** | [GUIDE.md](GUIDE.md) | 上手指南：档位、双轨接入、四种工作流、界面导览、**声音面板**、**画布的数据安全**、FAQ、日志与巡检（含截图） |
| **改接口 / 请求体 / 画布文档结构** | [CONTRACT.md](CONTRACT.md) | **协议唯一真相**：请求/响应/错误码/画布文档/编排/主体/观测。改行为先改它，版本号递增 |
| **看现在做到哪、下一步做什么** | [PLAN.md](PLAN.md) | §4 实施步骤与 AC、§5 进度日志（唯一台账）、§6 决策记录、§9 待办、§10 待拍板 |
| **验收某个能力"真的能用"** | [ACCEPTANCE.md](ACCEPTANCE.md) | 每条命令**证明什么**、前提是什么、证据落在哪 |
| **租 GPU / 装模型 / 接本地轨** | [LOCAL-GPU-DEPLOY.md](LOCAL-GPU-DEPLOY.md) | H3 / MOSS / Stable Audio 的权重、显存、实测数字、坑；换机器与隧道 |
| **部署 / 升级 / 线上自检** | [DEPLOYMENT-RUNBOOK.md](DEPLOYMENT-RUNBOOK.md) | 部署步骤、`.env.deploy`、重启纪律、自检清单 |
| **看"即梦是怎么做的、我们差多少"** | [JIMENG-REFERENCE.md](JIMENG-REFERENCE.md) | 即梦 UI 观察与差距审计（历史快照，见下方状态） |
| **看交互规格（布局/层级/文案）** | [CREATION-EXPERIENCE-DESIGN.md](CREATION-EXPERIENCE-DESIGN.md) | 创作体验定稿 V1 |
| **查外部参考（n8n / MOSS / 上游台账）** | [REFERENCES.md](REFERENCES.md) | 外部资料与选型评估 |
| **改前端视觉前找参考图** | [assets/README.md](assets/README.md) | 截图与参考图的清单与生成方式 |

## 二、每篇的**状态**（2026-11-02 审计）

| 文档 | 体量 | 状态 | 维护规则 |
| :--- | ---: | :--- | :--- |
| CONTRACT.md | ~300KB | **权威 · 活跃** | 每改一次行为就在开头加一段修订说明；**只增不改**旧版本段落 |
| PLAN.md | ~250KB | **权威 · 活跃** | §5 台账只追加；§9 待办是唯一位置，别在别处记 TODO |
| GUIDE.md | ~40KB | **活跃** | 截图由 `node tests/browser/howto-shots.mjs` 生成，**不要手截** |
| ACCEPTANCE.md | ~7KB | **活跃** | 新增验收命令必须同时写"证明什么/前提/证据路径" |
| LOCAL-GPU-DEPLOY.md | ~45KB | **活跃** | 实测数字必须带日期与机器；没测过的写"未测" |
| DEPLOYMENT-RUNBOOK.md | ~16KB | **活跃** | 与 `scripts/deploy.mjs`、`deploy/compose.yaml` 同步 |
| REFERENCES.md | ~52KB | **半活跃**（参考） | 已被采纳的结论要回填到 CONTRACT/PLAN，本文只留来源 |
| CREATION-EXPERIENCE-DESIGN.md | ~52KB | **半活跃**（设计定稿） | 界面与其冲突时，以本文为准或显式改本文 |
| JIMENG-REFERENCE.md | ~35KB | **历史快照（2026-10-22 观察）** | 不再更新；差距项已迁到 PLAN §9 |
| assets/README.md | ~5KB | **活跃**（图库索引） | 新增图必须登记；历史参考图单独标"历史" |
| `design/creation-v1`、`design/creation-v2`、`design/reference-jimeng-2026-10-20` | 小 | **历史原型** | 静态 HTML 原型，只作参考，不再维护 |
| `experiments/remotion-proto/REPORT.md` | 8KB | **历史实验** | 结论已进 CONTRACT（剪辑台选型），目录保留可复跑源码 |

## 三、审计结论（2026-11-02）：**没有该删的权威文档，有三处该收**

1. **`docs/assets/` 的 04~13 号图**（约 3.4MB）只在 `assets/README.md` 里被"登记"，没有任何文档引用它们。
   → 已在该 README 里标为**历史参考**；若要瘦身，可整批移到 `docs/assets/archive/`（**先问用户**，图删了不可再生）。
2. **根 README 的「文档地图」曾与本节重复** → 根 README 只保留一句"完整文档地图见 docs/README.md"，
   避免两处清单漂移（同一条纪律：一个知识点一个所有者）。
3. **CONTRACT / PLAN 的顶部修订块越来越长**（303KB / 251KB 里相当一部分是历史 changelog）。
   → **建议**（未做）：把"每个版本的修订说明"抽到 `docs/CHANGELOG.md`，CONTRACT 只留最近 3 个版本的提示。
   这是一次纯搬运，风险在于并行会话同时改 CONTRACT，所以等没有并行工作时再做。

## 四、不放进仓库的东西

- 凭据：`.env.deploy` / `MiMo_API_Key` / 任何 Key **不进仓库、不进镜像、不写进文档**；
- 运行数据：`data/`、`outputs/`、`.tmp/`；
- 截图产物里的临时数据：`howto-shots.mjs` 用的是**隔离实例 + 夹具数据**，不碰真实任务。
