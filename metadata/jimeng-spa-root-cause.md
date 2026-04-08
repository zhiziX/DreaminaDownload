# 即梦 SPA 详情切换根因记录

这份文档专门冻结“即梦主站详情切换后只剩 `img-currentSrc` / `video-currentSrc`，整页刷新才恢复结构化来源”这次问题的结论，供后续 AI 直接接手。

## 症状

- 从列表或覆盖层切进即梦详情页时，图片常落到 `img-currentSrc`
- 视频常落到 `video-currentSrc`
- 只有整页刷新后，才恢复成 `router-largeImages` / `router-originVideo`
- Dreamina 不受这次问题影响

## 已确认现状

1. DOM 主媒体定位不是主因，当前详情层识别基本正常。
2. 真正的问题出在“当前详情身份”和“结构化数据来源”的竞态。
3. 即梦 SPA 切换时，实时载体不是只靠 `_ROUTER_DATA`，而是：
   - 当前文档 SSR / 内联脚本里的 `_ROUTER_DATA`
   - `mget_item_info`
   - 当前预览 DOM
4. 旧 bridged workDetail 可能会在新 URL 下被提前采用，压过当前页真实结构化数据。
5. 当前详情页的 SSR / 内联脚本常在 CSR 入口真正执行前就已经带着正确 workDetail，但 content 侧未必会先采用它。

## 根因

```text
SPA 切换详情
  -> page-bridge 先收到路由变化并开启 burstSnapshot
  -> 此时页面真实 detail 还没完全切换，bridge 可能抓到旧 workDetail
  -> 旧 workDetail 被按新 URL 发给 content script
  -> content script 如果只按 URL 接受 bridged 数据，或没先采用当前文档里的内联 detail，就把旧详情写进当前缓存
  -> readRouterDataPayload / refreshActiveDetailData 被旧 bridge 提前短路
  -> 当前详情拿不到匹配的结构化数据，或者虽已出现在当前文档 SSR / 内联脚本里却没被及时采用
  -> collectImages / collectVideos 只能退回 DOM currentSrc
```

## 关键证据

### 1. 参考诊断文档

- `E:\AI\jimeng2.md`
- `E:\AI\jiexi.md`

### 2. 关键代码位置

- `github/seedance parser/page-bridge.js`
- `github/seedance parser/content.js`

### 3. 当前已冻结结论

- bridge 数据不能只靠 `url === location.href` 认为可信。
- 必须优先检查当前文档里是否已经内联了当前详情的 `_ROUTER_DATA`。
- 当前详情页的 SSR / 内联脚本可能早于运行时 `window._ROUTER_DATA` 和后续 CSR 逻辑可用。
- 必须同时校验：
  - `publishedItemId`
  - `detailMediaKey`
  - `capturedAt` 是否过期
- 即梦 bridge / 当前文档 / API / router / html 必须做身份优先比较，不能“谁先到先短路”。

## 当前修复方向

已经从“继续堆 bridge/router 时序补丁”切到“DOM-first 当前详情锁 + 最佳链接优先”。

### 来源术语约定

- `router`：当前文档内联结构化来源（如 `_ROUTER_DATA` 片段）
- `router-runtime`：运行时 `window._ROUTER_DATA`
- `html-router`：HTML 文本字段级补源
- `bridge-api`：主世界 bridge / `mget_item_info` 补源
- `source`：只表示 provenance（来源说明），不反向控制选源

### 已做

1. bridge 增加 envelope：
   - `publishedItemId`
   - `detailMediaKey`
   - `sourceKind`
   - `capturedAt`
   - `signature`
2. content 侧新增：
   - `bridgedWorkDetailMeta`
   - `getCurrentBridgeMatchState()`
   - `invalidateBridgedWorkDetail()`
   - 调试日志开关
3. `readRouterDataPayload()` / `refreshActiveDetailData()` 已改成“优先采用当前文档内的 `_ROUTER_DATA`，再比较 `bridge-api` / `router-runtime` / `html-router` 身份”。
4. 新增当前文档结构化提取缓存：
   - `documentRouterPayload`
   - `documentRouterPayloadKey`
5. `page-bridge.js` 新增 `window._ROUTER_DATA` 赋值钩子，运行时一旦写入当前详情 router 数据就立即桥接。
6. popup 主动刷新链路新增短等待窗口，避免 content 在结构化数据刚到前就过早把 DOM fallback 回给 popup。
7. 这条等待窗口已撤回，因为它只会拉长解析时间，不能改变最终仍落到 DOM fallback 的结果。
8. `page-bridge.js` 新增导航后的长尾 router probe，持续检查主世界运行时 `_ROUTER_DATA` 是否在稍后才切到当前详情。
9. 发现 `content.js` 的 `extractWorkDetailFromPayload()` 对同一 payload 对象做引用级缓存；如果 SPA 运行时只原地改写 `_ROUTER_DATA` 内部字段，就会把旧 workDetail 锁死在缓存里。
10. 当前已去掉这层引用级短路，并在 Jimeng 图片页里对“已通过详情身份匹配的 workDetail”放宽 assetKey 过滤，避免 live 预览图 key 和结构化大图 key 不同而提前退回 DOM。
11. 继续收敛后发现，`scanMedia()` 之前把“主媒体 key 变化”直接当成“详情切换”处理，这会把同一详情里从预览图/预览视频切到正式媒体的过程误判成新详情，导致结构化缓存反复被清空。
12. 当前已改成：优先用 `detail identity` 判定是否真换详情；只有在拿不到 identity 的场景下，才退回 media key 变化触发 reset。
13. `content.js` 已改成 Jimeng DOM-first：
   - 先过滤 masonry/feed/list/card 等背景残留媒体
   - 再按 detail 容器、fixed/sticky、视口中心距离、面积排序锁定唯一主媒体
   - 从主媒体提取 lock signatures（URL、assetKey、video groupKey）
   - 结构化来源只有命中当前详情锁时才允许进入比较
14. 继续排查后确认，`extractCurrentDocumentRouterPayload()` 之前只取首个 `_ROUTER_DATA` 的 script/html 片段；SPA 下首个命中的常常还是旧 payload，后续真正对应当前详情的 payload 被直接遮住。
15. 继续排查后确认，结构化候选提取层对 `workDetail.item.*` / `workDetail.value.item.*` 覆盖不足，出现过“workDetail 身份已命中当前详情，但 `largeImages` / `coverUrlMap` / `originVideo` 仍取空”的情况。
16. 当前改法已进一步收敛为：Jimeng 文档结构化提取改成“遍历全部 `_ROUTER_DATA` 候选并返回第一个匹配当前详情的 payload”，同时补齐 `item.*` / `value.*` 下的图片视频字段读取；`lock-missing` 不再直接封死结构化来源，图片链路也不再在 html/document 命中后做 strict 二次拦截。
17. 本轮继续改成“最佳链接优先”：Jimeng 不再只盯单个 router payload，而是把当前文档、`router-runtime`、`html-router`、`bridge-api` 里所有命中当前详情的 workDetail 汇总后统一比较最佳图片/视频链接。
18. `source` 现在只保留 provenance 语义，不再反向控制选源；`router-largeImages` / `router-originVideo` 这些标签只是说明链接来自哪条结构化链路。
19. 继续对照 `github/jimeng/content.min.js` 后确认，seedance parser 之前仍少了一条关键兜底：当 `_ROUTER_DATA` 文本整体不可稳定 `JSON.parse` 或结构化 payload 没及时命中时，需要直接对当前文档原始 HTML 文本做字段级正则提取，直接抓 `originVideo` / `transcodedVideo` / `playAddr` / `itemUrls` / `largeImages` / `coverUrlMap` / `coverUrl`，否则从列表页跳详情页时仍会过早跌回 `img-currentSrc` / `video-currentSrc`。
20. 继续验证后确认，即梦图片的 `largeImages` / `coverUrlMap` 命中并不等于“可直接下载”；部分链接需要在下载侧继续尝试去掉 `~tplv-*` 变体、补回原始扩展名、再补 `~tplv-noop.image`，否则会出现“解析结果稳定但下载失败”的假阳性。
21. 继续测试后确认，图片解析已能稳定到 `raw-text-coverUrlMap-2400`（未刷新）和 `router-coverUrlMap-4096`（刷新后），说明当前主矛盾已从“解析不到结构化字段”切到“命中的 `byteimg/tplv` 图片链接仍然无法下载”。当前已尝试：下载候选扩展、去变体、补 referer 规则、background 主动透传 `pageUrl -> referer`，但用户实测仍失败。
22. 当前最新未解卡点：
   - 即梦图片：结构化链接能拿到，但下载失败，疑似仍需新的可下载图片源或更精确的下载侧诊断。
   - 即梦视频：从列表页进入详情仍常退到 `video-currentSrc`，刷新后才到 `router-originVideo`，这条链路还没进入下载验证阶段。
   - 未刷新进入详情页时偶发“页面脚本未响应”，需继续缩小触发范围。

### 已明确无效的方案

- bridge-first / URL-only cache：旧 detail 仍会在新 URL 下抢先短路。
- document-router 优先但没有当前详情锁：仍可能被同页旧结构化数据误命中。
- 长尾 router probe：只能补晚到数据，不能解决“当前详情是谁”。
- popup 等待窗口：只会拖慢解析。
- 只取首个 `_ROUTER_DATA` script/html：旧 payload 会遮住后续当前详情 payload。
- 结构化候选读取只覆盖顶层或部分 `value.*`：会出现 detail 命中了但字段仍取空。
- 继续追 `router-largeImages` / `router-originVideo` 旧标签：这些标签本身不是目标，继续追标签会把 attention 放错到 provenance，而不是最佳链路。
- 先建锁再允许结构化来源进入：首帧锁未稳定时会把当前文档已存在的正确结构化数据挡在外面。
- html/document 命中后再做 strict 二次校验：会把已经命中的正式资源再次打回 DOM。
- strict assetKey / groupKey 硬过滤：预览资源和正式资源 key 不一致时，会把当前详情的结构化候选误杀。
- 只依赖 `_ROUTER_DATA` 文本整体 `JSON.parse`：一旦当前页 HTML 文本里字段已出现但 payload 片段不完整、转义形式不同或命中时机偏晚，仍会直接跌回 `currentSrc`。

### 仍需重点验证

1. 图片 A -> 图片 B 连切时，最终是否稳定拿到结构化最佳链接，而不只是停在 `img-currentSrc`。
2. 视频 A -> 视频 B 连切时，最终是否稳定拿到 `originVideo` 或最佳 `transcodedVideo`，而不只是停在 `video-currentSrc`。
3. 快速连点时，preview -> 正式媒体切换是否还会触发错误 reset。
4. 当前详情确实没有结构化候选时，是否才会稳定落到 `img-currentSrc` / `video-currentSrc`。
5. source 展示是否能正确区分 `router` / `router-runtime` / `html-router` / `bridge-api`，但又不反向影响最终选源。

## 排查顺序

1. bridge 日志：
   - `navigation`
   - `publish-work-detail`
   - `publish-api-work-detail`
2. content 日志：
   - `receive-bridged-work-detail`
   - `read-router-payload`
   - `refresh-active-detail-data-*`
   - `invalidate-bridged-work-detail`
3. 对比这几个字段是否一致：
   - 当前 URL 对应 `publishedItemId`
   - 当前主媒体 `detailMediaKey`
   - bridge envelope：`publishedItemId`
   - bridge envelope：`detailMediaKey`
4. 如果 bridge 身份不一致但仍被采用，继续修 `handleBridgedWorkDetail()` / `refreshActiveDetailData()`。
5. 如果 bridge 已被正确丢弃但还是落到 DOM，继续查当前页 `_ROUTER_DATA` / HTML 是否真的没有当前详情。

## 已排除项

- 不是 popup 单独缓存导致
- 不是浮动按钮逻辑导致
- 不是单纯 DOM 主元素选错导致
- 不是 Dreamina 逻辑导致

## 下一位 AI 接手先读这里

先读：
1. `github/seedance parser/metadata/jimeng-spa-root-cause.md`
2. `github/seedance parser/metadata/detail-data-lifecycle.md`
3. `github/seedance parser/解析策略.md`
4. `github/seedance parser/content.js`
5. `github/seedance parser/page-bridge.js`
6. `github/seedance parser/background.js`
7. `github/seedance parser/rules/referer.json`

推荐开始顺序：
1. 先不要再追 bridge/router 时序；图片主矛盾已经收敛到“结构化链接能拿到，但下载失败”。
2. 先复现图片详情页单点进入场景：
   - 未刷新：当前常见结果：`raw-text-coverUrlMap-2400`
   - 刷新后：当前常见结果：`router-coverUrlMap-4096`
   - 两者用户实测都下载失败
3. 优先查下载链，不要继续围着 source 标签打转。
   - `background.js`：`buildImageUrlCandidates()`
   - `fetchBlob()`
   - `rules/referer.json`
   - 真正需要的是“哪条图片 URL 可下载”，不是“标签看起来更像 router”。
4. 视频问题单独处理：从列表页进入详情常落到 `video-currentSrc`，刷新后才到 `router-originVideo`，不要和图片下载问题混在一起一起改。
5. “页面脚本未响应”是独立问题，先缩小触发范围，再决定是不是要改 refresh / hydration / message 时机。

明确不要重复的方向：
- 不要再回到 bridge-first / URL-only cache
- 不要再把 `router-largeImages` / `router-originVideo` 当成最终目标
- 不要再只靠 `_ROUTER_DATA` 整体 `JSON.parse`
- 不要再只看 source 标签层面的切换，不验证下载是否真的成功

当前最值得直接做的验证：
- 记录 `background.js` 每个图片 candidate 的失败原因，确认到底是 `downloads.download` 失败、`fetch` 403/401、CORS、还是 URL 本身无效
- 单独验证 `coverUrlMap` / `coverUrl` / `largeImages` 哪一层里存在真正可下载的链接
- 再处理视频为何仍退 `video-currentSrc`

## 2026-04-07 本轮试错记录（图片下载链优先）

### 本轮改动

1. `background.js` 的图片下载链改成“逐层候选 + 逐变体 + 双通道诊断”：
   - `downloadImage()` 统一先走 `fetch+blob`，逐候选记录失败原因；不再在图片链路做 direct 回退（避免下载器反复闪烁假文件）
   - 逐候选记录：
     - 候选来源（`source`）
     - 变体类型（`original` / `strip-variant` / `strip-variant+noop` / `strip-variant+ext` / `strip-variant+ext+noop`）
     - 通道结果（`fetch`、`downloadBlob`）
2. `fetchBlob()` 失败原因改为结构化：
   - HTTP 状态（例如 `http-403` / `http-401` / `http-404`）
   - CORS/网络（`cors-or-network`）
   - URL 无效（`invalid-url`）
   - 空资源（`empty-blob`）
3. 增加 background 诊断接口：
   - `action: 'getDownloadDiagnostics'`：读取最近下载诊断（默认最近 20 条）
   - `action: 'clearDownloadDiagnostics'`：清空诊断缓存
4. `content.js` / `popup.js` / 浮动按钮下载消息新增透传字段：
   - `source`
   - `extraImageCandidates`
5. `content.js` 在图片页新增“下载探针候选池”：
   - 将 `coverUrlMap` / `coverUrl` / `largeImages` / DOM 的可用候选（按现有比较规则排序）一并下发给 background
   - 目标是让 background 直接验证“哪一层存在真正可下载链”，不再只盯单条已选 URL

### 当前结论

- 本轮先做的是“把失败点显式化 + 把候选层验证能力打通”，不是继续追 bridge/router 时序。
- 若图片仍失败，下一步应直接看诊断里每条 candidate 的失败码分布，再决定是：
  - referer/鉴权问题（高频 `http-403/401`）
  - CORS/网络路径问题（高频 `cors-or-network`）
  - URL 质量问题（高频 `invalid-url` / 仅个别层可成功）

### SPA 场景补充（不依赖整页刷新）

1. `content.js` 的 `hasMatchingRouterData()`（Jimeng）已从“只要有 payload 就算命中”改为：
   - 图片：必须存在可用结构化图片候选（`largeImages/coverUrlMap/coverUrl`）
   - 视频：必须存在可用结构化视频候选
2. 新增“图片画质升级探测窗口”（针对 Jimeng 图片）：
   - 详情切换后 5 秒内，若当前仍是 DOM 源或低质量结构化源，会继续触发 `refreshActiveDetailData({ force: true })`
   - 一旦命中高质量结构化候选（优先 `coverUrlMap-4096` / `largeImages`）立即停止探测
   - 目标是覆盖 SPA 里“首帧只有预览图，稍后才补齐高质量结构化字段”的时序
3. 背景下载链新增“文本假图拦截”：
   - `fetchBlob` 对图片强制校验 MIME/文件签名（拒绝 `text/plain` / `html` / `json` 等）
   - 并补充真实图片尺寸探测（PNG/JPEG/WebP/GIF），下载文件名按真实尺寸修正，避免 URL 标注与实际像素不一致
4. 已回滚“synthetic-4096”展示链路：
   - 不再生成 `raw-text-coverUrlMap-4096-synthetic`
   - 画质升级探测窗口内 `raw-text-*` 来源不会提前判定成功，会继续等待真实结构化高质量来源

### 使用方式（给下一位 AI）

1. 复现一次图片下载失败后，在 background 侧执行：
   - `chrome.runtime.sendMessage({ action: 'getDownloadDiagnostics', limit: 20 })`
2. 重点看每个 trace 的：
   - `selectedSource`
   - `winner`（若成功）
   - `candidates[].source` 及 `candidates[].variants[].attempts[]`
3. 直接统计 `coverUrlMap` / `coverUrl` / `largeImages` 三层谁成功率最高，再决定是否调整图片选源权重或下载前置探测策略。

## 2026-04-07 对照参考（jimengpro）与本轮修正

### 参考项

- `E:\AI\github\jimengpro`

### 参考后确认的结论

1. `jimengpro` 图片链路非常直接：主要基于当前可见主媒体 + `downloads.download`（或 canvas 导出），没有复杂的结构化候选回放与多轮校验。
2. 这说明“下载链可靠性优先”的方向是对的，但不能把它的简单链路原样照搬到 seedance parser。
   - 它不处理我们当前的 SPA 结构化选源、来源优先级和跨候选诊断需求。

### 本轮避免重复错误后的调整

1. 回滚“只走 fetch+blob 且无兜底”的过度收紧：
   - 继续保留 `fetch+blob` 的严格图片校验（防 `.txt` 假图）。
   - 新增“少量 direct 兜底队列”（最多 4 条），仅在可疑但可能被浏览器直链放行的错误码下触发（如 `cors-or-network`、`http-*`、`unexpected-content-type`）。
   - 这样避免回到早期“每个变体都 direct 重试导致下载器狂闪”的失败模式。
2. 保留“真实像素探测后修正文件名”：
   - 防止文件名标注与实际尺寸不一致造成误判。
3. 明确不再重复的方法：
   - 不回到“无上限 direct 变体重试”
   - 不回到“只看 source 标签不验下载”
   - 不回到“synthetic 标签驱动最终判断”
4. 新增防回退规则（避免下载 `.htm/.txt` 假图）：
   - direct 兜底仅在 `cors-or-network / request-failed` 下触发
   - `unexpected-content-type` 与 `http-*` 不再进入 direct 兜底
   - `raw-text-*` 来源禁止 direct 兜底
   - 目的：避免“fetch 已识别非图片，direct 又把 HTML 下载下来”的重复错误
5. 提升首跳结构化命中（不改 bridge/router 时序）：
   - `extractImageCandidatesFromRawText()` 的 itemId 片段窗口从 `12000` 扩到 `60000`
   - 在 itemId 片段命中但候选仍为空时，增加一次全量 `normalized` 回扫
   - raw-text 锁过滤从“总是启用”改为“仅在 itemId 存在时启用”，避免 preview key 与正式 key 不一致导致误杀 4096/2400 候选
6. 新增“首帧 HTML 原文补抓候选”：
   - 在图片画质探测窗口内，`refreshActiveDetailData()` 不再被 document/bridge 提前短路，会继续执行一次 `fetch(location.href)` 获取当前 URL HTML
   - 将该 HTML 做字段级提取，生成 `html-raw-text-coverUrlMap-* / html-raw-text-coverUrl / html-raw-text-largeImages` 候选并加入图片比较
   - 目的：覆盖“当前文档 raw-text 只有 2400，但该 URL 服务的 HTML 已含 4096”的首跳场景
7. 新增“Jimeng API 主动探测补源”（不改 bridge 时序）：
   - 在首跳图片探测窗口内，主动请求 `/mweb/v1/mget_item_info`（尝试 `item_id/itemId/item_ids`）并抽取 workDetail
   - 提取到的 workDetail 以 `api-probe-*` 来源并入结构化候选池参与同一套比较
   - 目标：覆盖“首帧 document/raw-text 仅有 2400，4096 只在异步 API 响应里出现”的场景
8. 新增“隐藏 iframe 首跳探针”（不弹 tab）：
   - 首跳图片探测窗口内，创建同页隐藏 iframe（`display:none` + 自动移除），加载当前详情 URL
   - 从 iframe 文档提取 `_ROUTER_DATA` 与 raw-text，分别作为 `iframe-router-*` / `iframe-raw-text-*` 候选并入比较池
   - 目的：在不打断用户页面、不刷新主页面的情况下，模拟完整文档路径获取 4096 字段
9. 新增“真实分辨率探测替换”（不依赖 URL 字符串）：
   - content 侧在首跳出现 `raw-text-* / img-*` 低质候选时，调用 background `resolveImageCandidates`
   - background 对候选做实际 fetch + 图片头解析（PNG/JPEG/WebP/GIF），返回真实宽高最大的可用链接
   - 仅当真实分辨率确实高于当前候选时才替换显示，避免再次出现“URL 看起来 4096，实际仍 2400”的假提升
10. 收口策略：列表页 -> 详情首跳自动硬导航一次（绕过 SPA）：
   - 在 `handlePageChange/syncPageState` 检测到“上一页非详情、下一页为 Jimeng 详情”时，执行 `window.location.replace(nextUrl)`
   - 使用 `sessionStorage` 防循环键（TTL 20s），同一详情短时间内最多触发一次
   - 目标：直接走你手动刷新后的稳定链路，优先保证“首跳拿到 4096”的成功

## 2026-04-08 收口确认（已成功）

### 最终采用方案（必须保留）

1. 列表页 -> 详情页首跳命中 Jimeng 详情路由时，强制执行一次硬导航（`window.location.replace(nextUrl)`），不走新标签页。
2. 使用 `sessionStorage` 防循环键（TTL 20s），同一详情短时间最多触发一次，避免循环刷新。
3. 目标是直接走“你手动刷新后”的稳定链路：首跳即拿到结构化高质量资源。

### 用户实测结果

- 图片：首跳可到 `router-coverUrlMap-4096`
- 视频：首跳可到最高质量结构化视频链接（不再依赖刷新）

### 本轮代码精简（去除已验证无效试错）

1. `content.js` 已移除：
   - `extractImageCandidatesFromRemoteHtml()`
   - `extractImageCandidatesFromIframeRaw()`
   - `refreshIframeProbeData()`
   - `maybeStartImageResolutionProbe()` 的调用残留
   - `getStructuredRouterPayloadEntries()` 中 `iframe-router` / `api-probe` 残留入口
   - `refreshActiveDetailData()` 里 `jimengApiProbe/iframeProbe/remoteHtmlRawText` 相关分支与状态清理
2. `background.js` 已移除：
   - `resolveImageCandidates` message/action 分支
   - `resolveImageCandidates()` 方法
   - 仅为该方法服务的 `withTimeout()`
   - 未使用的 `delay()` 与 `buildImageUrlCandidates()`

### 明确不再回退的失败方向

- 不再回到 bridge-first / URL-only cache
- 不再追求 `router-*` 标签本身而忽略可下载性
- 不再恢复 iframe/api-probe/分辨率探测这批分支
- 不再引入 tab 的方式（保持页面行为优雅）

### 后续优化建议（在成功基础上做）

1. 先观察 2~3 轮真实使用，确认首跳 4096 和视频最高质量稳定。
2. 若仍有个别异常，再做针对性小改，不再做大范围时序试错。

### 2026-04-08 二次优化（仅即梦，不影响 Dreamina）

1. `content.js` 增加即梦 raw-text 候选缓存：
   - 视频 raw-text 候选按当前详情键缓存，避免每次 `scanMedia()` 重跑整段正则
   - 图片 raw-text 候选按详情键一次构建三层（`coverUrlMap/coverUrl/largeImages`）并复用
2. `collectImages()`（即梦分支）改为“结构化候选一次收集、三层复用”，避免同一轮扫描重复三次深层遍历。
3. 本次是性能/稳定性优化，不改变选源优先级与首跳硬导航策略，不影响 Dreamina 现有稳定链路。

### 2026-04-08 三次精简（仅即梦）

1. 删除无引用方法：`collectImageCandidatesFromRouterData()`、`extractRouterDataFromText()`。
2. `collectImageCandidatesForLevel()` 去掉 Jimeng 分支，保留 Dreamina/非即梦路径所需逻辑。
3. `scanMedia()` 对即梦不再额外调用 `hasMatchingRouterData()` 做重遍历预判；改为使用本轮选中结果 source 判断是否需要继续 hydration（`router` / `router-runtime` / `html-router` / `bridge-api` / `official` 视为结构化可靠来源）。
4. 本轮未改 Dreamina 策略与下载链，仅做减重与重复计算削减。

## 2026-04-08 四次精简（代码减重）

### 删除内容

1. `imageQualityProbeDeadline` / `imageQualityProbeAttempts` 字段及 `beginImageQualityProbe()` / `isHighQualityStructuredImageItem()` / `maybeContinueImageQualityProbe()` 三个方法 — 硬导航后首跳直接拿到高质量资源，探测窗口无意义。
2. `remoteWorkDetailData` / `remoteWorkDetailKey` / `remoteWorkDetailPromise` 字段及所有读写点 — 硬导航后 document payload 直接命中，这层 remote 缓存是冗余中间层。
3. `shouldForceHtmlProbe` 分支 — 依赖 `imageQualityProbeDeadline`，随探测窗口一起删。
4. `jimengStructuredEntriesCache` / `jimengStructuredEntriesCacheKey` / `jimengStructuredEntriesCacheAt` 字段及缓存逻辑 — 硬导航后每次都是新页面，250ms TTL 缓存命中率极低。
5. `page-bridge.js` 的 `routerProbeTimers` / `clearRouterProbes()` / `scheduleRouterProbeBurst()` — 长尾 router probe，硬导航后不需要。
6. `pickPreferredImageCandidate()` / `buildImageDownloadProbeCandidates()` 两个单行包装方法 — 内联到调用处。

### `refreshActiveDetailData` 简化

去掉 promise 包装层、remote 缓存短路、forceHtmlProbe 分支，流程收敛为：
`document → bridge → fetch HTML`

## 2026-04-08 上下页按钮丢失问题与试错记录

### 问题

硬导航（`window.location.replace`）后，即梦详情页的上下页导航按钮消失。原因：即梦 SPA 的上下页按钮依赖列表页路由上下文（相邻作品 ID、history state），硬导航清空了整个 JS 运行时，这些状态全部丢失。

### 试错方案 A：SPA 导航 + content script 并发 fetch HTML（失败）

- 删掉硬导航，`handlePageChange` 后并发 `fetch(nextUrl, { cache: 'no-store' })` 拉 HTML
- 结果：fetch 拿到的 HTML 里 `coverUrlMap` 只有 2400，不含 4096
- 结论：服务端对普通 fetch 请求返回低质量版本，只有真实浏览器硬导航才能拿到 4096
- 已回滚

### 试错方案 B：background 代理 fetch HTML（失败）

- background script 用完整 cookie 上下文 fetch 详情页 HTML
- 第一轮：`location.href !== targetUrl` 严格校验导致 payload 被拦截，结果 2400
- 第二轮：改为 itemId 校验，结果仍 2400，上下页按钮消失
- 第三轮：禁用硬导航，改 `refreshActiveDetailData` 里的 fetch 走 background 代理（`credentials: include`）；结果 `coverUrlMap= undefined`，HTML 里无结构化数据，且触发死循环（`scheduleDetailHydration` 反复调度）
- 结论：background fetch 与 content fetch 行为一致，服务端通过 `Sec-Fetch-*` / `User-Agent` 等请求头区分真实浏览器导航，对所有 fetch 请求均返回低质量版本，不含 4096；cookie 是否携带不影响结果
- 已回滚

### 明确无效的方向

- content script 直接 fetch 详情页 HTML：服务端返回 2400，不含 4096
- background script 代理 fetch 详情页 HTML：与 content fetch 行为一致，均返回 2400；携带 cookie 无效
- 硬导航 + 注入返回按钮：治标不治本，上下页仍然没有

### 参考项目对照结论

- `jimengpro`：用 canvas 导出当前可见 img，不做结构化提取，无参考价值
- `jimeng`（大瑜）：通过自建后端服务器 `https://www.aluowang.top/api/cover-url-maps?url=...` 中转获取 4096，是付费服务；纯客户端无法复现此路径
- 结论：**纯客户端唯一能稳定拿到 4096 的方式是硬导航**

## 2026-04-08 generate 页面支持

### 页面特征

- URL 固定：`/ai-tool/generate?workspace=0`，不随弹窗切换变化
- 弹窗容器：`.lv-modal-wrapper` / `.lv-modal-content`
- 列表 API：`get_user_local_item_list`，不返回 `coverUrlMap`，无法升级到 4096
- 图片 URL 带签名（`x-expires` / `x-signature`），变体替换会 403

### 实现方案

- `getPageStrategy()` 新增 generate 路由识别：检测 `.lv-modal-wrapper` 是否存在，存在则 `supported: true, isGeneratePage: true`
- `scanMedia()` 对 `isGeneratePage` 走 `collectGenerateModalMedia()`，跳过结构化 hydration
- `collectGenerateModalMedia()`：直接从弹窗 DOM 取主 `img`/`video` 的 `currentSrc`
- 弹窗切换由现有 MutationObserver 覆盖，无需额外监听
- 只能下载 DOM 显示的 2400 版本，无法升级到 4096

## 第三方服务器升级方案（备用，未实现）

### 参考来源

`github/jimeng`（大瑜）通过自建后端服务 `https://www.aluowang.top/api/cover-url-maps` 实现 4096 升级。

### 实现原理

1. 客户端从详情页 URL 提取 `item_id`
2. `GET /api/cover-url-maps?url=<详情页URL>` 发给自建服务器
3. 服务器用无头浏览器（Puppeteer/Playwright）或维护的登录 cookie 池真实访问即梦详情页
4. 从页面 HTML 的 `_ROUTER_DATA` 中提取 `coverUrlMap`，缓存后返回 `{ coverUrlMaps: { "4096": "...", "2400": "..." } }`
5. 客户端直接用返回的 4096 链接下载

### 实现要点

- 服务器需维护有效的即梦/Dreamina 登录 cookie（定期刷新）
- 无头浏览器需模拟真实导航（非 fetch），否则服务端仍返回 2400
- 可加结果缓存（按 item_id 缓存，TTL 视链接有效期而定）
- 即梦图片链接带签名（`x-expires`），缓存 TTL 不能超过签名有效期

### 适用场景

- generate 页面图片升级到 4096（当前只能拿 2400）
- 其他无法硬导航的场景

## 2026-04-08 UI 与体验优化

### popup 画质标签

- `来源：${source}` 改为用户友好的画质标签（`getQualityLabel`）
- 标签逻辑：优先从 URL 提取尺寸数字（`aigc_resize:Xxxx`），再按 source 关键词匹配
- 原图（`coverUrlMap-0` / `aigc_resize_0_0`）显示"原图"
- DOM 回退显示"标准画质"，不再出现"预览"字眼

### 文件名优化

- `buildFilename` 优先取详情页 DOM 标题/提示词前15字作为文件名
- 图片提示词选择器：`[class*="prompt-value-text"]`
- 视频标题选择器：`[class*="title-wrapper"]`
- 扩展名从 URL 动态推断（webp/mp4 等），不再硬编码 `.jpg`

### coverUrlMap-0 原图修复

- `coverUrlMap` 排序：键为 `0` 视为原图（Infinity），排在 4096 之前
- `getImageSourcePriority`：`coverUrlMap-0` sizeBonus=10，优先级高于 4096
- raw-text 正则：`\d{2,5}` 改为 `\d{1,5}`，能匹配键为 `"0"` 的原图条目

## 2026-04-08 五次精简（代码质量与 UI 优化）

### content.js

1. 修复 `getPageStrategy()` 中 `siteLabel` 乱码（`'鍗虫ⅵ'` → 复用 `getCurrentSiteLabel()`）
2. 合并 `collectImages()` 末尾即梦/非即梦两条路径的重复 normalize+select+buildProbe 逻辑为统一路径
3. 修复 16 个方法的缩进不一致（方法体缺少 4 空格前导缩进）
4. 清理文件末尾多余空行

### background.js

1. 删除 `fetchDetailHtml()` 方法及其 message handler — 已在试错方案 B 中确认无效（服务端对 fetch 请求均返回 2400），无任何调用方

### page-bridge.js

1. 优化 `window.fetch` 拦截：不需要检查的 URL 直接返回原始 promise，避免不必要的 async 包装开销

### popup.js

1. 下载失败时显示具体错误信息（截取前 12 字），不再只显示"失败"两字
