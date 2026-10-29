# 人脸相似度（`pnpm smoke:face`）

把「换场景之后是不是同一张脸」从**看图说话**变成一条可复跑的命令。

## 这个数字是什么

ArcFace 人脸识别模型（InsightFace）输出的 512 维**归一化身份嵌入**之间的**余弦相似度**。

- 它是**相对量**，不是概率、不是百分比：`0.53` 不能读成「53% 是同一个人」；
- 换模型会换分布（实测见下），所以报告里一定写模型名；
- 阈值 `0.35` 是 ArcFace 常被引用的工作点，**不是本项目标定的**。项目没有做 ROC/EER 标定，
  所以单看一个数就断言「同一张脸」是不成立的 —— 脚本自己会这么说（见"实测"）。

## 一次性准备（不进仓库：`.tmp/` 已 gitignore）

模型约 650 MB、venv 约 200 MB，都不提交。缺了就**退出码 2**（跳过），不会被当成通过。

```powershell
# 1) 隔离 venv（不碰 ComfyUI 的 python_embeded，也不进 node_modules）
python -m venv .tmp/facesim-venv
.tmp/facesim-venv/Scripts/python.exe -m pip install --progress-bar off `
    onnxruntime opencv-python-headless numpy pillow insightface

# 2) 模型包（二选一，或都下：两个模型结论不一样才有对比）
Invoke-WebRequest 'https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip' `
    -OutFile .tmp/facesim-models/buffalo_l.zip
Expand-Archive .tmp/facesim-models/buffalo_l.zip -DestinationPath .tmp/facesim-models/models/buffalo_l

Invoke-WebRequest 'https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip' `
    -OutFile .tmp/facesim-models/antelopev2.zip
Expand-Archive .tmp/facesim-models/antelopev2.zip -DestinationPath .tmp/facesim-models/tmp-antelope
Move-Item .tmp/facesim-models/tmp-antelope/antelopev2 .tmp/facesim-models/models/antelopev2
```

Linux / macOS 把 `.tmp/facesim-venv/Scripts/python.exe` 换成 `.tmp/facesim-venv/bin/python`；
包装脚本会自己按顺序找解释器，也可以用 `FACE_SIM_PYTHON` 指定。

为什么要 Python 而不是纯 Node：`onnxruntime-node` 会把多平台原生二进制塞进 `node_modules`，
让 CI 和产物构建都变重；隔离 venv 对 `pnpm build` / `pnpm test` 零影响。

## 用法

```powershell
pnpm smoke:face -- `
  --anchor outputs/f245192b-8896-4b70-9456-407765c96965.png `
  --images .tmp/e2e/b103-anchor-scene1.png .tmp/e2e/b103-anchor-scene2.png `
  --negatives .tmp/e2e/facesim-control-man.png .tmp/e2e/facesim-control-woman.png `
  --json .tmp/e2e/facesim-b103.json
```

- `--anchor`：锚点（定妆图）；
- `--images`：本该是同一个人（同主体的各场景产物）；
- `--negatives`：**不同的人**。不给就只是没刻度的数字，脚本会明确告诉你；
- `--model`：`buffalo_l`（R50，默认）/ `antelopev2`（R100）；
- `--threshold`：默认 0.35。

退出码：

| 码 | 含义 |
| --- | --- |
| 0 | 同人组全部过阈值，且（给了对照图时）异人组全部被排除 |
| 1 | 有图没脸 / 多张脸 / 同人没过阈值 / **有误判**（这条最重要：它说明这把尺子在这组图上不可信） |
| 2 | 后端不可用（没装 Python 依赖 / 没下模型）—— 本地与 CI 默认不装，不算失败 |

## 红线（"宁可没结论，也不给假结论"）

1. 图里没有脸 → `noFace`，不参与相似度，整体判失败，**不拿别的图替代**；
2. 图里有多张脸 → `ambiguous`，不当身份证据（按最大的一张算，但明确标为不算数）；
3. 不给对照图 → 结论只写「过了外部阈值，但未标定」；
4. 缺依赖 → 退出码 2，**不返回 0**，免得流水线把"没测"当"通过"。

## 实测（2026-10-29，本机 CPU 推理）

被测对象 = B103 片 B 的真机产物：

| 图 | 来源 |
| --- | --- |
| 锚点 | `outputs/f245192b-…png`（定妆图，任务 `f245192b`） |
| scene1 | `.tmp/e2e/b103-anchor-scene1.png`（雪地，脸占图 10.2%） |
| scene2 | `.tmp/e2e/b103-anchor-scene2.png`（咖啡馆，脸占图 **3.2%**、低头） |
| 对照男 / 对照女 | 本地 ComfyUI 现生成的另外两个人像（同一套模型、同一套棚拍提示词） |

| 模型 | 同人组（3 对） | 异人组（6 对） | 间隔 | 阈值 0.35 下的混淆 |
| --- | --- | --- | --- | --- |
| `buffalo_l`（R50） | 0.3973 / 0.5305 / 0.5442 | 0.2116 ~ 0.4544 | **−0.0571** | 同人 3/3 判同；异人 5/6 判异（1 个误判为同人） |
| `antelopev2`（R100） | 0.3798 / 0.5220 / 0.5961 | 0.1631 ~ 0.4927 | **−0.1129** | 同人 3/3 判同；异人 3/6 判异（3 个误判为同人） |

**结论（如实）**：在这条流水线的合成人脸上，**单阈值身份相似度不可用**。

- 两条分布**有重叠**：`锚点 ↔ 对照女`（不同人）= 0.4544，比 `锚点 ↔ scene2`（同一人）= 0.3973 还高；
- 换更强的 ResNet100 也没救（误判更多）—— 不是模型不够强，是"同一套生成模型出的脸"在嵌入空间里本来就靠得近；
- 因此**不把"像不像"做成界面分数、也不做成验收门槛**。B103 的「同一张脸」仍然是人眼判断 + 两张图并排看。

这个工具仍然有用，但口径要改成**相对**的：同一组图、同一个模型，这一版 vs 上一版（回归），
或者同一次出图里 `scene1 ↔ scene2` 之间的相对高低；它不给"是/不是同一个人"的判决。

## 局限

- 只在**合成人脸**上测过；对真实照片没有样本（ArcFace 本来是为真实照片训练/评估的，别把这里的结论外推）；
- 样本极小：1 个主体 × 3 图 + 2 个对照；阈值没有 ROC/EER 标定；
- 脸太小（占图 < 5%）、侧脸、低头都会明显拉低嵌入质量（scene2 就是这种情况）；
- CPU 推理，每张约 0.3 s；检测尺寸固定 640×640。
