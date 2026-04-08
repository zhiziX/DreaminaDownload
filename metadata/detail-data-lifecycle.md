# 详情数据生命周期说明

这份文档记录 `page-bridge.js -> content.js -> popup` 的详情数据生命周期，避免后续 AI 再次把 bridge / router / html / DOM 的职责混淆。

## 总体时序

```text
用户切换即梦详情
  -> page-bridge 监听路由变化
  -> page-bridge 尝试从两类来源拿当前详情
     1. 当前页面 router/workDetail
     2. mget_item_info 响应
  -> page-bridge 组装 envelope 并 postMessage
  -> content.js 先用详情层主媒体建立当前详情锁
  -> content.js 过滤列表残留媒体，只保留当前详情主媒体
  -> content.js 收到 jimeng-work-detail
  -> content.js 遍历当前文档里的全部 `_ROUTER_DATA` 候选
  -> 若某个 payload 的 workDetail 命中当前详情：优先采用 document-router
  -> 再补读当前 `window._ROUTER_DATA`
  -> 再补读当前详情页 HTML 提取 `_ROUTER_DATA`
  -> 若 bridge 身份或 signature 命中当前详情锁：作为低优先级补源参与比较
  -> 若 bridge 不匹配：立即失效 bridge
  -> 结构化候选读取会同时覆盖顶层、item.*、value.*、value.item.*
  -> content.js 汇总所有命中当前详情的 workDetail
  -> scanMedia 直接比较最佳图片/视频链接
  -> source 只作为 provenance 展示
  -> 只有全部结构化来源都失败时才退回 DOM
  -> popup / 浮动按钮消费最终单个媒体结果
```

## page-bridge.js 的职责

### 负责什么
- 监听 SPA 路由变化
- 监听 `mget_item_info` 的 fetch / XHR
- 监听主世界 `window._ROUTER_DATA` 的赋值
- 在主世界尽快拿到当前详情 workDetail
- 把结果打包成 envelope 发给 content script

### bridge envelope 字段
- `type`
- `url`
- `workDetail`
- `publishedItemId`
- `detailMediaKey`
- `sourceKind`
- `capturedAt`
- `signature`

### 关键原则
- 不能只因为当前 URL 变了，就把任意 fallback detail 发出去
- 如果 targetId 已知，优先要求 workDetail 身份匹配 targetId
- API 命中时优先视为更实时的 bridge 来源
- 运行时 `_ROUTER_DATA` 一旦切到当前详情，应立即桥接，不必等 content 侧轮询或 HTML 重抓
- 即使首轮路由切换没拿到 detail，导航后的长尾 router probe 也要继续盯一段时间，覆盖延后写入的场景

## content.js 的缓存字段

### `bridgedWorkDetailData`
- 含义：当前 bridge 带来的 workDetail
- 来源：`jimeng-work-detail`
- 风险：最容易混入旧详情
- 失效条件：
  - 路由切换
  - 当前详情 key 变化
  - 身份校验失败
  - TTL 过期

### `documentRouterPayload`
- 含义：当前文档脚本或 `document.documentElement.innerHTML` 里抽出的内联 `_ROUTER_DATA`
- 来源：当前详情页 SSR / 内联脚本
- 作用：在 `window._ROUTER_DATA` 和后续 CSR 逻辑尚未就绪前，优先提供当前详情结构化数据
- 失效条件：
  - 路由切换
  - 当前文档内联数据与当前详情锁不匹配

### `cachedRouterPayloadRef` / `cachedRouterWorkDetail`
- 含义：历史上用来缓存上一次 payload 和对应 workDetail
- 风险：如果 SPA 原地修改同一个 `_ROUTER_DATA` 对象，这层引用级缓存会把旧 detail 锁死
- 当前处理：不再依赖 `payload` 引用相等直接短路，避免同对象内字段更新后仍返回旧 workDetail

### `documentRouterPayloadKey`
- 含义：`documentRouterPayload` 对应的详情锁 cache key
- 用途：避免同一 URL 下 preview -> 正式媒体切换时复用旧文档内联数据

- 含义：当前页面可用的远程/结构化数据缓存
- 可能来源：
  - 已通过身份校验的 bridgedWorkDetail
  - 当前页 HTML 提取的 `_ROUTER_DATA`

### `officialWorkDetailData`
- 含义：官方接口返回的结构化详情
- 当前主要服务 Dreamina
- 这次即梦修复不应破坏这条逻辑

### `lastDetailIdentity`
- 含义：上一次详情身份，Jimeng 优先使用当前详情锁里的 `mediaType:itemId` 或 lock media key
- 用途：区分“真的换了详情”与“同一详情里的主媒体从预览切到正式资源”

### `lastDetailMediaKey`
- 含义：上一次详情主媒体 key
- 用途：在拿不到详情 identity 时，作为次级信号发现详情切换
- 注意：不能单独把它当成最高优先级，否则同一详情里媒体 URL 变化会误触发 reset

### `detailDataHydrated`
- 含义：当前详情的结构化数据是否已尝试 hydrate
- 用途：控制浮动按钮与 refresh 行为
- 当前补充：不要靠 popup 侧等待窗口掩盖问题，真正的修复点仍是主世界和 content 侧更早拿到正确结构化 detail

## 当前决策顺序

### 即梦
1. 先用当前详情层主媒体建立详情锁
2. 过滤 masonry / feed / list / card 等背景残留媒体
3. 先检查当前文档里已内联的 `_ROUTER_DATA` 是否命中当前详情
4. 再检查当前 `window._ROUTER_DATA` 是否命中当前详情
5. 再检查当前详情页 HTML 提取 `_ROUTER_DATA` 是否命中当前详情
6. bridge 只有身份或 signature 命中详情锁且未过期时，才作为低优先级补源参与
7. 若 bridge 不匹配，立即丢弃
8. 结构化候选读取同时覆盖顶层、item.*、value.*、value.item.*
9. 汇总全部命中当前详情的 workDetail 并直接比较最佳正式链接
10. 只有全部结构化来源都失败时才退回 DOM

### Dreamina
1. 官方 `get_item_info`
2. 当前 router / HTML
3. DOM

## 为什么会出现“只有刷新才正常”

因为整页刷新会把这批内存态全部清掉：
- 旧 `bridgedWorkDetailData`
- 旧 `remoteWorkDetailData`
- 旧 `lastDetailMediaKey`

刷新后首屏加载顺序更稳定，bridge 和当前页数据更容易对齐，所以问题被暂时掩盖。

## 后续 AI 固定排查步骤

1. 打开 debug 开关
2. 连续切详情，记录 bridge envelope 的：
   - `publishedItemId`
   - `detailMediaKey`
   - `capturedAt`
3. 对照当前页：
   - URL 的 itemId
   - 当前主图/主视频 key
4. 看 `getCurrentBridgeMatchState()` 是否返回 mismatch
5. 如果 bridge 已被丢弃但仍退 DOM，先查当前文档内联 `_ROUTER_DATA` 是否已经带当前详情且未被采用
6. 再查 `window._ROUTER_DATA` / HTML 补源链是否真的没有当前详情

## 最短结论

这条链路里最危险的不是“拿不到数据”，而是“先拿到旧数据并错误相信它”。

所以后续排查第一优先级永远是：
- 身份是否匹配
- 数据是否过期
- 谁把旧数据提前短路成了当前详情
