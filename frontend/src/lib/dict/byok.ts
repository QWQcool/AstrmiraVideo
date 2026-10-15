/**
 * **凭据抽屉**（`components/ByokDrawer.tsx`）的文案。
 *
 * ## 三条与别处不同的注意点
 * 1. **请求头名字不译**：`X-Provider-Key` / `X-LLM-Key` / `localStorage` / `sessionStorage` /
 *    `max_tokens` 都是**代码事实**，原样保留（译了就与实现对不上了）；
 * 2. **"零费用"那两句里的 `**`**：原文如此（作者写 markdown 粗体时留在了界面上）——
 *    迁移**不改文案**，所以照抄；要修的话另开一个小条目，别趁迁移顺手改；
 * 3. **凭据的承诺句（"不落库、不回显"）语气要一致**：中英两边都不能弱化成
 *    "we try not to store it" 之类 —— 它是**行为承诺**，不是努力方向。
 */

export const BYOK_ZH = {
  'byok.aria': 'BYOK 凭据设置',
  'byok.title': 'BYOK 凭据',
  'byok.close': '关闭',

  // ── 视频轨（服务端地址 + Key + 模型档位）──
  'byok.baseUrl.label': '服务端地址',
  'byok.baseUrl.note': '默认已填火山方舟；自建代理或兼容端点可改。',
  'byok.key.label': 'API Key',
  'byok.key.show': '显示',
  'byok.key.hide': '隐藏',
  'byok.key.placeholder': '粘贴你的 Key',
  'byok.key.placeholderDisabled': '当前环境禁止填写',
  'byok.key.transport.before': '仅经请求头 ',
  'byok.key.transport.mid': ' 传输，',
  'byok.key.transport.emphasis': '不进 URL、不进请求体、不进日志',
  'byok.key.transport.after': '；服务端运行时使用，不落库、不回显。',
  'byok.model.label': '模型档位',
  'byok.model.custom': '自定义（填控制台里的模型 / 接入点 id）',
  'byok.model.customNote': '自定义：请填方舟控制台里真实可用的模型 id 或接入点 id（ep-…）',
  'byok.verify.running': '校验中…',
  'byok.verify.test': '测试连接',
  'byok.verify.videoNote': '零费用：先查模型列表，再用「空 content 探针」判断**是否已开通**（不会创建任务）',

  // ── 文本轨（扩写）──
  'byok.llm.label': '扩写模型（文本轨）',
  'byok.llm.reuseTitle': '把上面视频轨的 Key 复制到文本轨（仅当两者是同一把 Key 时使用）',
  'byok.llm.reuse': '复用视频 Key',
  'byok.llm.custom': '自定义（自填地址与模型）',
  'byok.llm.customNote': '自定义：需填完整的 baseUrl 与模型名；留空时服务端会明确报「未配置」，不会替你挑一个地址',
  'byok.llm.modelPlaceholder': '模型名 / endpoint id',
  'byok.llm.keyLabel': '扩写 API Key',
  'byok.llm.keyPlaceholder': '粘贴你的 Key（可不填，那时 ✨ 会置灰）',
  'byok.llm.verifyNote': '零费用：发一次 `max_tokens: 1` 的最小对话请求',
  'byok.llm.transport.before': '仅经请求头 ',
  'byok.llm.transport.after':
    ' 传输。本服务**不提供文本侧兜底 Key**（纯 BYOK）：没填就是“没配”，不会静默降级成规则改写。',

  // ── 落盘与动作 ──
  'byok.persist.label': '明文存储到本机（localStorage）',
  'byok.persist.warn': '仅限个人信任设备：勾选后 Key 以明文留在浏览器中，任何人使用这台设备都能读到。',
  'byok.persist.note': '不勾选时只存 sessionStorage —— 关闭标签页即失效，这是默认且推荐的用法。',

  // ── HTTPS 守卫（`lib/byok.ts` 的 `keyInputNotice`：公网明文下禁止填写）──
  'byok.warn.publicPlaintext': '公网明文环境禁止填写密钥，请使用 HTTPS（见部署说明 §9-2）',
  'byok.clear': '清除本地凭据',
  'byok.save': '保存',
};

export const BYOK_EN = {
  'byok.aria': 'BYOK credentials',
  'byok.title': 'BYOK credentials',
  'byok.close': 'Close',

  'byok.baseUrl.label': 'Server address',
  'byok.baseUrl.note':
    'Filled in with Volcengine Ark by default; change it for a self-hosted proxy or a compatible endpoint.',
  'byok.key.label': 'API Key',
  'byok.key.show': 'Show',
  'byok.key.hide': 'Hide',
  'byok.key.placeholder': 'Paste your key',
  'byok.key.placeholderDisabled': 'Not allowed in this environment',
  'byok.key.transport.before': 'Sent only as the ',
  'byok.key.transport.mid': ' header, ',
  'byok.key.transport.emphasis': 'never in the URL, the request body or the logs',
  'byok.key.transport.after':
    '; used at runtime by the server, never stored in the database and never echoed back.',
  'byok.model.label': 'Model preset',
  'byok.model.custom': 'Custom (enter the model / endpoint id from your console)',
  'byok.model.customNote':
    'Custom: enter a model id or an endpoint id (ep-…) that really works in your Ark console',
  'byok.verify.running': 'Checking…',
  'byok.verify.test': 'Test connection',
  'byok.verify.videoNote':
    'Zero cost: it lists models first, then probes with an empty content field to see whether the model is enabled (no task is created)',

  'byok.llm.label': 'Expansion model (text track)',
  'byok.llm.reuseTitle': 'Copy the video-track key into the text track (only when both are the same key)',
  'byok.llm.reuse': 'Reuse video key',
  'byok.llm.custom': 'Custom (enter the address and model yourself)',
  'byok.llm.customNote':
    'Custom: fill in both the base URL and the model name; if left empty the server reports “not configured” rather than picking an address for you',
  'byok.llm.modelPlaceholder': 'model name / endpoint id',
  'byok.llm.keyLabel': 'Expansion API Key',
  'byok.llm.keyPlaceholder': 'Paste your key (optional — without it ✨ is greyed out)',
  'byok.llm.verifyNote': 'Zero cost: sends one minimal chat request with `max_tokens: 1`',
  'byok.llm.transport.before': 'Sent only as the ',
  'byok.llm.transport.after':
    ' header. This service ships **no text-side fallback key** (pure BYOK): empty means “not configured”, and it never silently degrades to rule-based rewriting.',

  'byok.persist.label': 'Store in plain text on this device (localStorage)',
  'byok.persist.warn':
    'Trusted devices only: once ticked, the key stays in the browser in plain text and anyone using this device can read it.',
  'byok.persist.note':
    'Unticked, it only goes into sessionStorage — gone when the tab closes; that is the default and the recommended way.',
  'byok.clear': 'Clear local credentials',
  'byok.save': 'Save',

  'byok.warn.publicPlaintext':
    'Keys cannot be entered over a plain-text public network — use HTTPS (see deployment notes §9-2)',
};
