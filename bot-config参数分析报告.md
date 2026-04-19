# bot-config.json 参数使用分析报告

## 分析时间
2026/4/19

## 配置文件内容
```json
{
  "strategyMode": "medium_term",
  "symbols": ["BTC/USDT", "ETH/USDT", ...],
  "leverage": 10,
  "maxRiskPercentage": 20,
  "stopLossATRMultiplier": 2.5,
  "scanInterval": 60,
  "indicatorsConfig": {
    "requiredCandles": 300,
    "emaPeriods": { ... },
    "openInterest": { ... }
  },
  "riskConfig": {
    "takeProfit": {
      "adxSlopePeriod": 3
    }
  }
}
```

---

## ✅ 已使用的参数

### 1. `symbols`
**使用位置：**
- `server/modules/indicators/IndicatorsHub.ts` 第 175 行
  ```typescript
  const symbols = this.config.symbols || []
  ```
  用于初始化所有交易对的数据

- `server/plugins/kline-sync.ts`
  用于读取交易对列表进行 K线数据同步

### 2. `indicatorsConfig.requiredCandles`
**使用位置：**
- `server/modules/indicators/IndicatorsHub.ts` 第 225 行
  ```typescript
  const limit = this.config.indicatorsConfig?.requiredCandles || 300
  ```
- `server/modules/indicators/IndicatorsHub.ts` 第 296 行
  ```typescript
  const limit = this.config.indicatorsConfig?.requiredCandles || 300
  ```
  用于限制从文件加载的 K线数量

---

## ❌ 未使用的参数

### 1. `strategyMode`
**状态：完全未使用**
- 代码中没有任何地方引用该参数
- 建议删除

### 2. `leverage`
**状态：未使用（从策略配置读取）**
- 杠杆现在从 `strategy.executionConfig.leverage` 读取
- 详见 `StrategyEngine.ts` 第 529 行
- 建议删除

### 3. `maxRiskPercentage`
**状态：未使用（从策略配置读取）**
- 风险比例现在从 `strategy.riskManagement.maxRiskPercentage` 读取
- 详见 `StrategyEngine.ts` 第 547、556 行
- 建议删除

### 4. `stopLossATRMultiplier`
**状态：未使用（从策略配置读取）**
- 止损ATR倍数现在从 `strategy.riskManagement.stopLossATRMultiplier` 读取
- 详见 `StrategyEngine.ts` 第 525 行
- 建议删除

### 5. `scanInterval`
**状态：未使用（从策略配置读取）**
- 扫描间隔现在从 `strategy.executionConfig.scanInterval` 读取
- 详见 `StrategyEngine.ts` 第 203 行
- 建议删除

### 6. `indicatorsConfig.emaPeriods`
**状态：完全未使用**
- `short_term` 和 `medium_term` 的 EMA 周期配置从未被引用
- EMA 周期现在从策略配置动态获取
- 建议删除整个 `emaPeriods` 对象

### 7. `indicatorsConfig.openInterest`
**状态：完全未使用**
- `enabled`、`trendPeriod`、`changePeriod`、`trendThresholdPercent` 都未被使用
- OI 数据获取是硬编码的，不依赖这些配置
- 建议删除整个 `openInterest` 对象

### 8. `riskConfig.takeProfit.adxSlopePeriod`
**状态：未使用（硬编码）**
- ADX 斜率周期在代码中硬编码为 3
- 详见 `IndicatorsHub.ts` 第 538、821 行
- 建议删除

---

## 📋 总结

### 保留参数（2个）
```json
{
  "symbols": ["BTC/USDT", "ETH/USDT", ...],
  "indicatorsConfig": {
    "requiredCandles": 300
  }
}
```

### 删除参数（8个）
- strategyMode
- leverage
- maxRiskPercentage
- stopLossATRMultiplier
- scanInterval
- indicatorsConfig.emaPeriods
- indicatorsConfig.openInterest
- riskConfig.takeProfit.adxSlopePeriod

### 原因说明
大部分参数已迁移到**策略级别配置**（Strategy 配置文件），每个策略可以独立设置这些参数，bot-config.json 现在只负责全局的交易对列表和 K线数据配置。