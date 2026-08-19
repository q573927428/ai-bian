# 全市场 USDT 永续异动雷达改造方案

> 文档状态：设计稿（基于 2026-08-19 当前源码复核）  
> 适用项目：`binance-futures-bot`  
> 核心目标：扫描 Binance 全部 USDT 永续合约，通过流动性、未完成 K 线预计成交额、主动成交净流入、价格变化和多窗口 OI 变化筛选候选，最后仅将少量高质量候选交给现有策略、AI 和交易风控闭环。

> 复核边界：当前 worktree 不包含运行时 `data/`、策略实例和历史日志。本文已核对源码调用关系、默认配置和已有接口，但生产环境实际 symbol 数量、启用策略、AI provider 配额及历史性能仍需在阶段 0 采集基线后确认。

## 1. 文档目标与需求口径

### 1.1 业务目标

系统需要形成如下闭环：

1. 每 12 小时获取 Binance USDⓈ-M Futures 全量合约。
2. 只保留处于交易状态的 USDT 永续合约。
3. 剔除 24 小时 USDT 成交额小于 `10,000,000` 的交易对。
4. 实时监控未完成 K 线，根据周期进度估算整根 K 线最终成交额。
5. 识别预计成交额相对历史完整 K 线显著放大的交易对。
6. 对候选交易对计算当前 OI 相对 `5m`、`15m`、`1h`、`4h` 的变化。
7. 同时计算对应窗口的价格变化和主动成交净流入。
8. 使用本地确定性规则完成方向分类、评分、排序和去重。
9. 只将 Top N 候选交给现有策略和 AI 终审。
10. 通过现有仓位互斥、日交易限制、风险管理、下单、持仓监控和平仓模块完成交易闭环。

### 1.2 口径假设

本文将“筛选 24 小时交易额小于 10000000 的交易对”解释为：**剔除小于 `10,000,000 USDT` 的交易对，保留大于等于该阈值的交易对**。

“净流入”定义为基于成交主动方的代理指标，而不是真实链上充值或交易所资金净流入：

```text
主动买入成交额 = takerBuyQuoteVolume
主动卖出成交额 = quoteVolume - takerBuyQuoteVolume
主动成交净流入 = 主动买入成交额 - 主动卖出成交额
                 = 2 * takerBuyQuoteVolume - quoteVolume
净流入比例 = 主动成交净流入 / quoteVolume
```

该指标表达市场主动买卖力量，不能命名为链上资金净流入。

### 1.3 非目标

本次改造不包含：

- 重写现有下单、止损、止盈和持仓监控模块。
- 让 AI 直接遍历全市场。
- 订阅全市场逐笔成交或全量深度数据。
- 一次性删除现有 REST K 线同步链路。
- 在没有影子运行和回放验证前直接启用真实自动交易。

## 2. 当前项目结构与职责

### 2.1 顶层结构

| 目录 | 当前职责 | 与本次改造的关系 |
|---|---|---|
| `app/` | Nuxt/Vue 前端、策略编辑、行情卡片、性能面板 | 后期增加雷达状态与候选列表 |
| `server/api/` | Bot、策略、K 线、WebSocket、热门交易对等 HTTP API | 新增雷达查询、刷新与健康状态 API |
| `server/plugins/` | Nitro 启动插件 | 新增雷达编排插件，并调整启动依赖 |
| `server/modules/` | 策略、指标、K 线同步、仓位、风控核心模块 | 新增独立 `market-radar` 模块 |
| `server/utils/` | Binance、AI、限流、存储、WebSocket 等基础设施 | 复用限流器，逐步抽取共享数据解析逻辑 |
| `types/` | 全局类型、策略类型、K 线和 WebSocket 类型 | 新增雷达领域类型，补齐成交额字段 |
| `docs/` | 设计和运行文档 | 本文作为实施基线 |
| `test/` | 当前零散脚本测试 | 增加可自动执行的单元、集成与负载测试 |

### 2.2 当前启动闭环

当前源码体现的启动顺序如下：

```text
Nitro 启动
  -> kline-sync 插件初始化 kline.db
  -> 从 bot-config.symbols 创建 KLineSimpleSyncService
  -> 检查 6 个周期的数据是否缺失
  -> 对缺失交易对做历史回填
  -> 对全部交易对 × 6 周期做一次增量同步
  -> strategy-manager 等待 K 线同步 ready
  -> 初始化 BinanceService 和 BinanceApiGateway
  -> 初始化 IndicatorsHub
  -> 从本地加载全部配置交易对 K 线
  -> 逐交易对获取当前 OI
  -> 初始化 PositionManager
  -> 初始化 StrategyEngine / StrategyManager
  -> 加载激活策略并注册指标组合
  -> 首轮指标预计算
  -> 启动 IndicatorsHub 每分钟刷新
  -> 启动指标预计算定时器
  -> 启动 K 线周期同步和 2 分钟高频 REST 同步
  -> 延迟启动持仓监控与首次策略扫描
```

关键事实：`bot-config.symbols` 当前同时承担 K 线同步白名单、指标初始化列表、前端展示列表和策略交易对来源。若直接写入全部 USDT 永续合约，所有下游负载都会一起扩大。

### 2.3 当前策略扫描闭环

`StrategyEngine` 当前按照运行策略的最短周期启动全局扫描，最短扫描周期被限制为 5 分钟：

```text
到期策略
  -> 按 symbol 聚合
  -> 每批处理若干 symbol
  -> 每个 symbol 构建一次 MarketSnapshot
  -> REST fetchTicker 获取当前价格
  -> 读取本地 K 线
  -> 读取预计算指标，缺失时实时计算
  -> 对同一 symbol 的策略逐个串行分析
  -> 本地预筛
  -> AI 调用
  -> 阈值、风险、仓位冲突检查
  -> 下单和持仓记录
```

现有优化点是同一交易对共享快照；现有瓶颈是同一交易对的多个策略仍逐个调用 AI，并且全量 symbol 扫描不是事件驱动。

## 3. 当前能力复核

### 3.1 可以直接复用的能力

1. `server/api/binance/top-symbols.get.ts`
   - 已能获取 `exchangeInfo`。
   - 已能过滤 `PERPETUAL`、`TRADIFI_PERPETUAL`、USDT 和 `TRADING` 状态。
   - 已能获取全量 `ticker/24hr` 的精确 `quoteVolume`。
   - 目前属于页面请求 API，不是后台常驻 universe 服务。

2. `server/utils/binance-rate-limiter.ts`
   - 已提供 market/account/trade 三组队列。
   - 已支持并发限制、请求去重、429/418 降级和队列超时统计。
   - 可作为 universe 刷新、缺口修复和 OI 轮询的统一 REST 闸门。

3. `server/utils/websocket.ts`
   - 已支持动态订阅 `@ticker` 和 `@kline_<interval>`。
   - 已支持 combined stream 消息解包、心跳、重连和事件分发。
   - 目前主要面向前端客户端生命周期，不满足核心雷达的订阅状态和恢复要求。

4. `server/utils/ai-pre-screen.ts`
   - 已实现未完成 K 线进度计算后的简单预计成交量判断。
   - 当前使用基础币成交量和简单线性外推，需要升级为 USDT 成交额和稳健基准。

5. `IndicatorsHub`
   - 已具备 K 线缓存、技术指标缓存、当前 OI 和历史 OI 获取能力。
   - 适合继续服务少量策略交易对，不适合直接承担全市场高频雷达。

6. `PositionManager`、`DailyTradeLimiter`、`StrategyPositionMonitor`、`StrategyPositionCloser`
   - 继续作为交易执行后的安全闭环，不需要在第一阶段重写。

7. `/api/bot/performance` 与 `/api/bot/rate-limit`
   - 已暴露内存、并发池、Binance 队列、策略循环、预计算和 AI 状态。
   - 可扩展雷达指标，而不是重新建立一套监控入口。

### 3.2 当前实现与目标的关键差距

| 编号 | 差距 | 影响 | 优先级 |
|---|---|---|---|
| G1 | `bot-config.symbols` 与 K 线、指标、策略强耦合 | 全市场列表会触发所有模块线性扩容 | P0 |
| G2 | K 线只存 `volume`，没有 `quoteVolume` | 无法统一比较不同币种的 USDT 成交额 | P0 |
| G3 | 未保存 `takerBuyQuoteVolume` | 无法计算主动成交净流入 | P0 |
| G4 | 全部周期最后一根 K 线每 2 分钟通过 REST 更新 | 200 个 symbol 时单轮需要 800 次请求 | P0 |
| G5 | K 线 WebSocket 重连只恢复 `@ticker` | 断线后 K 线雷达会静默停止 | P0 |
| G6 | K 线订阅只记录全局 intervals，没有记录每个连接的精确 stream 集合 | 无法可靠增删和恢复多连接订阅 | P0 |
| G7 | 当前 OI 每分钟刷新配置列表，历史 OI 按策略周期临时请求 | 全市场和四策略会产生重复请求 | P1 |
| G8 | 策略最短 5 分钟轮询 | 不能及时响应周期内成交额突增 | P1 |
| G9 | 同一 symbol 的多个策略串行 AI | 延迟与调用量按策略数放大 | P1 |
| G10 | 每轮 AI 有总量上限，超过后按遍历顺序跳过 | 后部交易对存在不公平和漏检 | P1 |
| G11 | 任意 AI 错误都会使整个 provider 冷却 | JSON 解析错误也会放大为整批不可用 | P1 |
| G12 | `aiRateLimit.maxConcurrent` 与真正使用的 `concurrencyPool.ai.maxConcurrency` 重复 | 配置语义不一致，容易误调 | P2 |
| G13 | 热重载会把新增 symbol 写入所有策略并触发重启 | universe 刷新会扰动策略和交易状态 | P0 |
| G14 | 缺少雷达事件去重、候选生命周期和优先级队列 | 高频消息可能重复调用 OI、策略和 AI | P1 |

## 4. 目标架构

### 4.1 分层原则

必须将交易对分成三层：

```text
Universe Pool
  全部满足流动性要求的 USDT 永续，预计 100~300 个
  只承担低成本行情监控

Candidate Pool
  预计成交额暴涨且数据完整的候选，预计同时 5~20 个
  才触发实时 OI 补采、多窗口特征和本地评分

Decision Pool
  排名靠前且通过冷却/仓位/风险检查的候选，预计每轮 3~10 个
  才进入策略和可选 AI 终审
```

### 4.2 目标数据流

```text
MarketUniverseService（12小时）
  -> exchangeInfo + ticker/24hr
  -> 流动性过滤
  -> Last Known Good universe
  -> RadarStreamManager 动态订阅差异

RadarStreamManager（实时）
  -> 只订阅 universe 的 @kline_5m
  -> 解析 quoteVolume / takerBuyQuoteVolume
  -> 更新内存中的当前 5m K线
  -> 已收盘 K线写入 RadarStore
  -> 断线重连后恢复精确 stream 集合
  -> REST 仅修复缺口

TimeframeAggregator（内存）
  -> 5m 聚合出 15m / 1h / 4h
  -> 每次更新采用 replace/upsert，避免累计重复

VolumeAnomalyDetector（1~2秒节流评估）
  -> 计算 K线进度
  -> 计算预计 USDT 成交额
  -> 与历史完整K线稳健基准比较
  -> 输出 volume anomaly

OISnapshotService（后台轮询 + 候选即时补采）
  -> 保存 OI 时间序列
  -> 计算 5m / 15m / 1h / 4h 变化

CandidateScoringService
  -> 价格变化
  -> OI变化
  -> 主动成交净流入
  -> 成交额暴涨强度
  -> 数据新鲜度和流动性检查
  -> 方向分类、评分、去重、Top N

CandidateRouter
  -> 仓位冲突和交易冷却检查
  -> 本地策略规则
  -> 可选 AI 终审
  -> 现有 StrategyEngine 执行入口
```

### 4.3 服务边界

建议新增以下模块：

```text
server/modules/market-radar/
  MarketRadarOrchestrator.ts
  MarketUniverseService.ts
  RadarStreamManager.ts
  TimeframeAggregator.ts
  VolumeAnomalyDetector.ts
  OISnapshotService.ts
  CandidateScoringService.ts
  CandidateRouter.ts
  MarketRadarStore.ts
  index.ts
```

职责约束：

- `MarketUniverseService` 只决定监控哪些合约，不修改策略配置。
- `RadarStreamManager` 只管理行情连接和原始事件，不计算交易信号。
- `TimeframeAggregator` 必须是无副作用、可回放测试的纯计算模块。
- `OISnapshotService` 统一拥有 OI 请求和时间序列，禁止策略自行重复抓取雷达候选 OI。
- `CandidateScoringService` 只产生候选，不下单。
- `CandidateRouter` 是雷达与现有策略系统之间唯一入口。
- `StrategyEngine` 保留最终仓位冲突、风控和执行职责。

## 5. 数据计算口径

### 5.1 Universe 过滤

```text
eligible =
  status == TRADING
  AND quoteAsset == USDT
  AND contractType in configuredContractTypes
  AND quoteVolume24h >= min24hQuoteVolume
```

默认配置：

```text
refreshIntervalMs = 43_200_000
min24hQuoteVolume = 10_000_000
contractTypes = [PERPETUAL]
```

`TRADIFI_PERPETUAL` 默认不自动加入，避免其交易时段和停盘行为影响统一规则；需要时显式启用。

Universe 刷新失败时必须继续使用最近一次成功列表，禁止把列表清空。新列表为空或数量相对上次下降超过配置比例时，应判定为异常响应并拒绝替换。

### 5.2 K 线字段

统一内部 K 线结构：

```ts
interface RadarKline {
  symbol: string
  interval: '5m' | '15m' | '1h' | '4h'
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  baseVolume: number
  quoteVolume: number
  takerBuyBaseVolume: number
  takerBuyQuoteVolume: number
  tradeCount?: number
  isClosed: boolean
  eventTime: number
}
```

REST K 线数组字段：

```text
[0]  openTime
[1]  open
[2]  high
[3]  low
[4]  close
[5]  baseVolume
[6]  closeTime
[7]  quoteVolume
[8]  tradeCount
[9]  takerBuyBaseVolume
[10] takerBuyQuoteVolume
```

WebSocket K 线字段：

```text
k.t  openTime
k.T  closeTime
k.v  baseVolume
k.q  quoteVolume
k.V  takerBuyBaseVolume
k.Q  takerBuyQuoteVolume
k.n  tradeCount
k.x  isClosed
```

### 5.3 多周期聚合

只订阅 `5m`。将 `5m` K 线按目标周期开始时间聚合：

```text
bucketOpenTime = floor(openTime / timeframeMs) * timeframeMs
open             = 第一根5m的open
high             = max(全部5m.high)
low              = min(全部5m.low)
close            = 最后一根5m的close
quoteVolume      = sum(全部5m.quoteVolume)
takerBuyQuote    = sum(全部5m.takerBuyQuoteVolume)
```

当前未收盘 5m K 线会重复推送累计值，因此必须以 `(symbol, interval, openTime)` 为键执行替换，再重新聚合；不能把每条 WebSocket 更新直接累加。

### 5.4 K 线进度

```text
progress = clamp((now - openTime) / timeframeMs, 0, 1)
```

建议默认规则：

- `progress < 0.15`：不触发成交额暴涨候选。
- `0.15 <= progress < 0.30`：允许观察，但提高触发阈值。
- `progress >= 0.30`：使用正常阈值。
- `isClosed=true`：`progress=1`。

必须使用事件对应 K 线的 `openTime`，不能使用最后一次接收事件的时间代替。

### 5.5 预计成交额

第一阶段使用可解释的线性估算：

```text
estimatedQuoteVolume = currentQuoteVolume / max(progress, minProgress)
```

历史基准只允许使用完整 K 线：

```text
baselineMedian = median(last N closed quoteVolume)
baselineEma = EMA(last N closed quoteVolume)
baseline = max(baselineMedian, baselineEma * baselineFloorRatio)
volumeBurstRatio = estimatedQuoteVolume / baseline
```

推荐初始值仅作为影子运行起点，不应未经回测直接用于实盘：

```text
N = 24
minProgress = 0.15
volumeBurstRatio >= 2.0
currentQuoteVolume >= timeframeAbsoluteQuoteVolumeFloor
```

第二阶段积累足够实时样本后，升级为周期内季节性曲线：

```text
historicalProgressShare(p)
  = median(历史K线在进度p时的累计成交额 / 该K线最终成交额)

estimatedQuoteVolume
  = currentQuoteVolume / historicalProgressShare(progress)
```

该算法能降低“成交量并非在周期内匀速发生”造成的系统偏差。

### 5.6 主动成交净流入

```text
takerSellQuoteVolume = quoteVolume - takerBuyQuoteVolume
netTakerFlow = takerBuyQuoteVolume - takerSellQuoteVolume
netTakerFlowRatio = quoteVolume > 0 ? netTakerFlow / quoteVolume : 0
```

需要同时保存绝对值和比例：绝对值表达资金规模，比例表达方向强度。只看比例会放大小成交额交易对的噪声。

### 5.7 价格变化

使用当前聚合 K 线的最新价格相对窗口起点价格：

```text
priceChange(window) = (currentPrice - priceAtWindowStart) / priceAtWindowStart * 100
```

窗口起点价格应取时间上最接近且不晚于目标时间的数据；若数据间隔或新鲜度超过容忍值，该窗口标记为不可用，不能自动写成 `0`。

### 5.8 OI变化

```text
oiChange(window) = (currentOI - oiAtWindowStart) / oiAtWindowStart * 100
```

建议：

- universe 后台 OI 全量轮询目标完成时间为 60~90 秒。
- 请求在时间轴上均匀分散，不在整分钟同时提交。
- 候选产生时允许立即补抓，但同一 symbol 设置 15~30 秒冷却。
- 本地至少保留 24 小时 OI 快照。
- 目标历史点缺失时选择不晚于目标时间的最近快照，并返回 `sampleAgeMs`。
- 过期数据不得参与自动开仓。

### 5.9 价格与 OI 的方向解释

| 价格变化 | OI变化 | 主动流向 | 默认解释 |
|---|---|---|---|
| 上涨 | 上升 | 主动买入 | 新多进入，偏多确认 |
| 下跌 | 上升 | 主动卖出 | 新空进入，偏空确认 |
| 上涨 | 下降 | 主动买入 | 空头回补，趋势持续性较弱 |
| 下跌 | 下降 | 主动卖出 | 多头平仓或清算，不直接等同新空 |
| 上涨 | 上升 | 主动卖出 | 分歧或吸收，降低评分 |
| 下跌 | 上升 | 主动买入 | 分歧或承接，降低评分 |

方向判定必须允许 `NEUTRAL`，不能为了进入 AI 强制生成多空方向。

## 6. 候选评分与生命周期

### 6.1 候选结构

```ts
interface RadarCandidate {
  id: string
  symbol: string
  triggerTimeframe: '5m' | '15m' | '1h' | '4h'
  candleOpenTime: number
  detectedAt: number
  direction: 'LONG' | 'SHORT' | 'NEUTRAL'
  score: number
  dataQuality: 'FRESH' | 'PARTIAL' | 'STALE'
  volume: {
    progress: number
    currentQuoteVolume: number
    estimatedQuoteVolume: number
    baselineQuoteVolume: number
    burstRatio: number
  }
  flow: Record<'5m' | '15m' | '1h' | '4h', {
    netQuote: number
    netRatio: number
  }>
  priceChange: Record<'5m' | '15m' | '1h' | '4h', number | null>
  oiChange: Record<'5m' | '15m' | '1h' | '4h', number | null>
  reasons: string[]
}
```

### 6.2 硬门槛

候选进入评分前必须满足：

1. symbol 仍在有效 universe 中。
2. 24h 成交额达到流动性阈值。
3. WebSocket 数据未过期。
4. 当前 K 线进度达到最小值。
5. 历史完整 K 线数量达到基准要求。
6. 当前绝对 USDT 成交额达到周期下限。
7. `volumeBurstRatio` 达到最低阈值。
8. 当前无全局数据降级或时间漂移告警。

### 6.3 建议评分维度

评分先保持本地、确定性和可回放：

```text
总分 = 成交额异动分
     + OI确认分
     + 主动成交方向分
     + 价格方向一致性分
     + 多周期共振分
     - 数据陈旧惩罚
     - 极端波动/流动性惩罚
```

不要在第一版固化未经验证的最终权重。所有分项必须写入候选记录，便于影子运行后分析阈值。

### 6.4 去重与升级

候选唯一键：

```text
symbol + triggerTimeframe + candleOpenTime + direction
```

同一键只在以下情况重新发布：

- 分数比上次提高超过配置值。
- 方向从 `NEUTRAL` 变为 `LONG/SHORT`。
- 新的 OI 数据使数据质量从 `PARTIAL` 变为 `FRESH`。
- 进入新的 K 线。

候选应具有 `NEW -> CONFIRMED -> ROUTED -> EXPIRED/REJECTED` 生命周期，避免每次 WebSocket 更新都调用策略或 AI。

### 6.5 公平调度

Top N 排名需要避免固定遍历顺序造成尾部 symbol 长期饥饿：

- 按评分排序，而不是按 universe 数组顺序。
- 同分时优先数据更新更早、尚未分析的候选。
- 为单 symbol 设置每周期最大路由次数。
- 为单策略和单 provider 设置预算。
- AI 预算耗尽时保留候选状态，而不是直接丢失。

## 7. 配置设计

保留 `BotConfig.symbols` 作为现有策略/手工关注列表，新增独立配置：

```ts
interface MarketUniverseConfig {
  enabled: boolean
  refreshIntervalMs: number
  min24hQuoteVolume: number
  contractTypes: Array<'PERPETUAL' | 'TRADIFI_PERPETUAL'>
  maxDropRatio: number
  cacheFile: string
}

interface MarketRadarConfig {
  enabled: boolean
  shadowMode: boolean
  baseTimeframe: '5m'
  derivedTimeframes: Array<'15m' | '1h' | '4h'>
  symbolsPerConnection: number
  subscribeBatchSize: number
  evaluateIntervalMs: number
  minCandleProgress: number
  baselineBars: number
  volumeBurstRatio: number
  historyRetentionDays: number
  maxActiveCandidates: number
}

interface OIRadarConfig {
  enabled: boolean
  fullSweepIntervalMs: number
  candidateRefreshCooldownMs: number
  retentionHours: number
  maxSampleAgeMs: number
  maxConcurrency: number
}

interface CandidateRoutingConfig {
  enabled: boolean
  maxCandidatesPerCycle: number
  maxCandidatesPerSymbolPerCandle: number
  minScore: number
  aiEnabled: boolean
  maxAIRequestsPerCycle: number
}
```

建议默认配置：

```json
{
  "marketUniverse": {
    "enabled": true,
    "refreshIntervalMs": 43200000,
    "min24hQuoteVolume": 10000000,
    "contractTypes": ["PERPETUAL"],
    "maxDropRatio": 0.35,
    "cacheFile": "data/market-universe.json"
  },
  "marketRadar": {
    "enabled": true,
    "shadowMode": true,
    "baseTimeframe": "5m",
    "derivedTimeframes": ["15m", "1h", "4h"],
    "symbolsPerConnection": 150,
    "subscribeBatchSize": 100,
    "evaluateIntervalMs": 2000,
    "minCandleProgress": 0.15,
    "baselineBars": 24,
    "volumeBurstRatio": 2.0,
    "historyRetentionDays": 14,
    "maxActiveCandidates": 50
  },
  "oiRadar": {
    "enabled": true,
    "fullSweepIntervalMs": 90000,
    "candidateRefreshCooldownMs": 20000,
    "retentionHours": 48,
    "maxSampleAgeMs": 120000,
    "maxConcurrency": 2
  },
  "candidateRouting": {
    "enabled": false,
    "maxCandidatesPerCycle": 10,
    "maxCandidatesPerSymbolPerCandle": 1,
    "minScore": 70,
    "aiEnabled": false,
    "maxAIRequestsPerCycle": 5
  }
}
```

所有阈值必须进入 `server/utils/storage.ts` 的默认值、合并和范围校验，不能散落在模块内硬编码。

## 8. 存储设计

### 8.1 推荐独立雷达数据库

建议新增 `data/market-radar.db`，不要在第一阶段把高频雷达写入继续塞进 `kline.db`：

- 避免雷达高频写入与图表/策略 K 线查询互相影响。
- 避免扩大 `sql.js` 整库内存和导出成本。
- 允许独立设置保留周期和清理任务。
- 出现问题时可以关闭雷达而不影响现有策略 K 线库。

生产运行应要求 Node.js 支持 `node:sqlite`。全市场高频雷达不建议回退到 `sql.js` 内存整库模式。

### 8.2 表结构

```sql
CREATE TABLE market_universe (
  symbol TEXT PRIMARY KEY,
  contract_type TEXT NOT NULL,
  status TEXT NOT NULL,
  quote_volume_24h REAL NOT NULL,
  last_price REAL NOT NULL,
  onboard_date INTEGER NOT NULL,
  selected_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE radar_kline_5m (
  symbol TEXT NOT NULL,
  open_time INTEGER NOT NULL,
  close_time INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  base_volume REAL NOT NULL,
  quote_volume REAL NOT NULL,
  taker_buy_base_volume REAL NOT NULL,
  taker_buy_quote_volume REAL NOT NULL,
  trade_count INTEGER NOT NULL,
  is_closed INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (symbol, open_time)
);

CREATE INDEX idx_radar_kline_symbol_time
  ON radar_kline_5m(symbol, open_time DESC);

CREATE TABLE oi_snapshots (
  symbol TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  open_interest REAL NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (symbol, timestamp)
);

CREATE INDEX idx_oi_symbol_time
  ON oi_snapshots(symbol, timestamp DESC);

CREATE TABLE radar_candidates (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  trigger_timeframe TEXT NOT NULL,
  candle_open_time INTEGER NOT NULL,
  direction TEXT NOT NULL,
  score REAL NOT NULL,
  state TEXT NOT NULL,
  detected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX idx_candidate_state_score
  ON radar_candidates(state, score DESC, updated_at DESC);
```

### 8.3 写入策略

- 当前未收盘 5m K 线以内存为主，按 symbol/openTime upsert。
- 已收盘 K 线立即落盘。
- 当前 K 线可每 5~10 秒批量 checkpoint，不逐消息写盘。
- OI 使用批量事务写入。
- 候选状态变化时写入，普通分数微小波动不写。
- 每小时执行一次分段清理，不在请求路径运行大范围 `DELETE`。

## 9. 文件级修改清单

### 9.1 新增文件

| 文件 | 用途 |
|---|---|
| `types/market-radar.ts` | Universe、K 线、OI、候选、状态和配置类型 |
| `server/modules/market-radar/MarketRadarStore.ts` | 独立 SQLite 存储和迁移 |
| `server/modules/market-radar/MarketUniverseService.ts` | 12 小时 universe 刷新和 Last Known Good |
| `server/modules/market-radar/RadarStreamManager.ts` | 多连接、精确订阅、重连恢复和数据新鲜度 |
| `server/modules/market-radar/TimeframeAggregator.ts` | 5m 聚合 15m/1h/4h |
| `server/modules/market-radar/VolumeAnomalyDetector.ts` | 进度、预计成交额和暴涨检测 |
| `server/modules/market-radar/OISnapshotService.ts` | OI 轮询、候选补采和多窗口变化 |
| `server/modules/market-radar/CandidateScoringService.ts` | 方向、评分、去重和生命周期 |
| `server/modules/market-radar/CandidateRouter.ts` | 候选到策略/AI的受控入口 |
| `server/modules/market-radar/MarketRadarOrchestrator.ts` | 启停顺序、健康状态和降级编排 |
| `server/modules/market-radar/index.ts` | 单例访问和模块导出 |
| `server/plugins/market-radar.ts` | Nitro 启动和关闭钩子 |
| `server/api/radar/status.get.ts` | 雷达健康状态 |
| `server/api/radar/candidates.get.ts` | 候选查询 |
| `server/api/radar/universe.get.ts` | 当前 universe 查询 |
| `server/api/radar/refresh.post.ts` | 手工触发 universe 刷新 |
| `test/market-radar/*.test.mjs` | 聚合、公式、去重、迁移和回放测试 |

所有新源码文件需要遵循项目注释规范：文件头用途说明、接口注释、类职责注释和关键业务分支注释。

### 9.2 修改文件

| 文件 | 修改内容 |
|---|---|
| `types/index.ts` | 将雷达配置并入 `BotConfig` |
| `types/kline-simple.ts` | 如需共享字段，增加可选 quote/taker 字段；保持旧 API 兼容 |
| `types/websocket.ts` | 补齐 quote volume、taker buy、closeTime、tradeCount |
| `server/utils/storage.ts` | 增加默认配置、深合并、范围校验和旧配置兼容 |
| `server/api/binance/top-symbols.get.ts` | 复用 `MarketUniverseService` 的筛选能力，避免重复逻辑 |
| `server/api/bot/reload-symbols.post.ts` | 保留“策略列表热重载”语义，禁止 universe 自动调用此接口 |
| `server/modules/strategy-engine/StrategyEngine.ts` | 增加候选分析入口；保留旧全量扫描作为兼容模式 |
| `server/modules/ai-analyzer/MultiStrategyAIAnalyzer.ts` | 按错误类型处理重试/冷却，支持候选优先级 |
| `server/utils/ai-service.ts` | 返回结构化 HTTP 错误，增强响应截断诊断 |
| `server/utils/binance-rate-limiter.ts` | 为低优先级雷达补数和 OI 轮询增加优先级或配额 |
| `server/api/bot/performance.get.ts` | 增加 universe、stream、消息延迟、OI、候选状态 |
| `app/components/PerformancePanel.vue` | 展示雷达健康与积压 |
| `app/components/TopSymbolsTable.vue` | 从手工热门列表逐步升级为 universe/候选观察面板 |

## 10. 推荐改造顺序

### 阶段 0：建立基线和功能开关

#### 目标

先建立可测量、可关闭、不会触发真实交易的改造环境。

#### 修改

1. 增加全部雷达配置类型和默认值。
2. 默认设置：
   - `marketRadar.enabled=false`
   - `marketRadar.shadowMode=true`
   - `candidateRouting.enabled=false`
   - `candidateRouting.aiEnabled=false`
3. 扩展性能 API，预留雷达状态字段。
4. 记录当前策略扫描、AI、Binance 队列、CPU、内存和 SQLite 大小作为基线。

#### 验收

- 配置文件缺少新字段时能自动补默认值。
- 雷达关闭时现有行为完全不变。
- 构建和现有测试通过。

#### 回滚

删除新配置字段或保持 `enabled=false` 即可。

### 阶段 1：抽取全市场 Universe 服务

#### 目标

实现每 12 小时自动筛选，但不订阅行情、不影响策略。

#### 修改

1. 从 `top-symbols.get.ts` 抽取 exchangeInfo/ticker 解析和过滤。
2. 实现 `MarketUniverseService.refresh()`。
3. 保存 Last Known Good 列表。
4. 增加结果完整性保护：空列表、异常下降、API 失败均不覆盖旧列表。
5. 增加 `/api/radar/universe` 和手工刷新接口。
6. 保证 Universe 服务不调用 `/api/bot/reload-symbols`，不修改策略 JSON。

#### 测试

- 过滤非 USDT、非永续、非 TRADING 合约。
- 精确使用 `ticker.quoteVolume`。
- `9,999,999` 被剔除，`10,000,000` 被保留。
- Binance 返回空数组时保留旧列表。
- 刷新任务不重叠。

#### 验收

- 连续运行 24 小时至少完成两次自动刷新。
- 刷新不产生策略重启和 K 线全量回填。
- universe 数量、刷新时间、失败次数可观测。

### 阶段 2：补齐成交额和主动买卖字段

#### 目标

建立正确的 USDT 成交额与主动成交净流入口径。

#### 修改

1. 新增 `RadarKline` 类型。
2. REST K 线解析增加 `[7]`、`[9]`、`[10]`、`[8]`。
3. WebSocket 解析增加 `k.q`、`k.V`、`k.Q`、`k.n`、`k.T`。
4. 创建 `market-radar.db` 和 schema version/migration。
5. 对历史 quote/taker 字段缺失的数据标记数据质量，不能用 `close * baseVolume` 冒充精确值参与实盘信号。

#### 测试

- 使用固定 Binance REST/WebSocket 样例验证字段映射。
- 验证 `netTakerFlow = 2Q - q`。
- 验证 `Q <= q`；异常数据进入隔离统计。
- 数据库重复 upsert 不增加行数。

#### 验收

- 同一根 K 线的 REST 和 WebSocket 收盘值在容忍误差内一致。
- 所有候选均能说明数据源和数据质量。

### 阶段 3：建立全市场 5m WebSocket 雷达

#### 目标

用 WebSocket 替代全市场多周期高频 REST，同步构建多周期行情。

#### 修改

1. 新建独立 `RadarStreamManager`，不要绑定前端 client 的 5 分钟过期机制。
2. 每连接默认 150 个 `@kline_5m` stream。
3. 订阅消息按 100 个 stream 分批，并设置发送间隔。
4. 保存每个连接的精确期望 stream 集合。
5. 重连后恢复 K 线 stream，不只恢复 ticker。
6. 增加指数退避、随机抖动和连接级熔断。
7. WebSocket 更新先写内存，按 1~2 秒节流触发计算。
8. 已收盘 K 线落盘；检测时间缺口后通过 REST 低优先级修复。
9. 实现 `TimeframeAggregator` 生成 `15m/1h/4h`。

#### 测试

- 乱序、重复和迟到事件。
- 同一未收盘 K 线多次更新不会重复累计。
- 5m 到 15m/1h/4h 的 OHLC、成交额和主动买入成交额聚合正确。
- 人工断开连接后自动恢复全部 stream。
- universe 增删时只改变差异订阅。
- 缺一根 5m 时能够检测并补齐。

#### 验收

- 200~300 symbol 模拟负载下，消息处理延迟 P95 小于 1 秒。
- 重连后 30 秒内恢复数据，且没有永久缺失订阅。
- 正常运行时不再对 universe 执行 `symbols × 4 timeframes` 的高频 REST 更新。
- Binance 429/418 为 0。

#### 灰度

先在 `shadowMode=true` 下与现有 REST 最后一根 K 线对比至少 48 小时，再启用 WebSocket 为雷达主数据源。

### 阶段 4：建立统一 OI 时间序列

#### 目标

以一次当前 OI 采样支持四个时间窗口，避免策略重复拉历史 OI。

#### 修改

1. 创建 `OISnapshotService` 和 `oi_snapshots` 表。
2. 对 universe 做均匀轮询，目标一轮 60~90 秒。
3. 候选出现时执行带冷却的即时刷新。
4. 从本地快照计算 `5m/15m/1h/4h` 变化。
5. 返回目标样本时间、实际样本时间和 age。
6. 为 OI 任务设置低于交易 API、高于历史回填的优先级。
7. 暂时保留 `IndicatorsHub` 旧 OI 路径，候选路径只使用新服务。

#### 测试

- 精确时间点、缺失时间点和陈旧样本。
- 分母为零或异常值。
- 同一 symbol 的后台轮询与候选补采请求合并。
- 一轮未完成时不启动下一轮。

#### 验收

- OI 全量轮询 P95 在配置时间内完成。
- 有效候选 OI 数据年龄小于 120 秒。
- Binance marketData 队列长期低于告警阈值。
- 策略数量增加不再线性增加候选 OI 请求。

### 阶段 5：成交额异动检测与候选评分

#### 目标

将全市场数百个 symbol 压缩成小规模、可解释、可回放的候选队列。

#### 修改

1. 实现线性预计成交额和历史稳健基准。
2. 实现周期绝对成交额下限。
3. 实现多窗口价格变化、净流入和 OI 变化。
4. 实现价格/OI/净流入方向分类。
5. 实现分项评分、硬门槛、数据质量和原因列表。
6. 实现候选唯一键、状态机、升级发布和过期。
7. 每 2 秒生成一次排序快照，限制 active candidates。
8. 保存候选及完整 feature payload，支持后续回测。

#### 测试

- K 线进度边界：0、15%、100%、时间漂移。
- 预计成交额和 EMA/median 基准。
- 多空四象限与矛盾流向。
- 同一 K 线重复消息只生成一个候选。
- 分数升级时更新候选而非新增。
- 数据陈旧时禁止进入可交易状态。

#### 验收

- 任一候选都能输出完整计算过程和拒绝原因。
- 关闭 AI 时雷达仍能稳定产生候选。
- 影子运行期间候选数量受控，不随 WebSocket 消息数线性增长。

### 阶段 6：接入现有策略和 AI

#### 目标

让现有交易系统只消费 Top N 候选，并保持最终风险控制不变。

#### 修改

1. 为 `StrategyEngine` 增加候选入口，例如：

```ts
analyzeRadarCandidate(candidate: RadarCandidate): Promise<void>
```

2. `CandidateRouter` 在进入策略前执行：
   - symbol 仓位冲突检查。
   - 候选过期检查。
   - 日交易限制和系统熔断检查。
   - 策略是否支持候选周期和方向。
3. 首选本地策略规则筛选，再决定是否调用 AI。
4. 同一 symbol 的四个周期特征放进同一份候选上下文。
5. 若四个策略提示词不同，先按本地匹配度选最合适策略；不要默认四个都调用 AI。
6. AI 使用优先级候选队列，预算耗尽的候选保留到过期，而不是按数组顺序丢弃。
7. AI 错误分类：
   - JSON 解析/字段验证错误：记录模型错误，不触发 provider 全局冷却。
   - 400/401/403：配置错误，停止该 provider 并告警。
   - 429：遵循 Retry-After 和指数退避。
   - 5xx/网络/超时：有限重试后短时熔断。
8. 合并 `aiRateLimit.maxConcurrent` 与 `concurrencyPool.ai.maxConcurrency` 的语义，保留一个真实生效来源。

#### 测试

- 候选过期、重复、已有仓位、熔断和日交易次数限制。
- AI 不可用时绝不绕过风险控制。
- AI 返回截断 JSON 时不会让整个 provider 因解析错误冷却 60 秒。
- 多候选按评分而不是 symbol 顺序获得 AI 配额。
- 同一候选不会被多个策略重复开仓。

#### 验收

- 每轮 AI 请求默认不超过 5~10 次。
- AI P95 延迟升高不会阻塞全市场行情处理。
- 候选到交易执行的端到端延迟可观测。
- 现有仓位互斥、止损止盈和持仓监控测试全部通过。

#### 灰度顺序

```text
雷达影子运行
  -> 候选只写日志
  -> 候选进入策略但禁用AI和下单
  -> 启用AI但禁用下单
  -> 测试网/极小仓位
  -> 正式启用
```

### 阶段 7：监控、前端和运维

#### 目标

确保全市场系统出现数据缺失、积压或降级时能够被发现并自动停止候选路由。

#### 指标

Universe：

- 当前数量、最近成功/失败时间、增加/删除数量。
- 最小/最大 24h 成交额。
- Last Known Good 年龄。

WebSocket：

- 连接数量、期望/实际 stream 数量。
- 最近消息时间、消息速率、解析错误。
- 重连次数、缺口数、REST 修复数。

OI：

- 当前轮进度、轮询耗时、队列长度。
- 成功/失败/去重请求数。
- 每个 symbol 最大数据年龄。

候选：

- 每周期检测数、确认数、拒绝数、过期数。
- 各拒绝原因计数。
- 分数分布和 Top N。

AI和执行：

- 候选到 AI 数、AI 到信号数、信号到下单数。
- AI 队列等待、调用耗时、错误分类、熔断状态。
- 候选产生到下单的端到端延迟。

#### 自动降级条件

任一条件满足时暂停 `CandidateRouter`，但继续持仓监控：

- WebSocket 关键数据超时。
- universe Last Known Good 过期。
- OI 数据年龄超过允许值且策略要求 OI。
- 系统时间漂移异常。
- Binance 418/持续 429。
- 雷达消息积压超过上限。
- 数据库写入持续失败。

### 阶段 8：验证稳定后清理旧链路

仅在雷达至少稳定影子运行 7 天、灰度交易通过后执行：

1. 停止对 universe 的四周期高频 REST 最后一根同步。
2. 保留策略固定交易对和图表所需的 REST K 线补数。
3. 将 `top-symbols` API 改为读取统一 universe 服务。
4. 移除重复 OI 历史请求路径，或只作为容灾备用。
5. 清理重复 AI 并发配置。
6. 根据实际查询决定是否将雷达聚合 K 线持久化；默认只持久化 5m。
7. 更新 `docs/项目运行流程分析.md` 和 README。

## 11. 容量与压力预算

按 200 个 universe symbol 估算：

### 改造前

```text
高频K线 REST：200 symbols * 4 timeframes = 800次/轮
全量OI：200次/分钟
策略价格：最多200次/扫描
AI候选：最多200 symbols * 4 strategies = 800个潜在任务
```

### 改造后

```text
WebSocket：200个 @kline_5m stream
K线常规REST：0，仅缺口修复
OI：约200次/60~90秒，均匀分布，候选即时请求去重
本地聚合：200 symbols * 4 timeframes，内存计算
AI：每轮默认Top 5，最多由配置限制到10
```

200 个 5m K 线 stream 在高活跃时仍可能产生较高消息速率，因此必须：

- 多连接分片。
- 消息只更新内存快照。
- 评估节流到 1~2 秒。
- 不在消息回调内做 SQLite 查询、OI REST 或 AI 调用。
- 候选通过队列异步补充 OI 和执行评分。

## 12. 测试与验收总表

| 类别 | 必测项 | 通过标准 |
|---|---|---|
| 单元测试 | 字段解析、周期聚合、进度、预计成交额、净流入、OI变化 | 固定样例结果精确一致 |
| 属性测试 | 重复/乱序消息、replace 幂等性 | 不重复累计、不产生重复候选 |
| 集成测试 | universe 刷新、动态订阅、重连恢复、缺口修复 | 状态最终收敛 |
| 故障测试 | 429、超时、空 universe、SQLite 失败、AI 截断 JSON | 正确降级且不错误下单 |
| 回放测试 | 录制行情回放 | 相同输入生成相同候选 |
| 负载测试 | 300 symbol、模拟高消息速率 | P95 处理延迟 < 1秒，无持续积压 |
| 影子运行 | 至少 7 天 | 无静默停流、无请求风暴、候选可解释 |
| 交易灰度 | 测试网或极小仓位 | 风控、互斥、止损和平仓闭环无回归 |

## 13. 完成定义

全部条件满足后，才认为改造完成：

1. Universe 每 12 小时自动刷新，失败时保留 Last Known Good。
2. 全市场列表不再写入所有策略，也不触发策略重启。
3. 全市场实时行情以 5m WebSocket 为主，15m/1h/4h 本地聚合。
4. 断线重连能恢复全部 K 线订阅。
5. 成交额使用精确 `quoteVolume`，净流入使用 `takerBuyQuoteVolume`。
6. OI 一次采样支持四个变化窗口，候选请求被去重。
7. 候选具有数据质量、完整分项、拒绝原因和生命周期。
8. AI 只消费 Top N，不再遍历全部 symbol × strategy。
9. AI 或雷达失败不会影响已有持仓监控和平仓。
10. 监控可以看见 universe、stream、OI、候选、AI 和执行全链路状态。
11. 负载、故障、回放和灰度测试达到本文验收标准。

## 14. 最终实施建议

第一轮开发只完成阶段 0~3，并保持 `shadowMode=true`。这能先解决最关键的数据正确性和 REST 请求规模问题，同时不触碰真实交易。

第二轮完成阶段 4~5，在完全不调用 AI、不下单的情况下积累候选数据。至少运行 7 天后，根据候选分布和历史回放确定各周期绝对成交额下限、暴涨倍数和评分权重。

第三轮完成阶段 6~8，将候选受控接入策略与 AI。AI 应定位为少量候选的结构化复核器，而不是全市场扫描器；交易安全仍由本地确定性风控和现有仓位闭环负责。
