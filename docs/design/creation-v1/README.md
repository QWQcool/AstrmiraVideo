# 创作体验设计包 V1

日期：2026-10-19。设计规格见 [CREATION-EXPERIENCE-DESIGN](../../CREATION-EXPERIENCE-DESIGN.md)，开发步骤与状态见 [PLAN §4 Step 11 / §5](../../PLAN.md)。

## 查看

优先打开 [开发参照详情图](development-reference.html)：总览 + 创作入口 / 媒体画布 / 图片编辑 / 主体复用 / 首帧确认 / 成片交付。左侧切页，右侧查看历史截图、目标规则与验收关注；支持图片放大、节点锚定面板、草稿切换、编辑工具与蒙版示意、主体选择、等待/运行/失败/不可用状态、开发注释开关和当前页打印。

保留同目录 `development-reference.css`、`development-reference.js`、`scene.png` 及相邻 `reference-jimeng-2026-10-20` 截图目录。可直接打开 HTML，无安装或后端要求。全部操作均是离线示意，不调用接口或保存输入；未来能力与待拍板方案有明确标记。原始观察与本仓当前代码不混为一谈；实施进度和此片验收见 [PLAN §5](../../PLAN.md#ui-development-reference-status)。

多素材与双入口参照：创作页可切空态、单图、三图、图片＋视频和首尾帧；添加/排序/移除、用途和 @ 文本提及均为内存示意，不兼容时会阻止进入下一步。顶部「对话 / 画布」切换保留草稿；画布媒体卡可拖动或用方向键移动，细白曲线随端点变化，支持缩放与滚动，计划依赖仍为虚线。三张图复用同一原创素材，视频是无媒体占位；不会伪装为多参考真实推理。验收与在线观察见 [PLAN §5](../../PLAN.md#multi-reference-reference-status)。

### 历史 V1 原型

直接在浏览器打开 [prototype.html](prototype.html)，无需应用后端、依赖安装或登录；也可以用任意静态文件服务器打开本目录。保留同目录的 CSS、JS 和 PNG。GitHub 文件页不会执行 HTML，下载本目录后用浏览器打开即可。

- [首页视觉图](home-concept.png)
- [画布视觉图](canvas-concept.png)
- [原创示例素材](scene.png)

本目录为设计交付物，不是产品功能。图中的视频封面不对应实际视频；输入区提交只改变演示状态。原型不调用应用 API、付费模型或外部脚本，也不收集凭据。实际接线与验收见 PLAN。

## 原型覆盖

| 已表达的交互 | 原型边界 |
|---|---|
| 首页 / 作品 / 画布切换；导航与设置归组 | 专业工作台、成本、日志等只展示入口说明 |
| 视频 / 图片模式；模型说明；图片未配置停用生成 | 不选择或安装生图模型，尺寸未配置显示停用 |
| 单首帧引用、移除；配方追加文本 | 富文本 @ 行内节点、多参考排序、能力动态参数留给生产实现 |
| 任务运行、完成、失败、重试、取消状态 | 所有状态明确标注演示；不是新增免费试跑功能 |
| 作品搜索与类型筛选、详情、作为参考、放入画布 | 示例数据固定，暂未连接项目作品 API |
| 画布节点选择/拖动、平移、缩放、添加文本、本地媒体预览 | 连线是展示关系，不可编辑执行依赖；暂无框选、撤销/重做、自动排布 |
| 草稿与初始节点位置保存在本机 | 新增节点、备注修改、上传媒体只在当前会话保留；多画布与服务端持久化属于 S3 |
| 窄屏浏览、画布提示与作品跳转 | 不提供手机完整画布编辑 |

生成视觉图用于材质、氛围与层次；可点击稿展示操作关系。它们发生冲突时以设计规格为准。图中多参考、下载、图像编辑等须按能力和任务状态实现，不能照图全部点亮。

## 图片生成记录

方法：Codex 内置 **ImageGen**，三次独立生成；输出原图直接复制入本目录，未做后期像素修改。图像属于本次设计内容，未使用即梦页面素材或复用其品牌。生成工具没有向本设计包提供可核验的底层模型版本，因此不填写模型版本。

以下记录主要生成指令，供后续重做时保持方向（不是随机种子可复现承诺）：

### home-concept.png

生成一张 16:9 桌面 AI 创作工作室高保真界面。品牌 Astrmira，右上角“交互设计稿 V1”。中性炭灰背景 #111315、面板 #1c1f22、清晰白色无衬线文字、暖金色品牌、青色选择态。左侧约 218px 导航：创作、作品、画布、配方；最近创作与底部管理与设置。标题“把灵感，变成画面”，副标题“从一句话、一张参考图开始”，生成/画布切换。宽输入区集中参考素材、中文提示词、视频/图片、Seedance·云端、首帧、16:9、720p、5s、费用待核算和圆形提交按钮。提示词描述客厅傍晚到夜晚、镜头缓缓推进、突出环形吸顶灯光晕。下方四个起手式：运镜、光线、产品展示、分镜。最近作品展示客厅、餐厅与灯具细节。无即梦品牌、无会员促销、无虚构积分或已配置图像模型。

### canvas-concept.png

生成一张同品牌、同色系的 16:9 媒体创作画布高保真界面。顶部 Astrmira / 客厅灯光广告 / 已保存 / 素材 / 交互设计稿 V1。点阵无限画布，青色弧线连接文字备注、客厅参考图、选中图片和右侧 5 秒视频卡片。大幅媒体优先，选中图片具有青色边框。浮动操作条含作为参考、生成视频、下载与更多；图像编辑标为待接入模型。底部浮动输入区放场景/灯具参考、提示词“保持房间布局与灯具造型，镜头缓缓推进。”，视频、Seedance·云端、16:9、720p、5s 和提交箭头。右侧添加菜单含文本、图片、视频、音频、从作品添加；左下缩放与适应画布，右下缩略地图。无即梦品牌或促销。

### scene.png

Create one photorealistic cinematic 16:9 interior architecture photograph to serve as a demo media asset in a private AI creative studio UI prototype. Warm modern living room at blue hour, floor-to-ceiling windows overlooking distant city silhouettes, sculptural cream sofa on right, oval travertine coffee table, small vase with red flower, oak wall paneling, a beautiful two-ring flush ceiling light emitting soft warm light as the focal product, warm indoor light and cool blue outdoors, clean commercial interior photography, realistic materials, uncluttered scene, no people, no text, no logos, no interface, no borders. Wide composition with ceiling light visible and attractive thumbnail readability. Original design.

## 验收记录

执行者：Codex；浏览器：Codex 内置浏览器。以下为设计原型检查，不是生产功能验收。

| 检查 | 观察与判定 |
|---|---|
| 桌面首页 / 画布 | 【已验证】1440×960 视口下观察全页截图；创作框、媒体节点、底部输入区与主导航可辨识；生成图与原型均人工视觉检查 |
| 图片模式 | 【已验证】切换后显示模型待配置，生成按钮 disabled，模型弹窗说明部署要求；原提示词仍在 |
| 引用选择 | 【已验证】素材选择后出现“客厅空间 · 首帧”及移除按钮 |
| 状态演示 | 【已验证】生成中 → 失败 → 重试 → 完成 → 放入画布；全程标记演示 |
| 添加节点 | 【已验证】添加菜单 → 文本后出现“新建备注” |
| 作品筛选 | 【已验证】不存在的名称显示空结果；清空搜索后，图片筛选仅显示图片卡片 |
| 窄屏 | 【已验证】375×812 视口下首页/作品无横向溢出；画布显示桌面操作提示与“打开作品”按钮 |
| 脚本语法 | 【已验证】`node --check docs/design/creation-v1/prototype.js` 通过 |
| 生产项目 lint / type / contract / build | 【已验证】通过；契约测试 11 项通过；构建仍有包体大小提示 |
| 生产项目 coverage | 【未通过，环境前置缺失】本轮运行 615 passed / 5 failed / 30 skipped，7 个文件失败；错误涉及系统 ffmpeg 不可用和未生成视频夹具。补跑 `test:fixtures` 同样因 ffmpeg 不可用失败。未修改生产测试或降低门槛 |
| 生产项目 smoke:ui | 【未通过，环境前置缺失】运行缺 Playwright Chromium；尝试安装时下载连接多次重置（ECONNRESET），停止继续重试。完整媒体冒烟还需要 ffmpeg 与夹具。未声称全量门禁通过 |

拖拽精度、上传所有格式、撤销/重做、真实模型接线、完整产品回归与性能指标尚未验收。生产改版开工后，必须按 Step 11 对应 AC 重新验证，不能沿用本记录当作真实功能已通过。
