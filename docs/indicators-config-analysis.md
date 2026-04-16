# IndicatorsConfig 参数使用分析报告

## 分析日期
2026-04-17

## 分析范围
- `data/bot-config.json` 中的 `indicatorsConfig` 配置
- `server/utils/indicators-core.ts` 指标计算核心逻辑
- `server/utils/indicators-shared.ts` 指标共享工具
- `types/index.ts` 类型定义
- 整个 `server/` 目录下的所有 TypeScript 源文件

---

## 一、实际被使用的参数

### 1. `requiredCandles`
- **使用位置**: `server/utils/indicators-core.ts:25`
- **用途**: 指定获取K线数据的数量
- **代码示例**:
  ```typescript
  const requiredCandles = config?.indicatorsConfig?.requiredCandles || 300
  ```

### 2. `emaPeriods`
- **使用位置**: `server/utils/indicators-shared.ts:17-21`
- **用途**: 根据策略模式获取EMA周期配置
- **代码示例**:
  ```typescript
  const periods = config?.indicatorsConfig?.emaPeriods
  const fast = periods?.[strategyMode]?.fast || (strategyMode === 'medium_term' ? 50 : 20)
  const medium = periods?.[strategyMode]?.medium || (strategyMode === 'medium_term' ? 100 : 30)
  const slow = periods?.[strategyMode]?.slow || (strategyMode === 'medium_term' ? 200 : 60)
  ```

### 3. `openInterest`
- **使用位置**: `server/utils/indicators-core.ts:119-171`
- **用途**: 持仓量(OI)相关计算
- **使用的子字段**:
  - `enabled` - 是否启用OI计算
  - `trendPeriod` - OI趋势计算周期
  - `changePeriod` - OI变化率计算周期
  - `trendThresholdPercent` - OI趋势判断阈值

---

## 二、未被使用的参数（可删除）

### 1. `adxTrend` （整个对象）
- **未使用的子字段**:
  - `adx15mThreshold`
  - `adx1hThreshold`
  - `adx4hThreshold`
  - `enableAdx15mVs1hCheck`
- **说明**: ADX指标仍在计算，但这些阈值配置没有被使用

### 2. `crossEntryEnabled`
- **说明**: 交叉入场开关配置，未被使用

### 3. `showCrossFailureReason`
- **说明**: 显示交叉失败原因配置，未被使用

### 4. `predictiveCross` （整个对象）
- **未使用的子字段**:
  - `enabled`
  - `distancePercent`
  - `onlyTrend`
- **说明**: 预判交叉功能配置，未被使用

---

## 三、清理建议

### 3.1 建议删除的配置
```json
{
  "indicatorsConfig": {
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
    }
  }
}
```

### 3.2 清理后的最小配置
```json
{
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
    "openInterest": {
      "enabled": true,
      "trendPeriod": 12,
      "changePeriod": {
        "short_term": 96,
        "medium_term": 24
      },
      "trendThresholdPercent": 0.5
    }
  }
}
```

### 3.3 需要同步更新的类型定义
在 `types/index.ts` 中的 `IndicatorsConfig` 接口需要删除以下字段：
- `adxTrend`
- `crossEntryEnabled`
- `showCrossFailureReason`
- `predictiveCross`

同时也可以删除相关的类型定义：
- `PredictiveCrossConfig` 接口

---

## 四、验证结果

通过对整个 `server/` 目录的正则搜索确认：
- `adxTrend` - 0 个匹配
- `crossEntryEnabled` - 0 个匹配
- `showCrossFailureReason` - 0 个匹配
- `predictiveCross` - 0 个匹配

这些配置字段在代码中确实没有被使用，可以安全删除。

---

## 五、注意事项

1. **向后兼容**: 如果需要保留向后兼容性，可以先将未使用字段标记为 `@deprecated`，而不是直接删除

2. **类型同步**: 删除配置字段后，必须同步更新 `types/index.ts` 中的类型定义，避免 TypeScript 类型错误

3. **配置文件**: 需要同时更新 `data/bot-config.json` 和任何其他相关的配置文件

4. **文档更新**: 如果有相关文档，也需要同步更新以反映配置的变化