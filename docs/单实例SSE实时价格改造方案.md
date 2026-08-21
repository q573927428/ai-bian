# 单实例 SSE 实时价格改造方案

## 1. 目标与边界

本次改造在不引入 Redis 的前提下，让以下三个前端消费者共享实时价格：

1. `CryptoPriceCards.vue`：实时价格、24 小时涨跌幅和成交额。
2. `ActivePositions.vue`：实时当前价、浮动盈亏和收益率。
3. `KLineChartSimple.vue`：实时更新当前 K 线的收盘价、最高价和最低价。

部署边界：Nuxt/Nitro 必须保持单实例、单进程运行。多实例部署时，进程内缓存和 SSE 客户端集合不会跨进程共享，届时必须引入 Redis 或独立行情服务。

## 2. 目标架构

```text
Binance Futures WebSocket（每个服务进程一条连接）
                    |
                    v
       MarketPriceHub（服务端内存单例）
       - 配置交易对统一订阅
       - 最新价格 Map
       - 200ms 增量合并
       - SSE 客户端集合
                    |
                    v
       GET /api/market/prices/stream
                    |
                    v
          botStore（每个标签页一条 SSE）
             /          |          \
     价格卡片        当前持仓       原生 K 线
```

## 3. SSE 协议

接口：`GET /api/market/prices/stream`

事件类型：

| 事件 | 触发时机 | 数据 |
| --- | --- | --- |
| `snapshot` | 客户端首次连接 | 当前全部价格快照 |
| `prices` | 行情发生变化 | 200ms 内合并后的交易对增量 |
| `status` | Binance 连接状态变化 | 连接状态和时间戳 |
| `ping` | 每 20 秒 | 服务端时间戳，用于保持连接和检测僵死连接 |

浏览器原生 `EventSource` 负责断线重连。前端超过 10 秒未收到有效价格后，使用快照接口进行一次兜底拉取；SSE 恢复后停止兜底轮询。

## 4. 服务端实现

新增 `server/utils/market-price-hub.ts`：

- 读取 `bot-config` 中的交易对并统一格式化。
- 同一个交易对只向 `WebSocketManager` 注册一个回调。
- 保存最新价格快照和待广播增量。
- 每 200ms 将增量批量广播给所有 SSE 客户端。
- 客户端断开时只移除 SSE 发送函数，不取消 Binance 行情订阅。
- 配置热重载后调用 `syncSymbols()`，按差异增删上游订阅。

新增 `server/api/market/prices/stream.get.ts`：

- 初始化 `MarketPriceHub`。
- 创建 H3 EventStream。
- 注册 SSE 客户端并立即发送 `snapshot` 和 `status`。
- 定时发送 `ping`。
- 连接关闭时释放定时器和客户端引用。
- 设置禁止缓存及禁用代理缓冲响应头。

现有 `/api/websocket/prices` 保留为兼容及断线快照接口，并改为从同一 PriceHub 获取数据。

## 5. 前端实现

重构 `app/stores/bot.ts` 的价格管理：

- 保留组件订阅者 `Set`，第一个订阅者创建 `EventSource`，最后一个订阅者关闭连接。
- 删除浏览器 `clientId`、交易对订阅列表和 5 秒全量价格轮询。
- `snapshot` 替换价格快照，`prices` 按 symbol 合并。
- 记录 `priceConnectionStatus`、`lastPriceUpdate` 和 `priceStreamError`。
- 断线期间每 10 秒检查一次陈旧状态，必要时请求快照兜底。
- 配置更新后无需由浏览器向 Binance 发起订阅，服务端负责配置同步。

组件保持统一数据源：

- `CryptoPriceCards.vue` 继续从 `botStore.prices` 生成卡片并触发价格动画。
- `ActivePositions.vue` 继续按持仓 symbol 读取 Store，响应式计算浮盈。
- `KLineChartSimple.vue` 继续监听当前 symbol，实时修正当前柱的 `close/high/low`；现有 `last-bar` 轮询继续校正成交量和权威 OHLC。
- TradingView 引擎继续使用自身行情，不接入本 SSE。

## 6. 配置热更新

`POST /api/bot/reload-symbols` 保存新交易对后调用 PriceHub：

- 新增交易对：注册一个统一价格回调并订阅 Binance ticker。
- 删除交易对：取消对应上游订阅，并从 PriceHub 快照移除。
- 向现有 SSE 客户端发送新的 `snapshot`，确保页面立即删除旧交易对。

## 7. 可靠性约束

- PriceHub 初始化必须幂等，多个浏览器并发连接不能重复订阅。
- SSE 广播失败必须隔离到单个客户端，不能中断其他客户端或 Binance 消息处理。
- 200ms 合并窗口用于限制 Vue 更新频率，不能延迟上游缓存写入。
- 服务重启后内存价格为空属于正常冷启动，Binance 首批 ticker 到达后自动恢复。
- 旧订阅/退订接口及其客户端回调管理器在新链路验收后删除，避免形成第二套订阅生命周期。

## 8. 反向代理要求

若使用 Nginx，SSE 路由需要关闭响应缓冲并延长读取超时：

```nginx
location /api/market/prices/stream {
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

应用同时返回 `X-Accel-Buffering: no`，防止 Nginx 聚合事件后再发送。

## 9. 验收标准

- [x] 服务端只有一个 Binance WebSocket 实例。
- [x] 每个交易对在 PriceHub 中只有一个价格回调。
- [x] 一个浏览器标签页只有一条 `/api/market/prices/stream` 请求。
- [x] 三个组件同时挂载不会创建额外 SSE 或价格轮询。
- [x] 真实 Binance 行情能够通过 `prices` 事件在 1 秒内推送。
- [x] 价格卡片、当前持仓和原生 K 线继续共享响应式 `botStore.prices`。
- [x] 原生 K 线当前柱的 `close/high/low` 由实时价格更新。
- [x] 陈旧数据期间快照接口能够读取与 SSE 相同的内存数据源。
- [x] 交易对热重载已接入 `syncSymbols()` 并广播新快照。
- [x] `pnpm typecheck` 和 `pnpm build` 通过。

运行时验收记录（2026-08-21）：生产构建在本地 `3012` 端口启动后，SSE 依次收到 `snapshot`、`status=CONNECTED` 和持续批量 `prices` 事件；`BTCUSDT`、`ETHUSDT` 快照接口与 SSE 数据源一致。用户确认新链路后，旧订阅/退订接口、专用客户端回调管理器及无效测试引用均已删除。
