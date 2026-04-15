# 策略分析字段优化文档

## 概述

为了支持更深入的历史订单分析和策略优化，我们对交易历史数据进行了全面升级。除了用户要求的MFE（最大浮盈）和MAE（最大浮亏）字段外，我们还添加了多个维度的分析字段。

## 新增字段分类

### 1. MFE/MAE指标（核心需求）
- **mfe**: 持仓期间最大浮盈金额（USDT）
- **mfePercentage**: 持仓期间最大浮盈百分比
- **mae**: 持仓期间最大浮亏金额（USDT）
- **maePercentage**: 持仓期间最大浮亏百分比

### 2. 风险回报指标
- **riskAmount**: 风险金额（初始止损对应的亏损金额）
- **rewardAmount**: 实际盈利金额（只计算正盈利）
- **riskRewardRatio**: 风险回报比（rewardAmount / riskAmount）

### 3. 入场指标（开仓时记录）
- **entryRSI**: 入场时的RSI值
- **entryADX15m**: 入场时的15分钟ADX值
- **entryADX1h**: 入场时的1小时ADX值
- **entryADX4h**: 入场时的4小时ADX值
- **entryEMA20**: 入场时的20周期EMA
- **entryEMA60**: 入场时的60周期EMA
- **entryPriceToEMA20Deviation**: 入场价格相对于EMA20的偏离度百分比
- **entryPriceToEMA60Deviation**: 入场价格相对于EMA60的偏离度百分比

### 4. AI分析指标（开仓时记录）
- **aiConfidence**: AI置信度（0-100）
- **aiScore**: AI综合评分（0-100）
- **aiRiskLevel**: AI风险等级（LOW/MEDIUM/HIGH）
- **aiReasoning**: AI分析理由
- **aiSupport**: AI分析的支撑位价格
- **aiResistance**: AI分析的阻力位价格
- **aiKeyFactors**: AI分析的关键因素列表

### 5. 出场指标（平仓时记录）
- **exitRSI**: 出场时的RSI值
- **exitADX15m**: 出场时的15分钟ADX值
- **exitADX1h**: 出场时的1小时ADX值
- **exitADX4h**: 出场时的4小时ADX值
- **exitEMA20**: 出场时的20周期EMA
- **exitEMA60**: 出场时的60周期EMA

### 5. 波动性指标
- **averageATR**: 持仓期间的平均ATR值
- **priceRangePercentage**: 价格波动范围百分比（最高价-最低价）/入场价
- **maxDrawdownPercentage**: 最大回撤百分比（基于MAE）

### 6. 资金管理指标
- **positionSizePercentage**: 仓位大小百分比（仓位价值/假设总资金）
- **actualLeverage**: 实际使用的杠杆倍数
- **marginUsed**: 使用的保证金金额

### 7. 时间特征
- **tradeHour**: 交易小时（0-23）
- **tradeDayOfWeek**: 交易星期几（0=周日，1=周一，...，6=周六）
- **tradeMonth**: 交易月份（1-12）

### 8. 退出原因分类
- **exitReasonCategory**: 退出原因分类
  - `TP1`: 止盈1
  - `TP2`: 止盈2
  - `STOP_LOSS`: 止损
  - `TIMEOUT`: 超时
  - `FORCE_LIQUIDATE`: 强制平仓
  - `TRAILING_STOP`: 移动止损
  - `OTHER`: 其他

### 9. 价格历史（可选）
- **priceHistory**: 价格历史记录数组，包含：
  - timestamp: 时间戳
  - price: 价格
  - pnl: 当时盈亏
  - pnlPercentage: 当时盈亏百分比

## 新增系统组件

### 1. 策略分析器 (StrategyAnalyzer)
- 实时跟踪MFE/MAE
- 记录价格历史
- 收集入场和出场指标
- 生成完整的分析指标

### 2. 分析数据存储 (analysis-storage.ts)
- 保存策略分析指标到JSON文件
- 提供统计计算功能
- 支持按交易对、退出原因等分类统计

### 3. API端点
- `GET /api/analysis/metrics`: 获取策略分析数据（支持筛选和分页）
- `GET /api/analysis/export`: 导出分析数据为JSON/CSV格式

### 4. 前端界面
- `strategy-analysis.vue`: 策略分析仪表板
  - 统计数据概览
  - 退出原因分析图表
  - 交易对表现表格
  - 详细交易记录
  - 数据导出功能

## 数据分析能力

### 1. 基础统计
- 总交易次数
- 总盈亏
- 胜率
- 平均风险回报比
- 平均MFE/MAE

### 2. 分类分析
- 按退出原因分析表现
- 按交易对分析表现
- 按方向（做多/做空）分析表现
- 按时间特征分析表现

### 3. 策略优化洞察
- **MFE/MAE分析**: 了解策略的潜在盈利能力和风险控制
- **风险回报比**: 评估策略的效率
- **入场时机分析**: 通过入场指标分析最佳开仓条件
- **出场原因分析**: 了解不同退出策略的效果

## 使用示例

### 1. 查看策略分析仪表板
访问 `/strategy-analysis` 页面查看完整的分析仪表板。

### 2. 导出数据进行分析
通过API端点导出数据，使用Excel、Python或R进行更深入的分析：
```
GET /api/analysis/export?format=json
GET /api/analysis/export?format=csv&symbol=BTCUSDT
```

### 3. 通过API获取数据
```javascript
// 获取今日所有交易的分析数据
fetch('/api/analysis/metrics?today=true')

// 获取BTCUSDT做多交易的分析数据
fetch('/api/analysis/metrics?symbol=BTCUSDT&direction=LONG')

// 获取按退出原因分类的统计数据
fetch('/api/analysis/metrics').then(res => res.json()).then(data => {
  console.log(data.data.exitReasonStats)
})
```

## 技术实现细节

### 1. 数据收集流程
1. 开仓时：初始化策略分析器，记录入场指标
2. 持仓期间：实时更新价格，计算MFE/MAE
3. 平仓时：记录出场指标，生成完整分析数据

### 2. 数据存储格式
分析数据存储在 `data/strategy-analysis.json` 文件中，与原有的 `trade-history.json` 分开存储，避免数据污染。

### 3. 性能考虑
- 价格历史记录采用采样策略（每5分钟或价格变化超过0.5%）
- 指标计算采用缓存机制，避免频繁计算
- 数据分页加载，支持大数据集

## 后续优化建议

### 1. 高级分析功能
- 夏普比率计算
- 最大连续亏损分析
- 资金曲线分析
- 相关性分析（不同交易对之间的相关性）

### 2. 机器学习集成
- 使用历史数据训练预测模型
- 自动识别最佳入场/出场条件
- 风险参数优化

### 3. 实时监控
- 实时MFE/MAE显示
- 风险暴露监控
- 异常交易检测

## 总结

通过这次优化，交易历史数据现在包含了丰富的分析字段，特别是用户要求的MFE和MAE指标。这些数据将为策略优化提供强大的支持，帮助用户：

1. **评估策略表现**: 通过MFE/MAE了解策略的潜在盈利能力和风险
2. **优化入场时机**: 分析入场指标与最终结果的关系
3. **改进出场策略**: 分析不同退出原因的表现
4. **风险管理**: 通过风险回报比等指标优化资金管理

所有新增功能都已集成到现有系统中，用户可以通过Web界面直观地查看和分析这些数据。