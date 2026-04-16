# 配置文件清理报告

## 分析日期
2026-04-17

## 分析范围
- `data/bot-config.json` 中的所有配置字段
- 项目中 `server/` 目录下的所有 `.ts` 源文件

---

## 一、已使用的配置字段

### 1. 顶层字段
| 字段 | 使用位置 | 说明 |
|------|---------|------|
| `strategyMode` | `indicators-shared.ts`, `indicators-core.ts` | 策略模式（短期/中长期） |
| `symbols` | `kline-sync.ts`, `IndicatorsHub.ts` | 交易对列表 |
| `leverage` | `trade-helpers.ts`, `risk.ts`, `binance.ts` | 杠杆倍数 |
| `maxRiskPercentage` | `StrategyEngine.ts` | 单笔最大风险百分比 |
| `stopLossATRMultiplier` | `StrategyEngine.ts` | 止损ATR倍数 |
| `scanInterval` | `StrategyEngine.ts` | 扫描间隔（秒） |

### 2. `indicatorsConfig` 字段
| 字段 | 使用位置 | 说明 |
|------|---------|------|
| `requiredCandles` | `indicators-core.ts`, `IndicatorsHub.ts` | 需要的K线数量 |
| `emaPeriods` | `indicators-shared.ts` | EMA周期配置 |
| `adxTrend` | `indicators-core.ts` | ADX趋势阈值 |
| `crossEntryEnabled` | `indicators-core.ts` | 是否启用交叉入场 |
| `showCrossFailureReason` | `indicators-core.ts` | 是否显示交叉失败原因 |
| `predictiveCross` | `indicators-core.ts` | 预判交叉配置 |
| `openInterest` | `indicators-core.ts` | 持仓量配置 |

### 3. `riskConfig` 字段
| 字段 | 使用位置 | 说明 |
|------|---------|------|
| `takeProfit.adxSlopePeriod` | `indicators-core.ts` | ADX斜率周期 |

---

## 二、未使用的配置字段（可删除）

### 1. 顶层字段（共5个）
| 字段 | 说明 |
|------|------|
| `maxStopLossPercentage` | 最大止损百分比 |
| `positionTimeoutHours` | 持仓超时时间（小时） |
| `positionScanInterval` | 持仓扫描间隔 |
| `tradeCooldownInterval` | 交易冷却间隔 |
| `aiConfig` | AI分析配置 |
| `dynamicLeverageConfig` | 动态杠杆配置 |
| `trailingStopConfig` | 移动止损配置 |

### 2. `indicatorsConfig` 字段（共4个）
| 字段 | 说明 |
|------|------|
| `priceBreakout` | 价格突破配置 |
| `entryConfig` | 入场配置 |
| `volatility` | 波动率配置 |
| `priceAction` | 价格行为配置 |

### 3. `riskConfig` 字段（共3个）
| 字段 | 说明 |
|------|------|
| `circuitBreaker` | 熔断配置 |
| `forceLiquidateTime` | 强制平仓时间 |
| `takeProfit` （除 `adxSlopePeriod` 外） | 止盈配置的大部分字段 |
| `dailyTradeLimit` | 每日交易限制 |

---

## 三、清理建议

### 3.1 保留原因说明
以下字段虽然在 `bot-config.json` 中未直接使用，但它们已迁移到多策略架构中：
- `trailingStopConfig` → 现在在 `strategy.riskManagement.trailingStop` 中使用
- `riskConfig` 的大部分字段 → 现在在 `strategy.riskManagement` 中使用
- `leverage`, `maxRiskPercentage`, `stopLossATRMultiplier` → 现在在策略配置中使用

### 3.2 建议删除的字段
```json
{
  "aiConfig": {},
  "dynamicLeverageConfig": {},
  "maxStopLossPercentage": 2,
  "positionTimeoutHours": 6,
  "positionScanInterval": 30,
  "tradeCooldownInterval": 3600,
  "indicatorsConfig": {
    "priceBreakout": {},
    "entryConfig": {},
    "volatility": {},
    "priceAction": {}
  },
  "riskConfig": {
    "circuitBreaker": {},
    "forceLiquidateTime": {},
    "takeProfit": {
      "tp1RiskRewardRatio": 2.5,
      "tp2RiskRewardRatio": 3.5,
      "tp1MinProfitRatio": 1,
      "rsiExtreme": {},
      "adxDecreaseThreshold": 2
    },
    "dailyTradeLimit": 5
  },
  "trailingStopConfig": {}
}
```

### 3.3 清理后的最小配置
```json
{
  "strategyMode": "medium_term",
  "symbols": [
    "BTC/USDT",
    "ETH/USDT",
    "SOL/USDT",
    "DOGE/USDT",
    "HYPE/USDT",
    "XAU/USDT",
    "XAG/USDT",
    "BNB/USDT"
  ],
  "leverage": 10,
  "maxRiskPercentage": 20,
  "stopLossATRMultiplier": 2.5,
  "scanInterval": 180,
  "indicatorsConfig": {
    "requiredCandles": 300,
    "emaPeriods": {
      "short_term": {
        "fast": 14,
        "medium": 30,
        "slow": 60
      },
      "medium_term": {
        "fast": 14,
        "medium": 60,
        "slow": 120
      }
    },
    "adxTrend": {
      "adx15mThreshold": 43,
      "adx1hThreshold": 48,
      "adx4hThreshold": 45,
      "enableAdx15mVs1hCheck": false
    },
    "crossEntryEnabled": false,
    "showCrossFailureReason": true,
    "predictiveCross": {
      "enabled": true,
      "distancePercent": 0.0012,
      "onlyTrend": true
    },
    "openInterest": {
      "enabled": true,
      "trendPeriod": 12,
      "changePeriod": {
        "short_term": 96,
        "medium_term": 24
      },
      "trendThresholdPercent": 0.5
    }
  },
  "riskConfig": {
    "takeProfit": {
      "adxSlopePeriod": 3
    }
  }
}
```

---

## 四、注意事项

1. **多策略架构迁移**：大部分风控和止损配置已迁移到策略级别配置中，不再需要在全局 `bot-config.json` 中定义

2. **`riskConfig.takeProfit.adxSlopePeriod`**：这个字段仍在 `indicators-core.ts` 中被使用，需要保留

3. **类型定义同步**：删除配置字段后，需要同步更新 `types/index.ts` 中的 `BotConfig` 接口定义

4. **向后兼容**：如果需要保留向后兼容性，可以先将未使用字段标记为 `@deprecated`，而不是直接删除