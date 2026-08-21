# 币安永续合约 AI 自动交易系统 (Binance Futures AI Trading Bot)

> **基于 AI 技术指标分析的币安 USDT 永续合约自动化交易系统**，支持多策略并行执行、动态杠杆、智能止损止盈。
### 页面截图
<img width="1903" height="2456" alt="h wuhaxi com" src="https://github.com/user-attachments/assets/582ce166-6dad-41d6-bf39-1578fa827e10" />
### 新增和编辑策略
<img width="1903" height="2456" alt="h666 wuhaxi com" src="https://github.com/user-attachments/assets/caffb4b6-9f01-4552-95f3-67921b48fdf7" />


## 📋 项目概览

| 项目 | 说明 |
|------|------|
| **项目名称** | 币安永续合约 AI 自动交易系统 |
| **技术栈** | Nuxt 4 + Vue 3 + Nitro + TypeScript + Pinia + Element Plus |
| **目标场景** | 7×24 无人值守的币安 USDT 永续合约趋势交易 |
| **核心优势** | 多策略并行、AI 辅助决策 + 技术指标双重验证、完整风控体系 |

---

## 🚀 快速开始

### 前置条件

- Node.js >= 20
- pnpm >= 10
- 币安 API Key & Secret（用于交易操作）

### 安装与配置

```bash
# 1. 克隆项目
git clone https://github.com/q573927428/ai-bian.git
cd ai-bian

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
# 复制 .env.example 为 .env，填入以下配置
cp .env.example .env
```

### 环境变量配置

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `BINANCE_API_KEY` | 币安 API Key | ✅ 是（交易） |
| `BINANCE_SECRET` | 币安 API Secret | ✅ 是（交易） |
| `AI_PROVIDER` | AI 提供商（deepseek/doubao/qwen/openai） | 否（默认 deepseek） |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | 否 |
| `DOUBAO_API_KEY` | 豆包 API Key | 否 |
| `QWEN_API_KEY` | 阿里千问 API Key | 否 |
| `OPENAI_API_KEY` | OpenAI API Key | 否 |
| `CONFIG_EDIT_PASSWORD` | 配置编辑密码 | 否（推荐设置） |

### 运行命令

```bash
# 开发模式（默认端口 3000）
pnpm dev

# 开发模式（端口 3002，独立同步）
pnpm dev:with-sync

# 生产构建
pnpm build

# 生产运行（端口 3002）
pnpm start

# 预览构建结果
pnpm preview
```

---

## 🏗️ 技术架构

### 技术栈

| 层次 | 技术 | 用途 |
|------|------|------|
| **前端框架** | Nuxt 4 + Vue 3 (Composition API) | 服务端渲染 + 客户端交互 |
| **状态管理** | Pinia | 全局状态管理 |
| **UI 组件库** | Element Plus | 界面组件 |
| **图表库** | ECharts + Lightweight Charts | 数据可视化 |
| **后端引擎** | Nitro (Nuxt 内置) | 服务端 API + 业务逻辑 |
| **交易所 SDK** | CCXT | 币安 API 封装 |
| **AI 模型** | DeepSeek / 豆包 / 千问 / OpenAI | 交易决策分析 |
| **指标计算** | technicalindicators | RSI / MACD / ADX / ATR / EMA |
| **数据库** | Node.js `node:sqlite` | K 线数据存储 |
| **数据持久化** | JSON 文件系统 | 配置 / 持仓 / 策略 |
| **包管理** | pnpm | 依赖管理 |

### 项目目录结构

```
ai-bian/
├── app/                          # 前端应用层
│   ├── app.vue                   # 根组件（主题 + 全局 CSS）
│   ├── components/               # 业务组件（11 个核心组件）
│   │   ├── ActivePositions.vue   # 活跃持仓列表
│   │   ├── Strategies.vue        # 策略管理
│   │   ├── TradeHistory.vue      # 交易历史
│   │   ├── CryptoPriceCards.vue  # 实时价格卡片
│   │   ├── SystemLogs.vue        # 系统日志
│   │   ├── BotConfigDialog.vue   # 配置对话框
│   │   ├── PasswordDialog.vue    # 密码验证
│   │   ├── StrategyEditor.vue    # 策略编辑器
│   │   ├── StrategyVersionHistory.vue # 版本历史
│   │   ├── ProfitWinRateChart.vue     # 盈亏胜率图
│   │   └── TradingViewChartModal.vue  # K 线图弹窗
│   ├── composables/              # 组合式函数
│   │   └── useTheme.ts           # 主题切换
│   ├── pages/                    # 页面
│   │   ├── index.vue             # 主仪表盘
│   │   └── websocket-test.vue    # WebSocket 测试
│   ├── stores/                   # Pinia 状态仓库
│   │   ├── bot.ts                # Bot 全局状态 + 价格管理
│   │   ├── strategies.ts         # 策略管理
│   │   └── tradeHistory.ts       # 交易历史
│   └── utils/                    # 前端指标计算
│       ├── adx-calculator.ts
│       ├── ema-calculator.ts
│       └── rsi-calculator.ts
│
├── server/                       # 服务端层 (Nitro)
│   ├── api/                      # API 路由
│   │   ├── ai/                   # AI 分析
│   │   ├── bot/                  # Bot 状态/配置
│   │   ├── kline-simple/         # K 线数据
│   │   ├── positions/            # 持仓
│   │   ├── scripts/              # 脚本执行
│   │   ├── strategies/           # 策略 CRUD
│   │   └── websocket/            # WebSocket 价格
│   ├── modules/                  # 核心业务模块
│   │   ├── ai-analyzer/          # AI 分析器
│   │   ├── futures-bot/          # 期货机器人服务
│   │   ├── indicators/           # 指标计算中心
│   │   ├── kline-simple-sync/    # K 线同步
│   │   ├── position-manager/     # 仓位管理器
│   │   ├── scheduler/            # 交易对调度器
│   │   ├── strategy-engine/      # 策略执行引擎
│   │   ├── strategy-manager/     # 策略管理器
│   │   └── strategy-store/       # 策略存储
│   ├── plugins/                  # Nitro 插件
│   │   ├── kline-sync.ts         # K 线同步启动
│   │   ├── position-manager.ts   # 仓位管理器启动
│   │   └── strategy-manager.ts   # 策略管理器启动
│   └── utils/                    # 服务端工具
│       ├── binance.ts            # 币安 API 封装
│       ├── ai-service.ts         # AI 服务调用
│       ├── ai-pre-screen.ts      # AI 预筛选
│       ├── risk.ts               # 风控工具
│       ├── logger.ts             # 日志系统
│       ├── storage.ts            # 文件存储
│       ├── kline-sync-service.ts # K 线同步服务
│       ├── indicators.ts         # 指标计算
│       ├── indicators-risk.ts    # 指标风控
│       ├── websocket.ts          # WebSocket 管理
│       ├── trade-helpers.ts      # 交易辅助
│       └── concurrency-pool.ts   # 并发池控制
│
├── types/                        # TypeScript 类型定义
│   ├── index.ts                  # 核心类型
│   ├── strategy.ts               # 策略类型（363行）
│   ├── signal.ts                 # 交易信号类型
│   ├── kline-simple.ts           # K 线存储类型
│   └── websocket.ts              # WebSocket 类型
│
├── data/                         # 运行时数据文件
│   ├── bot-config.json           # Bot 配置
│   ├── bot-state.json            # 运行状态
│   ├── active-positions.json     # 活跃持仓
│   ├── symbol-locks.json         # 交易对锁
│   ├── strategies/               # 策略存储
│   └── ...                       # 其他数据
│
├── scripts/                      # 独立脚本
├── test/                         # 测试文件
├── nuxt.config.ts                # Nuxt 配置
└── package.json                  # 项目依赖
```

---

## 🧠 核心架构设计

### 系统初始化流程

```
Nuxt 开发服务器启动
        │
        ▼
Nitro 服务端引擎初始化
        │
        ▼
Nitro 插件顺序执行 (3个插件)
  ① kline-sync.ts        → K 线同步服务启动
  ② position-manager.ts  → 仓位管理器初始化
  ③ strategy-manager.ts  → 策略管理系统初始化
        │
        ▼
策略管理系统初始化链
  ├── node:sqlite 数据库初始化
  ├── StrategyStore 创建（从 JSON 文件加载）
  ├── BinanceService 初始化（公开/私有实例）
  ├── IndicatorsHub 单例初始化（事件驱动更新）
  ├── PositionManager 初始化（本地状态加载）
  ├── StrategyEngine 创建（AI 分析器 + 监控）
  └── 自动加载激活的策略
        │
        ▼
前端应用加载（客户端）
  ├── 主题初始化 (useTheme)
  ├── 数据获取 (fetchStatus + loadStrategies)
  └── 子组件按需加载 (ClientOnly)
```

### 核心模块交互

```
┌─────────────────────────────────────────────────────────────┐
│                        币安交易所                              │
└──────────┬──────────────┬──────────────────┬───────────────┘
           │              │                  │
     公开数据         私有数据           WebSocket
           │              │                  │
           ▼              ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                        服务端 (Nitro)                          │
│                                                              │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │ K 线同步   │  │  指标中心     │  │    AI 分析器        │   │
│  │ Service    │─▶│IndicatorsHub │─▶│MultiStrategyAI     │   │
│  │(node:sqlite)│  │  (缓存+计算) │  │Analyzer (并发池)    │   │
│  └────────────┘  └──────────────┘  └─────────┬──────────┘   │
│                                               │              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────▼──────────┐  │
│  │ 策略存储    │  │  策略管理器   │  │   策略执行引擎       │   │
│  │Strategy    │◀─│Strategy     │──│  StrategyEngine      │   │
│  │Store       │  │Manager      │  │  定时循环 + 调度     │   │
│  │(JSON文件)  │  │(CRUD+版本)  │  └──────────┬──────────┘   │
│  └────────────┘  └──────────────┘             │              │
│                                      ┌────────▼──────────┐   │
│                                      │  仓位管理器 / 监控  │   │
│                                      │ PositionManager   │   │
│                                      │ & Monitor & Closer │   │
│                                      └────────┬──────────┘   │
│                                               │              │
└───────────────────────────────────────────────┼──────────────┘
                                                │
                                           API 路由
                                                │
                                                ▼
┌────────────────────────────────────────────────────────────┐
│                     前端 (Vue 3 + Nuxt 4)                    │
│                                                             │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │   Bot Store   │  │Strategies     │  │ TradeHistory     │  │
│  │ (Pinia)      │  │Store (Pinia)  │  │ Store (Pinia)    │  │
│  │ 状态/价格/日志│  │ 策略CRUD/状态 │  │ 历史/分页/筛选   │  │
│  └──────────────┘  └───────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│  │价格卡│ │持仓  │ │策略  │ │交易历│ │系统日│ │盈亏图│    │
│  │片    │ │列表  │ │管理  │ │史    │ │志   │ │表    │    │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘    │
└────────────────────────────────────────────────────────────┘
```

---

## 🗃️ 数据流

### AI 分析决策流

```
StrategyEngine 全局定时循环（步长 = 所有策略最小间隔，最低5分钟）
        │
        ▼
遍历到期策略 → 按交易对分组
        │
        ▼
SymbolBasedScheduler.buildMarketSnapshot(symbol)
  ① fetchPrice() → 当前价格（5秒缓存）
  ② IndicatorsHub.getBatchIndicators() → 所有指标
  ③ IndicatorsHub.getKlines() → K 线数据
        │
        ▼
StrategyEngine.analyzeSymbol() — 对每个策略+交易对
  ① 仓位冲突检查
  ② 提取指标数据（OI / SquareHeat / EMA / RSI / MACD / ATR）
  ③ AI 预筛选（ADX / 成交量 / K 线进度）
  ④ AI 分析（带缓存 10 分钟）
  ⑤ 信号验证（置信度 / 评分 / 风险等级）
  ⑥ 执行信号（开仓）
        │
        ▼
开仓执行流程
  余额检查 → 锁定交易对 → 计算止损 → 计算杠杆 → 设置杠杆/模式
  → 计算仓位大小 → 市价开仓 → 确认持仓 → 设置止损单 → 持久化
```

### 价格数据流

```
币安 WebSocket（实时推送）
        │
        ▼
server/utils/websocket.ts
        │
        ▼
MarketPriceHub（内存快照 + 200ms 增量合并）
        │
        ▼ SSE /api/market/prices/stream
Bot Store (Pinia，每个标签页一条连接)
        │
        ├── CryptoPriceCards (实时价格)
        ├── ActivePositions (持仓盈亏)
        └── KLineChartSimple (当前 K 线)

断线或行情陈旧超过 10 秒时，使用 HTTP 内存快照低频兜底。
```

---

## 📐 核心模块详解

### 1. 策略执行引擎 (StrategyEngine)

**文件**：`server/modules/strategy-engine/StrategyEngine.ts`（1362 行）

职责：
- 管理多策略并发执行
- 全局定时循环调度（按交易对聚合）
- AI 分析调用（带缓存降级）
- 执行交易信号（开仓/平仓）

AI 缓存机制：
```
缓存键：strategyId_symbol_{指标数据哈希前32字符}
缓存 TTL：最少 10 分钟（可配置 aiCacheTtlMinutes）
相同市场数据不重复调用 AI API，节省成本
```

### 2. 调度器 (SymbolBasedScheduler)

- 按交易对收集所有订阅策略
- 为每个交易对统一构建一次市场快照
- 将快照扇出给所有订阅该交易对的策略
- **优势**：避免重复获取 K 线和调用价格 API

### 3. 指标中心 (IndicatorsHub)

- 单例模式，全局唯一实例
- 统一的 K 线缓存（所有策略共享）
- 支持 5 个时间周期：5m、15m、1h、4h、1d
- 支持 8 种技术/统计指标：EMA、RSI、MACD、ATR、ADX、OI、Volume、SquareHeat
- 事件驱动更新 + 60 秒定时刷新
- 文件变化自动检测失效缓存

### 4. 仓位管理器 (PositionManager)

- Symbol 级互斥锁（同一交易对只能被一个策略持有）
- 本地持久化（active-positions.json + symbol-locks.json）
- 防抖写入（100ms 延迟避免频繁 I/O）
- 启动时从交易所同步实际持仓

### 5. AI 分析器 (MultiStrategyAIAnalyzer)

多 AI 提供商支持：

| 提供商 | API URL | 默认模型 |
|--------|---------|----------|
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` |
| 豆包 (Doubao) | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-0-pro` |
| 阿里千问 (Qwen) | `https://dashscope.aliyuncs.com` | `qwen-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

评分体系：
```
ScoreBreakdown = {
  baseScore: 0-30,       // 基础评分
  hardScore: 0-50,       // 硬指标评分（技术指标）
  softScore: 0-20,       // 软指标评分（市场情绪）
  penaltyScore: -10-0,   // 惩罚分
  finalScore: 0-100      // 最终评分 = base + hard + soft + penalty
}
```

### 6. 策略管理器 (StrategyManager)

- 策略 CRUD（创建/读取/更新/删除）
- 版本控制（每次更新自动保存历史版本）
- 支持版本回滚
- 策略级覆盖配置（预筛选/置信度/评分/风险等级）

---

## 📊 策略配置

### 策略核心结构

每个策略是一个独立的配置文件，核心配置项：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `marketData.symbols` | 监控的交易对 | `["BTC/USDT"]` |
| `marketData.timeframes` | 时间周期 | `["15m", "1h", "4h"]` |
| `indicators` | 启用的技术指标 | EMA / RSI / MACD / ATR / ADX |
| `statistics` | 启用的统计指标 | OI / Volume / SquareHeat |
| `aiPrompt` | AI 提示词模板 | 自定义系统/用户提示词 |
| `executionConfig.scanInterval` | 扫描间隔 | `15`（分钟） |
| `executionConfig.leverage` | 杠杆（null=动态） | `10` 或 `null` |
| `riskManagement.maxRiskPercentage` | 单笔最大风险 | `0.02`（2%） |
| `riskManagement.stopLossATRMultiplier` | 止损 ATR 倍数 | `2.0` |
| `riskManagement.takeProfitRatios` | 止盈比例 | `[0.02, 0.04]`（2% / 4%） |
| `minConfidence` | 最低置信度 | `50` |
| `minFinalScore` | 最低最终评分 | `0` |
| `maxRiskLevel` | 最大风险等级 | `HIGH` |

---

## 🛡️ 风险控制体系

### 多重安全防护

```
预筛选阶段
├── ADX 趋势检查（需要 ADX > 20）
├── 成交量异常检测
└── K 线进度检查

信号验证
├── 方向不为 `idle` 且不为反方向信号
├── 置信度 >= minConfidence（默认 50）
├── 最终评分 >= minFinalScore（默认 0）
└── 风险等级 <= maxRiskLevel（默认 HIGH）

仓位风控
├── 最低余额要求（可用余额 > 30 USDT）
├── 最小名义价值（>= 20 USDT）
├── 动态止损（ATR × 止损倍率）
├── 仓位互斥（同一交易对只能有一个仓位）
├── 最大风险比例（单笔亏损不超过配置值）
└── 开仓后立即设置 STOP_MARKET 止损单

系统降级
├── AI 缓存 10 分钟（相同数据不重复调用）
├── API 失败时安全返回 `idle` 不交易
└── AI 解析失败时返回安全默认值
```

---

## 🖥️ 前端界面

### 主仪表盘布局

```
┌─────────────────────────────────────────────────┐
│ 🎯 币安永续合约AI自动交易系统    🌙 暗色/亮色   │
├──────────┬──────────────────────────────────────┤
│ 状态面板  │  加密货币价格卡片                      │
│ ┌──────┐ │  ┌──────┐ ┌──────┐ ┌──────┐        │
│ │交易数 │ │  │ BTC  │ │ ETH  │ │ SOL  │  ...   │
│ │今日   │ │  │+2.3% │ │-1.5% │ │+0.8% │        │
│ ├──────┤ │  └──────┘ └──────┘ └──────┘        │
│ │盈亏  │ │                                      │
│ │余额  │ │  策略管理                             │
│ └──────┘ │  ┌────────────────────────────────┐  │
│          │  │ 策略列表 │ 启动/停止 │ 编辑/测试│  │
│ 当前持仓  │  └────────────────────────────────┘  │
│ ┌──────┐ │                                      │
│ │多头/空│ │  交易历史                             │
│ │头列表│ │  ┌────────────────────────────────┐  │
│ └──────┘ │  │ 表格 │ 筛选 │ 分页 │ 导出     │  │
│          │  └────────────────────────────────┘  │
│ 盈亏图表  │                                      │
│ ┌──────┐ │  系统日志                             │
│ │ECharts│ │  ┌────────────────────────────────┐  │
│ └──────┘ │  │ 实时日志流 │ 级别筛选          │  │
│          │  └────────────────────────────────┘  │
└──────────┴──────────────────────────────────────┘
```

### 前端组件一览

| 组件 | 功能 |
|------|------|
| **ActivePositions** | 当前持仓列表，显示盈亏、方向、杠杆、入场价、止盈止损 |
| **CryptoPriceCards** | 交易对实时价格卡片，显示涨跌幅 |
| **Strategies** | 策略列表管理，含启动/停止/编辑/测试/版本历史 |
| **TradeHistory** | 交易历史记录表格，支持筛选和分页 |
| **SystemLogs** | 实时系统日志展示 |
| **ProfitWinRateChart** | 盈亏/胜率走势 ECharts 图表 |
| **BotConfigDialog** | Bot 全局配置对话框 |
| **PasswordDialog** | 密码验证对话框（24 小时有效） |
| **TradingViewChartModal** | K 线图弹窗 |

### 功能特性

- **明暗双主题**：完善的 CSS 变量体系，Element Plus 暗色适配
- **密码保护**：配置修改和敏感操作需验证，24 小时免登录
- **共享实时价格流**：多个组件共享一条 SSE，引用计数自动启停
- **响应式布局**：桌面/移动端自适应

---

## 📡 API 接口总览

### Bot 状态/配置

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/bot/status` | 获取系统状态 |
| `GET` | `/api/bot/config` | 获取 Bot 配置 |
| `PUT` | `/api/bot/config` | 更新 Bot 配置 |

### 策略管理

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/strategies` | 获取所有策略 |
| `POST` | `/api/strategies` | 创建新策略 |
| `GET` | `/api/strategies/:id` | 获取策略详情 |
| `PUT` | `/api/strategies/:id` | 更新策略 |
| `DELETE` | `/api/strategies/:id` | 删除策略 |
| `POST` | `/api/strategies/:id/toggle` | 激活/停用策略 |
| `GET` | `/api/strategies/:id/versions` | 获取版本历史 |
| `POST` | `/api/strategies/:id/rollback` | 回滚版本 |
| `POST` | `/api/strategies/:id/test` | 测试策略信号 |

### 持仓管理

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/positions` | 获取所有持仓 |
| `POST` | `/api/positions/close` | 手动平仓 |
| `POST` | `/api/positions/force-open` | 强制开仓 |

### WebSocket / K 线

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/market/prices/stream` | SSE 实时价格快照与增量推送 |
| `GET` | `/api/websocket/prices` | 获取当前价格 |
| `GET` | `/api/kline-simple/:symbol` | 获取 K 线数据 |

---

## 💾 数据持久化

| 文件 | 用途 | 更新时机 |
|------|------|----------|
| `data/bot-config.json` | Bot 全局配置 | 配置修改时 |
| `data/bot-state.json` | Bot 运行状态 | 状态变化时 |
| `data/active-positions.json` | 活跃持仓列表 | 开仓/平仓时 |
| `data/symbol-locks.json` | 交易对锁映射 | 锁定/释放时 |
| `data/strategies/*.json` | 策略 + 版本历史 | 策略 CRUD 时 |
| `data/trade-history-analysis.json` | 交易分析数据 | 平仓时 |
| `data/square-heat-history.json` | 社交媒体热度 | 定期更新 |
| `data/kline-simple/*` | K 线数据（SQLite） | 定时同步 |
| `logs/*.log` | 系统运行日志 | 实时追加 |

---

## 🧪 测试与脚本

```bash
# 运行测试
node test/bian-square-heat-test.mjs      # SquareHeat 测试
node test/bian-square-tendency-test.mjs  # 趋势分析测试
node test/validate-pnl.mjs               # PnL 验证

# 数据脚本
node scripts/import-trade-history.mjs    # 导入交易历史
```

---

## ✨ 设计亮点

1. **按交易对聚合调度** — 避免重复获取市场数据，提高执行效率
2. **AI 缓存降级** — 相同市场数据不重复调用 AI API，节省成本
3. **Symbol 级互斥锁** — 确保同一交易对只有一个持仓，避免冲突
4. **本地持久化** — 程序重启后仓位状态不丢失
5. **多 AI 提供商** — DeepSeek/豆包/千问/OpenAI 灵活切换，防止单点故障
6. **版本控制** — 策略修改自动保存历史版本，支持一键回滚
7. **明暗双主题** — 完整的 CSS 变量体系，Element Plus 全面适配
8. **密码保护** — 配置修改和敏感操作需验证，24 小时免登录
9. **共享轮询机制** — 多个组件共享同一数据流，引用计数自动启停
10. **并发池控制** — AI 调用和指标计算都有严格并发限制，避免资源耗尽

---

## 🔧 开发指南

### 添加新交易对

1. 在 Bot 配置 `symbols` 中添加交易对（如 `["DOGE/USDT"]`）
2. WebSocket 会自动订阅新交易对的价格
3. 策略中配置要监控的交易对
4. 系统自动同步 K 线数据

### 创建新策略

1. 通过前端界面创建策略
2. 配置监控的交易对和时间周期
3. 选择启用的技术指标
4. 编写 AI 提示词
5. 设置风控参数
6. 激活策略即可自动运行

### 本地开发

```bash
# 启动开发服务器（热更新）
pnpm dev

# 检查 TypeScript 类型
npx nuxi typecheck

# 构建生产版本
pnpm build
```

---

## ⚠️ 风险声明

> **加密货币交易存在极高的风险。本项目仅供学习和研究使用，不构成任何投资建议。**
>
> - 使用前请充分测试，理解每个配置项的含义
> - 建议先用小资金在模拟环境中验证策略效果
> - 开发者不对因使用本系统造成的任何资金损失负责
> - 请遵守当地法律法规，合规使用

---

## 📄 开源协议

[MIT License](LICENSE)

---

## 📬 联系方式

- **项目地址**：<https://github.com/q573927428/ai-bian>
- **问题反馈**：[Issues](https://github.com/q573927428/ai-bian/issues)

---

*最后更新：2026 年 5 月 30 日*
