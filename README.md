# Binance Futures Bot（Nuxt 4 + Node.js）

基于 **Nuxt 4 + Vue 3 + TypeScript + CCXT** 的币安 USDT 永续合约自动交易系统。  
项目包含：策略扫描、自动开平仓、风控熔断、移动止损、手动开仓、策略分析（MFE/MAE）与可视化管理界面。

> ⚠️ 重要声明：本项目仅用于学习与研究，不构成投资建议。实盘交易存在高风险，请先充分模拟测试。

---
<img width="1920" height="919" alt="image" src="https://github.com/user-attachments/assets/7f9bfc1a-c025-4904-b812-1c900d5343b5" />
## 1. 核心能力概览

- 多交易对轮询扫描（如 BTC/ETH/SOL/BNB 等）
- 规则化策略信号生成（ADX + EMA + RSI + ATR + 波动率过滤）
- 支持 AI 分析辅助过滤（DeepSeek，可开关）
- 自动下单、自动挂止损、持仓监控、自动平仓
- 移动止损（Trailing Stop）
- 风控机制：
  - 每日交易次数限制
  - 交易冷却时间
  - 日亏损与连续亏损熔断
  - 持仓超时处理
- 手动开仓 / 手动平仓（带密码校验）
- 本地持久化：配置、状态、交易历史、策略分析
- WebSocket 价格通道（失败时可回退 REST 取价）

---

## 2. 技术栈

- 前端：Nuxt 4、Vue 3、Element Plus、Pinia、ECharts、Lightweight Charts
- 后端：Nuxt Server API（Nitro）
- 交易接入：CCXT（Binance Futures）
- 指标：technicalindicators
- AI：DeepSeek API（可选）
- 语言：TypeScript
- 包管理：pnpm

说明：
- **ECharts** 主要用于统计分析类图表（如策略分析面板、聚合指标展示）。
- **Lightweight Charts** 更适合金融时序/K线类图形的轻量渲染与交互。

---

## 3. 目录结构（详细）

```text
binance-futures-bot/
├─ app/
│  ├─ app.vue                                # Nuxt 根组件
│  ├─ pages/                                 # 页面（首页、策略分析、WebSocket等）
│  ├─ components/                            # 业务组件（持仓、配置、日志、手动开仓等）
│  ├─ stores/
│  │  └─ bot.ts                              # 前端状态管理（拉取状态、启动/停止、配置更新、历史分页）
│  └─ utils/                                 # 前端工具函数
│
├─ server/
│  ├─ api/
│  │  ├─ bot/
│  │  │  ├─ start.post.ts                    # 启动机器人
│  │  │  ├─ stop.post.ts                     # 停止机器人
│  │  │  ├─ status.get.ts                    # 获取状态/配置/日志/余额
│  │  │  ├─ config.patch.ts                  # 更新配置
│  │  │  ├─ history.get.ts                   # 分页交易历史
│  │  │  ├─ manual-open-position.post.ts     # 手动开仓
│  │  │  ├─ close-position.post.ts           # 手动平仓
│  │  │  ├─ check-password.get.ts            # 是否启用密码
│  │  │  └─ verify-password.post.ts          # 密码验证
│  │  ├─ analysis/
│  │  │  ├─ metrics.get.ts                   # 策略分析统计
│  │  │  └─ export.get.ts                    # 导出分析数据
│  │  ├─ websocket/
│  │  │  ├─ status.get.ts                    # WS连接状态
│  │  │  ├─ prices.get.ts                    # 已缓存价格
│  │  │  ├─ connect.post.ts                  # 建连
│  │  │  ├─ subscribe.post.ts                # 订阅symbol
│  │  │  └─ unsubscribe.post.ts              # 取消订阅
│  │  ├─ kline-simple/                       # 简化K线接口
│  │  ├─ kline-simple-sync/                  # K线同步状态
│  │  └─ scripts/
│  │     ├─ generate-tv.post.ts              # 生成 TradingView 脚本
│  │     └─ get-pine.get.ts                  # 获取 Pine 脚本
│  │
│  ├─ modules/
│  │  ├─ futures-bot/
│  │  │  ├─ FuturesBot.ts                    # 机器人总控（初始化、启动、停止、模块编排）
│  │  │  ├─ index.ts                         # 单例导出
│  │  │  ├─ core/
│  │  │  │  ├─ analyzer.ts                   # 信号分析（趋势/入场/AI过滤）
│  │  │  │  ├─ scanner.ts                    # 扫描循环与调度
│  │  │  │  └─ state-manager.ts              # 配置与状态加载/同步
│  │  │  ├─ trading/
│  │  │  │  ├─ position-opener.ts            # 开仓、挂止损、仓位参数计算
│  │  │  │  ├─ position-monitor.ts           # 持仓监控、TP/超时/移动止损
│  │  │  │  ├─ position-closer.ts            # 平仓执行
│  │  │  │  └─ position-validator.ts         # 仓位一致性校验与补偿平仓
│  │  │  ├─ helpers/
│  │  │  │  ├─ trade-recorder.ts             # 交易落库与统计更新
│  │  │  │  ├─ strategy-analyzer.ts          # MFE/MAE 等策略指标
│  │  │  │  ├─ trailing-stop.ts              # 移动止损计算
│  │  │  │  └─ position-helpers.ts           # 开仓后确认辅助函数
│  │  │  └─ services/
│  │  │     ├─ indicators-cache.ts           # 指标缓存
│  │  │     └─ price-service.ts              # WS优先价格服务（失败回退REST）
│  │  ├─ kline-simple-sync/
│  │  └─ kline-websocket/
│  │
│  ├─ utils/
│  │  ├─ binance.ts                          # CCXT封装（下单、止损单、余额、持仓、订单查询）
│  │  ├─ indicators.ts                       # 指标计算与策略条件判断
│  │  ├─ risk.ts                             # 风控、TP条件、熔断、PnL计算
│  │  ├─ ai-analysis.ts                      # AI分析请求与条件过滤
│  │  ├─ websocket.ts                        # WS底层服务
│  │  ├─ websocket-manager.ts                # WS连接管理
│  │  ├─ logger.ts                           # 日志系统
│  │  └─ storage.ts                          # 配置/状态/历史读写
│  └─ plugins/
│
├─ data/
│  ├─ bot-config.json                        # 运行配置（优先于默认配置）
│  ├─ bot-state.json                         # 当前状态（持仓、PnL、熔断等）
│  ├─ trade-history.json                     # 历史成交记录
│  ├─ strategy-analysis.json                 # 策略分析结果
│  └─ kline-simple/                          # K线缓存数据（体量较大）
│
├─ docs/                                     # 设计与使用文档
├─ scripts/                                  # 辅助脚本（日志处理、K线清理等）
├─ test/                                     # 测试/实验脚本（含 Pine 脚本）
├─ types/
│  ├─ index.ts                               # 核心类型（BotConfig/BotState/Position等）
│  ├─ websocket.ts
│  └─ kline-simple.ts
├─ nuxt.config.ts
├─ package.json
└─ README.md
```

---

## 4. 运行要求

- Node.js 18+
- pnpm 10+
- 币安合约 API Key（实盘/模拟盘）

---

## 5. 快速开始

### 5.1 安装依赖

```bash
pnpm install
```

### 5.2 配置环境变量

在项目根目录创建 `.env`：

```bash
BINANCE_API_KEY=你的币安API_KEY
BINANCE_SECRET=你的币安SECRET

# 可选：AI 分析
DEEPSEEK_API_KEY=你的DEEPSEEK_KEY
DEEPSEEK_API_URL=https://api.deepseek.com

# 可选：配置/手动操作密码
CONFIG_EDIT_PASSWORD=你的密码
```

### 5.3 启动开发环境

```bash
pnpm dev
```

默认访问：`http://localhost:3000`

### 5.4 构建与预览

```bash
pnpm build
pnpm preview
```

---

## 6. 配置来源与优先级

机器人配置通过 `BotConfig` 管理，运行时遵循：

1. 优先读取 `data/bot-config.json`
2. 若不存在则使用 `server/utils/storage.ts` 内的默认配置

状态与交易历史保存在：

- `data/bot-state.json`
- `data/trade-history.json`
- `data/strategy-analysis.json`

---

## 7. 交易执行与策略闭环（代码真实流程）

### 7.1 执行链路

1. `MarketScanner` 定时扫描交易对（空仓用 `scanInterval`，持仓用 `positionScanInterval`）
2. `MarketAnalyzer` 对每个标的做指标计算与信号判定
3. 信号通过后进入 `PositionOpener`：
   - 计算止损、仓位、杠杆
   - 下市价单
   - 挂止损单（`STOP_MARKET`）
4. 进入 `PositionMonitor`：
   - 实时计算浮盈亏
   - 检查 TP2 / TP1 / 持仓超时
   - 检查并更新移动止损
5. 触发平仓后由 `PositionCloser` 执行；`PositionValidator` 负责本地与交易所仓位一致性校验
6. `trade-recorder` 写入交易历史，更新统计与熔断状态

### 7.2 时间周期映射（非常重要）

- `strategyMode = short_term`：主周期 `15m`，次周期 `1h`，第三周期 `4h`
- `strategyMode = medium_term`：主周期 `1h`，次周期 `4h`，第三周期 `1d`

> 说明：代码内部字段名仍是 `adx15m/adx1h/adx4h`，但在 `medium_term` 下它们实际映射到 `1h/4h/1d`。

### 7.3 趋势方向判定

- 先看是否触发 EMA 金叉/死叉直接入场（`crossEntryEnabled=true` 时）
- 否则使用趋势条件：
  - 做多：`EMA_fast > EMA_slow` 且 `price > EMA_fast`
  - 做空：`EMA_fast < EMA_slow` 且 `price < EMA_fast`

### 7.4 ADX 多周期过滤

需满足：

- 主周期 ADX ≥ `adx15mThreshold`
- 次周期 ADX ≥ `adx1hThreshold`
- 第三周期 ADX ≥ `adx4hThreshold`
- 且当 `enableAdx15mVs1hCheck=true` 时，还要求主周期 ADX > 次周期 ADX

### 7.5 入场过滤（Long/Short）

共同要素：

- EMA 偏离检查（快/中 EMA）
- 慢 EMA 偏离检查（防止追涨杀跌）
- RSI 区间过滤
- K线确认（多头看阳线/下影线，空头看阴线/上影线）
- 成交量 EMA 过滤（可开关）
- 价格突破过滤（可开关）
- 波动率过滤：`ATR% >= minATRPercent`（可按 symbol 跳过）

### 7.6 平仓逻辑（监控顺序）

持仓监控中优先级：

1. TP2 条件（复合触发）
2. TP1 条件
3. 持仓超时（且 ADX 走弱）
4. 移动止损更新（更新止损单，不是直接平仓）

TP1 触发（`checkTP1Condition`）：

- 盈亏比达到 `tp1RiskRewardRatio`

TP2 触发（`checkTP2Condition`）：

- 先满足最小盈利门槛：`profit >= risk * tp1MinProfitRatio`
- 再满足任一：
  - 盈亏比达到 `tp2RiskRewardRatio`
  - RSI 到极值（多头 ≥ `rsiExtreme.long` / 空头 ≤ `rsiExtreme.short`）
  - ADX 斜率走弱（`adxSlope <= -adxDecreaseThreshold`）

### 7.7 风控与熔断

- 每日交易上限：`dailyTradeLimit`
- 冷却时间：`tradeCooldownInterval`
- 熔断条件：
  - 日亏损比例达到 `dailyLossThreshold`
  - 连续亏损达到 `consecutiveLossesThreshold`
- 可选强制平仓时间：`forceLiquidateTime.enabled=true` 时生效

---

## 8. 策略配置详解（按当前 `data/bot-config.json`）

> 下列为你当前配置文件中的运行值，不是默认兜底值。

### 8.1 顶层参数

- `strategyMode: short_term`
- `symbols: [BTC/USDT, ETH/USDT, SOL/USDT, DOGE/USDT, HYPE/USDT, XAU/USDT, XAG/USDT, BNB/USDT]`
- `leverage: 8`
- `maxRiskPercentage: 20`
- `stopLossATRMultiplier: 3`
- `maxStopLossPercentage: 2`
- `positionTimeoutHours: 120`
- `scanInterval: 180`
- `positionScanInterval: 30`
- `tradeCooldownInterval: 7200`

### 8.2 `aiConfig`（AI过滤）

- `enabled: true`
- `analysisInterval: 1500`（秒）
- `minConfidence: 60`
- `conditionMode: SCORE_ONLY`
- `maxRiskLevel: MEDIUM`
- `technicalPostAdjustmentMode: PENALTY_ONLY`
- `useForEntry: true`
- `useForExit: true`
- `cacheDuration: 10`（分钟）

解释：当前是“启用AI且偏宽松置信度门槛（60）”的入场过滤模式。

### 8.3 `riskConfig`（风控）

`circuitBreaker`：

- `dailyLossThreshold: 10`（当日亏损%）
- `consecutiveLossesThreshold: 3`

`forceLiquidateTime`：

- `enabled: false`（当前不启用）
- `hour: 23` / `minute: 55`

`takeProfit`：

- `tp1RiskRewardRatio: 3.8`
- `tp2RiskRewardRatio: 5`
- `tp1MinProfitRatio: 1`
- `rsiExtreme.long: 80`
- `rsiExtreme.short: 20`
- `adxDecreaseThreshold: 1.8`
- `adxSlopePeriod: 3`

`dailyTradeLimit`：

- `3`

### 8.4 `dynamicLeverageConfig`（动态杠杆）

- `enabled: false`（当前关闭）
- `minLeverage: 2`
- `maxLeverage: 20`
- `baseLeverage: 8`
- `riskLevelMultipliers: LOW=1.5, MEDIUM=1, HIGH=0.5`

### 8.5 `trailingStopConfig`（移动止损）

- `enabled: true`
- `activationRatio: 1.5`
- `trailingDistance: 1.2`
- `updateIntervalSeconds: 120`

解释：当前需要达到 **1.5R** 才激活追踪，属于“偏保守激活”。

### 8.6 `indicatorsConfig`（指标与入场）

`emaPeriods`：

- `short_term`: `fast=14, medium=30, slow=120`
- `medium_term`: `fast=14, medium=60, slow=120`

`crossEntryEnabled: true`

`adxTrend`：

- `adx1hThreshold: 38`
- `adx4hThreshold: 35`
- `adx15mThreshold: 50`
- `enableAdx15mVs1hCheck: false`

`longEntry`：

- `emaDeviationThreshold: 0.012`
- `emaDeviationEnabled: true`
- `emaSlowDeviationThreshold: 0.03`
- `emaSlowDeviationEnabled: true`
- `rsiMin: 38`, `rsiMax: 65`
- `candleShadowThreshold: 0.005`
- `volumeConfirmation: false`
- `volumeEMAPeriod: 12`
- `volumeEMAMultiplier: 1.2`

`shortEntry`：

- `emaDeviationThreshold: 0.012`
- `emaDeviationEnabled: true`
- `emaSlowDeviationThreshold: 0.03`
- `emaSlowDeviationEnabled: true`
- `rsiMin: 35`, `rsiMax: 62`
- `candleShadowThreshold: 0.005`
- `volumeConfirmation: false`
- `volumeEMAPeriod: 12`
- `volumeEMAMultiplier: 1.3`

`priceBreakout`：

- `enabled: false`
- `period: 3`
- `requireConfirmation: false`
- `confirmationCandles: 1`

`volatility`：

- `enabled: true`
- `minATRPercent: 0.3`
- `skipSymbols: [HYPE/USDT]`

---

## 9. 调参建议（结合你当前参数）

### 9.1 目前配置特征

- ADX 阈值设置较高（50/38/35），信号会明显变少，但趋势纯度可能更高
- TP1=3.8R、TP2=5R 偏激进，导致止盈触发少、持仓时间长
- 持仓超时 120 小时偏长，容易增加隔夜/周末风险暴露
- 成交量确认关闭（`volumeConfirmation=false`），会增加进场数量但降低过滤强度

### 9.2 可分阶段优化

1. 先把 `positionTimeoutHours` 下调到 24~48 观察回撤，再将 ADX 阈值分步下调（例如 50/38/35 → 30/20/15）
2. 将 `tp1RiskRewardRatio` 降到 2~3 做对照实验
3. 按标的区分阈值（波动大的币与主流币分开）
4. 若假突破较多，可打开 `priceBreakout.enabled` 并启用收盘确认
5. 若噪声信号多，可恢复 `volumeConfirmation=true`

---

## 10. API 速览

### Bot

- `GET /api/bot/status`：获取状态/配置/日志/余额
- `POST /api/bot/start`：初始化并启动机器人
- `POST /api/bot/stop`：停止机器人
- `PATCH /api/bot/config`：更新配置
- `GET /api/bot/history?page=1&pageSize=10`：分页交易历史
- `POST /api/bot/close-position`：手动平仓
- `POST /api/bot/manual-open-position`：手动开仓
- `GET /api/bot/check-password` / `POST /api/bot/verify-password`：密码检查/验证

### Analysis

- `GET /api/analysis/metrics`
- `GET /api/analysis/export`

### WebSocket 管理

- `GET /api/websocket/status`
- `GET /api/websocket/prices`
- `POST /api/websocket/connect`
- `POST /api/websocket/subscribe`
- `POST /api/websocket/unsubscribe`

---

## 11. 手动开仓参数说明

`POST /api/bot/manual-open-position` 关键字段：

- `symbol`: 交易对（如 `BTC/USDT`）
- `direction`: `LONG | SHORT`
- `orderType`: `MARKET | LIMIT`（当前实现中 LIMIT 会回退为市价逻辑）
- `amountType`: `USDT | PERCENTAGE`
- `amount`: 数量或百分比
- `leverage`: 杠杆倍数
- `password`: 若启用了 `CONFIG_EDIT_PASSWORD` 则必填

---

## 12. 系统状态说明

`PositionStatus`：

- `IDLE`：空闲
- `MONITORING`：监控中（无仓位，扫描机会）
- `OPENING`：开仓中
- `POSITION`：持仓中
- `CLOSING`：平仓中
- `HALTED`：熔断停机

---

## 13. 常见问题排查

### 1）启动后不交易

- 检查是否达到每日交易上限
- 检查是否处于冷却期
- 检查熔断状态是否触发
- 检查策略条件是否长期不满足

### 2）下单失败

- 检查 API Key 权限与是否为合约权限
- 检查账户可用余额（系统内含最小名义价值校验）
- 检查交易对是否可交易

### 3）状态与交易所不一致

项目内置持仓一致性检查与补偿逻辑（`PositionValidator`），若检测到交易所已平仓会自动补记录并回收本地状态。

---

## 14. 开发建议

- 先在模拟盘运行，验证日志与交易行为
- 每次改参数后观察至少一段完整周期
- 重点关注：
  - 胜率与盈亏比
  - 熔断触发频率
  - 交易理由与退出原因分布

---

## 15. 风险提示

加密资产波动大、杠杆风险高。请严格控制仓位，避免将项目直接用于大资金实盘。  
建议：模拟环境长周期验证 → 小资金灰度 → 再考虑扩大。

---

## License

MIT
