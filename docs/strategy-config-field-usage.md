# 配置字段使用情况分析报告

## 分析时间
2026-04-17

## 分析方法
- 搜索整个 server 目录中配置字段的使用情况
- 对比 types/index.ts 中的类型定义
- 检查实际运行代码中的引用

---

## ✅ 已使用的配置字段

### 核心配置
| 字段 | 使用位置 | 说明 |
|------|---------|------|
| `strategyMode` | indicators-core.ts, indicators-shared.ts | 确定策略模式（短期/中期） |
| `symbols` | 多处 | 交易对列表 |
| `leverage` | 多处 | 杠杆倍数 |
| `maxRiskPercentage` | StrategyEngine.ts, risk.ts | 单笔最大风险 |
| `stopLossATRMultiplier` | StrategyEngine.ts | 止损ATR倍数 |
| `scanInterval` | StrategyEngine.ts | 市场扫描间隔 |

### indicatorsConfig
| 字段 | 使用位置 |
|------|---------|
| `requiredCandles` | indicators-core.ts, IndicatorsHub.ts |
| `emaPeriods` | indicators-shared.ts, indicators-core.ts |
| `adxTrend.adx15mThreshold` | indicators-core.ts |
| `adxTrend.adx1hThreshold` | indicators-core.ts |
| `adxTrend.adx4hThreshold` | indicators-core.ts |
| `adxTrend.enableAdx15mVs1hCheck` | indicators-core.ts |
| `crossEntryEnabled` | indicators-core.ts |
| `showCrossFailureReason` | indicators-core.ts |
| `predictiveCross` | indicators-core.ts |

### riskConfig
| 字段 | 使用位置 |
|------|---------|
| `circuitBreaker.dailyLossThreshold` | risk.ts, trade-helpers.ts |
| `circuitBreaker.consecutiveLossesThreshold` | risk.ts, trade-helpers.ts |
| `takeProfit.tp1RiskRewardRatio` | risk.ts |
| `takeProfit.tp2RiskRewardRatio` | risk.ts |
| `takeProfit.tp1MinProfitRatio` | risk.ts |
| `takeProfit.rsiExtreme.long` | risk.ts |
| `takeProfit.rsiExtreme.short` | risk.ts |
| `takeProfit.adxDecreaseThreshold` | risk.ts |
| `takeProfit.adxSlopePeriod` | indicators-core.ts |
| `dailyTradeLimit` | risk.ts |

### trailingStopConfig
| 字段 | 使用位置 | 注意 |
|------|---------|------|
| `enabled` | StrategyPositionMonitor.ts | |
| `activationRatio` | StrategyPositionMonitor.ts, trailing-stop.ts | |
| `trailingDistance` | StrategyPositionMonitor.ts, trailing-stop.ts | 代码中使用 `trailDistance`，类型定义使用 `trailingDistance` |
| `minMovePercent` | trailing-stop.ts | |

---

## ❌ 未使用的配置字段

### 完全未使用的字段
| 字段 | 建议 |
|------|------|
| `maxStopLossPercentage` | 删除 |
| `positionTimeoutHours` | 删除 |
| `positionScanInterval` | 删除 |
| `tradeCooldownInterval` | 删除 |

### aiConfig (整个对象未使用)
| 字段 | 说明 |
|------|------|
| `aiConfig.enabled` | 只在类型定义中存在 |
| `aiConfig.analysisInterval` | 只在类型定义中存在 |
| `aiConfig.minScore` | 只在类型定义中存在 |
| `aiConfig.minConfidence` | 只在类型定义中存在 |
| `aiConfig.conditionMode` | 只在类型定义中存在 |
| `aiConfig.maxRiskLevel` | 只在类型定义中存在 |
| `aiConfig.technicalPostAdjustmentMode` | 只在类型定义中存在 |
| `aiConfig.useForEntry` | 只在类型定义中存在 |
| `aiConfig.useForExit` | 只在类型定义中存在 |
| `aiConfig.cacheDuration` | 只在类型定义中存在 |

**建议**: 删除整个 `aiConfig` 对象

### dynamicLeverageConfig (整个对象未使用)
| 字段 | 说明 |
|------|------|
| `dynamicLeverageConfig.enabled` | 只在旧文件 dynamic-leverage.ts.old 中存在 |
| `dynamicLeverageConfig.minLeverage` | 同上 |
| `dynamicLeverageConfig.maxLeverage` | 同上 |
| `dynamicLeverageConfig.baseLeverage` | 同上 |
| `dynamicLeverageConfig.riskLevelMultipliers` | 同上 |

**建议**: 删除整个 `dynamicLeverageConfig` 对象

### indicatorsConfig 中未使用的字段
| 字段 | 说明 |
|------|------|
| `indicatorsConfig.entryConfig` | 只在旧文件 indicators-entry.ts.old 中存在 |
| `indicatorsConfig.volatility` | 只在类型定义中存在 |
| `indicatorsConfig.priceAction` | 只在旧文件和类型定义中存在 |
| `indicatorsConfig.openInterest` | 只在类型定义中存在 |
| `indicatorsConfig.priceBreakout` | 只在旧文件 indicators-entry.ts.old 中存在 |

**建议**: 从类型定义和配置文件中删除这些字段

### riskConfig.forceLiquidateTime
| 字段 | 说明 |
|------|------|
| `forceLiquidateTime.enabled` | 只在类型定义中存在，代码中有默认值但未实际使用 |
| `forceLiquidateTime.hour` | 同上 |
| `forceLiquidateTime.minute` | 同上 |

**建议**: 删除

---

## 📋 清理清单

### 1. 从 data/bot-config.json 中删除
```json
{
  "maxStopLossPercentage": 2,
  "positionTimeoutHours": 6,
  "positionScanInterval": 30,
  "tradeCooldownInterval": 3600,
  "aiConfig": { ... },
  "dynamicLeverageConfig": { ... },
  "riskConfig": {
    "forceLiquidateTime": { ... }
  },
  "indicatorsConfig": {
    "entryConfig": { ... },
    "volatility": { ... },
    "priceAction": { ... },
    "openInterest": { ... },
    "priceBreakout": { ... }
  }
}
```

### 2. 从 types/index.ts 中删除
- `AIConfig` 接口
- `DynamicLeverageConfig` 接口
- `PriceBreakoutConfig` 接口
- `VolatilityFilterConfig` 接口
- `PriceActionConfig` 接口
- `BotConfig` 中对应的字段引用
- `IndicatorsConfig` 中对应的字段引用

### 3. 注意事项
- `trailingStopConfig.trailDistance` vs `trailingDistance`：代码和类型定义不一致，需要统一