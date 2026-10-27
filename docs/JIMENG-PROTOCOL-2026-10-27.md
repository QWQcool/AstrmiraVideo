# 即梦画布协议观测记录（2026-10-27，实测抓包）

> 用途：给后续接手的模型/开发者一份**可直接引用**的事实底稿。本文只记录观测到的东西，
> 不做推断的也不写成结论；每条断言后面跟着它是怎么来的。
>
> 与 [JIMENG-GAP-AUDIT](JIMENG-GAP-AUDIT.md) 的分工：那份是**能力差距对比**，这份是**数据与协议形状**。

---

## 0. 采集条件与边界

| 项 | 值 |
|---|---|
| 目标 | 即梦 AI 画布《故乡》斯坦茜（34 节点 / 45 边） |
| 接入 | 本机 Edge `Edg/156.0.4314.42`，独立配置目录 `.tmp/rea-edge-profile`，`--remote-debugging-port=9223`；Playwright 经 `connectOverCDP` 操作 |
| 登录态 | 复用该配置目录中已有的登录（81 积分 / 标准会员）；未读 Cookie/Token |
| 读到的层次 | ①画布节点/边对象（React fiber）②`/octo_api/v1/*` JSON 响应 ③前端 i18n 字符串 ④**两次真实生成请求体** |
| 写操作 | **只做了两次「生成」**（图片节点「图片 5」、视频节点「视频 6」各一次），未改提示词/参数/布局，未删任何节点 |
| 花费 | 图片 2K + 4 参考 = **8 积分**；视频 720p / 4s / 全能参考 = **56 积分**（81 → 73 → 17） |
| 未做 | 没抓首尾帧 / 智能多帧 / 智能编辑 / 超长视频的 mode 值；没测 3 张以上参考；没读私有 Token |

**复现方法**（下一个接手者照这个走）：
1. `msedge.exe --remote-debugging-port=9223 --user-data-dir=<独立目录>`，在该窗口登录即梦，从首页画布卡片点进去
   （**直接导航 `ai-canvas/<id>` 会被重定向回首页**，必须走卡片点击）；
2. Playwright `chromium.connectOverCDP('http://127.0.0.1:9223')` 后：
   - 节点/边：从 `.react-flow__node` 的 `__reactFiber$*` 向上找 `memoizedProps.nodes/edges`（序列化要跳过 DOM 与 fiber，否则循环引用）；
   - 请求体：`page.on('request')` 过滤 `POST` + host 含 `jianying`，`request.postData()`；
3. 选中节点用**合成事件**（`pointerdown/mousedown/pointerup/mouseup/click` 依次 dispatch），
   这样视口外的节点也能选中；`<video>` 只有在节点进入视口并选中后才挂载。

---

## 1. 画布数据模型：参考关系是**边**，不是节点属性

节点对象（实测，`type` 只有 `image` / `video` 两种在图里出现）：

```jsonc
{
  "id": "node_jpt9r6ew6n",
  "type": "video",                          // image | video
  "position": { "x": -153.54896637262928, "y": 764.5999755859366 },
  "width": 568.889, "height": 320,          // 所有节点统一 569×320
  "data": {
    "source": "model_generated",            // uploaded | model_generated
    "title": "视频 1",
    "resourceId": "59770617-…",             // 当前展示的那一个产物
    "resourceBatches": [                    // 一次生成出的多个结果
      { "id": "edd16e2f-…", "resourceIds": ["59770617-…"] }
    ],
    "totalResourceCount": 1,
    "renderMode": "compact",
    "mediaPreviewInViewport": true,
    "tagPresentation": { "activeMatch": false, "batchSelection": false, "editing": false, "locateMatch": false, "tagIds": [] },
    "targetConnectable": true
  }
}
```

边对象：

```jsonc
{
  "id": "edge_c372ew17bv",
  "source": "node_nzm31kqdrw",              // 素材
  "target": "node_wpb6tz3p0a",              // 生成节点
  "sourceHandle": "default",
  "targetHandle": "default",
  "type": "reference",                      // ← 边类型就是"参考连接"
  "selectable": true,
  "zIndex": 0,
  "ariaLabel": "Reference connection from 图片 node: 图片节点 4 (12).png to 图片 node: 图片 5"
}
```

**要点**：
- 节点**没有** `references` 数组；参考集合 = **指向它的所有 `type:"reference"` 入边**。
- 边**没有** role / order / 用途字段（`handle` 恒为 `default`），也无方向性标签。
- 实测扇入分布（34 节点 / 45 边）：1 条→7 个节点、2 条→6 个、3 条→6 个、**4 条→2 个**；
  边类型统计：`image→image` 20 条、`image→video` 25 条。

---

## 2. 生成请求体（**两次真实抓包**）

端点：`POST /octo_api/v1/node_generate?generate_id=gen-<uuid>&babi_param=<json>&os=…&msToken=…&a_bogus=…`

`babi_param` 是埋点上下文（`{"edit_type":"octo","tool_id":"octo","tab_name":"octo","enter_from":"octo","scene_lv1":"octo",…}`），与业务无关。

### 2.1 图片节点（4 参考，Seedream 5.0 pro / 2K，8 积分）

```jsonc
{
  "project_id": "8c9096d8-…",
  "op": 1,
  "initial": {
    "submit_id": "ba0e5334-…",                 // 幂等键
    "node_id": "node_wpb6tz3p0a",
    "items": [{
      "resource_id": "69afc9fc-…",             // 产物 id，客户端预分配
      "type": 1,                               // 1=image，2=video
      "reference_sources": [                   // ★ 多参考的正式表达（有序）
        { "material_idx": 0, "node_id": "node_nzm31kqdrw", "resource_id": "ab2cbdf1-…" },
        { "material_idx": 1, "node_id": "node_3wagm4x874", "resource_id": "3947e399-…" },
        { "material_idx": 2, "node_id": "node_w5xar464sm", "resource_id": "b11ef3b3-…" },
        { "material_idx": 3, "node_id": "node_nxmask23j1", "resource_id": "ee8c1b8c-…" }
      ],
      "params": { "image_params": {
        "mode": 2,                             // 图片参考生图（面板无模式文案，按 4 参考判定）
        "model_name": "seedream_5.0_pro",
        "resolution": "2K",
        "aspect_ratio": "16:9",
        "materials": [                         // 真正喂模型的素材，带 role
          { "type": 2, "role": 3, "image_uri": "tos-cn-i-tb4s082cfz/1568cbab…" },
          { "type": 2, "role": 3, "image_uri": "tos-cn-i-tb4s082cfz/1081f781…" },
          { "type": 2, "role": 3, "image_uri": "tos-cn-i-tb4s082cfz/8f4553bc…" },
          { "type": 2, "role": 3, "image_uri": "tos-cn-i-tb4s082cfz/2488a793…" }
        ],
        "prompt": "…院里{{image:3}} ，男孩（镜头）手里拿着得物盒子{{image:0}} \\{{Image 4}} 递给姥爷{{image:1}} …"
      }},
      "metric": "{\"sources\":{\"upload_material_array\":[{\"uri\":\"tos-cn-i-…\",\"material_type\":\"image\"}],\"quote_node_array\":[{\"node_id\":\"node_nzm31kqdrw\",\"node_type\":\"image\",\"resource_ids\":[\"ab2cbdf1-…\"]}]}}"
    }]
  }
}
```

### 2.2 视频节点（全能参考，1 参考，Seedance 2.0 VIP / 720p / 4s，56 积分）

```jsonc
"initial": {
  "node_id": "node_mze5xj4fms",
  "submit_id": "eea58efe-…",
  "items": [{
    "resource_id": "5ba19232-…",
    "type": 2,
    "commerce_selection": { "benefit_type": "seedance_20_pro_720p_output" },  // 计费档位
    "reference_sources": [
      { "material_idx": 0, "node_id": "node_h11rxvrbwq", "resource_id": "b4872d12-…" }
    ],
    "params": { "video_params": {
      "mode": 4,                                // ★ 实测「全能参考」= 4
      "model_name": "seedance_2.0_vip",
      "resolution": "720p",
      "aspect_ratio": "16:9",
      "duration_ms": 4000,
      "materials": [ { "type": 2, "image_uri": "tos-cn-i-…/62023978…" } ],   // 视频侧没有 role
      "meta_list": [                            // ★ 视频侧用分段表达"素材在文中的位置"
        { "type": 1, "text": "…整段提示词…" },
        { "type": 2, "material_idx": 0 }
      ],
      "prompt": "核心风格：电影级剧情片风格（实拍，不要CG感）…"
    }}
  }]
}
```

### 2.3 ack

```json
{"ret":"0","errmsg":"OK","data":{"results":[{"resource_id":"5ba19232-…","error_code":0,"state":1}]}}
```
`resource_id` 原样返回预分配的那个；后续进度靠 `POST /octo_api/v1/resource/generation/queue_status`（传 resource_ids）。

---

## 3. 字段语义（只列有证据的）

| 字段 | 含义 | 证据 |
|---|---|---|
| `initial.submit_id` | 幂等键 | 每次生成一个新 UUID |
| `items[].type` | 1=图片，2=视频 | 两次采样分别 1 / 2，与节点类型一致 |
| `items[].resource_id` | 产物 id，**客户端预分配** | ack 原样返回 |
| `reference_sources[].material_idx` | 素材在 `materials[]` 中的下标（**顺序即引用**） | 4 条入边 → idx 0..3 |
| `reference_sources[].node_id` | 来源节点（画布溯源） | 与入边 source 一致 |
| `reference_sources[].resource_id` | 来源节点那次使用的具体产物 | 与节点 `resourceId`/批次一致 |
| `image_params.materials[].role` | 图片素材角色（实测恒为 3） | 仅图片侧出现 |
| `video_params.mode` | 生成模式，**全能参考 = 4** | 与节点面板「生成模式: 全能参考」对照 |
| `image_params.mode` | 图片侧模式，实测 2 | 面板无文案，按 4 参考判定 |
| `commerce_selection.benefit_type` | 计费档位字符串 | 仅视频侧出现 |
| `prompt` 里的 `{{image:N}}` | 文中提及第 N 个素材（**小写**；`{{Image 4}}` 不会被解析） | 图片侧 prompt 实文 |
| `meta_list` | 视频侧的"分段表达"：`{type:1,text}` 文本段 + `{type:2,material_idx}` 素材段 | 视频侧请求体 |
| `metric` | 字符串化 JSON 埋点：`upload_material_array` + `quote_node_array` | 两次都有 |

**能力侧（前端 i18n 字符串，非请求字段）**：`video_omni_ref`=全能参考、`video_omni_reference_min`=请至少上传1个素材、
`video_omniref_max_cnt_pic`=最多使用 {N} 个参考图片、`…reference_video_total_duration_message`=参考视频总时长超过 {N} 秒、
`…reference_resource_unavailable_message`=参考素材不可用，请移除或替换。
→ 说明"能用几张、能不能混类型"由**模型元数据**裁决，且不满足时**阻止提交**而不是静默丢素材。

---

## 4. 未观测（不要当成已知）

- 首尾帧 / 智能多帧 / 智能编辑 / 超长视频 的 `mode` 取值；
- `role` 的其它取值（除 3 以外），以及它是否等价于"主体/场景/风格"；
- 音频参考、参考视频的字段形状；
- 参考数量超过模型上限时，是前端拦还是服务端拒（只看到了前端提示文案）；
- 画布文档本身的持久化接口（节点/边如何落库，走 WS 还是 REST —— 重载页面时未抓到画布详情接口，疑似走协作房间 WS）。

---

## 5. 与本仓契约的对照（供实现时参考）

| 即梦 | 本仓（CONTRACT §21） | 差异 |
|---|---|---|
| 节点只有 `resourceId` + `resourceBatches` | `data.batches[] + data.selectedBatchId` | 同构（我们多了 `request` 快照与 `failure`） |
| 边 `type:"reference"` 无 role | `edges[].kind` + `role` + `assetId` | 我们更"可解释"，但不能表达 N 张集合 |
| `settings.referenceMode` 等价物在**参数层**（`image_params.mode` / `video_params.mode`） | `data.draft.settings.referenceMode: 'none' \| 'first-last-frame' \| 'omni-reference'` | **我们已经预留了这个字段** |
| 模型能力（张数/类型/时长上限）由元数据裁决 | `ModelCapability.maxReferences / referenceModes / referenceKinds` + `checkCapability()` | 骨架已在，**画布侧尚未接线** |
| `reference_sources[].material_idx` 顺序 | `references[].order`（已存在 0..64） | 同构，1:1 可映射 |
| prompt 内联 `{{image:N}}` | 创作入口用 `@提及`（`lib/mentions.ts`），画布无提及语法 | 未定：要不要在画布做提及 |

结论一句话：**B 路线（生成模式）不需要推翻画布 schema —— `referenceMode` / `maxReferences` / `checkCapability` 早在契约里，缺的是把画布侧接上，并把 provider 从"上传一张"扩到"上传 N 张"。**
