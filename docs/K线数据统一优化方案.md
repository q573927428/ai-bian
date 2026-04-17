# K线数据统一优化方案

## 一、问题分析

### 1.1 当前架构问题

**双重拉取机制：**
- `KLineSimpleSyncService`: 按周期定时拉取K线 → 存储到 `data/kline-simple/` 文件
- `IndicatorsHub`: 独立定时拉取K线 → 内存缓存 → 计算指标

**API请求压力估算（10个交易对）：**
```
IndicatorsHub（每60秒）:
  - K线请求: 10交易对 × 6周期 = 60次/分钟
  - OI请求: 10交易对 × 1次 = 10次/分钟
  - 总计: 70次/分钟 = 4200次/小时

KLineSimpleSyncService（按周期）:
  - 15m周期: 每15分钟同步一次
  - 1h周期: 每小时同步一次
  - ...
  - 总计: 约 5-10次/小时

两套系统并行: 约 4205-4210次/小时 ❌
```

### 1.2 币安API限制参考
- 权重限制: 1200权重/分钟
- 请求限制: 实际建议不超过 600次/分钟持续请求
- 当前系统: 4200次/小时 = 70次/分钟（接近警戒线）

---

## 二、优化目标

### 2.1 核心目标
1. ✅ **消除重复API请求**: IndicatorsHub不再直接调用币安API获取K线
2. ✅ **统一数据源**: IndicatorsHub直接读取 `data/kline-simple/` 文件
3. ✅ **降低API压力**: 从 4200次/小时 → 降至 10-20次/小时
4. ✅ **保持指标实时性**: K线文件更新后自动重新计算指标

### 2.2 性能收益
- API请求减少: **99%+**
- 计算资源节省: **50%+**（避免重复解析K线）
- 内存使用优化: 按需读取而非全量缓存

---

## 三、架构设计

### 3.1 新架构图

```
┌─────────────────────────────────────────────────────────┐
│                    KLineSimpleSyncService                │
│  👉 按周期对齐时间点拉取K线                              │
│  👉 存储到 data/kline-simple/{symbol}-{timeframe}.json  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              data/kline-simple/ (文件存储)               │
│  - BTCUSDT-15m.json                                      │
│  - BTCUSDT-1h.json                                       │
│  - ... (所有交易对+周期)                                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  IndicatorsHub (改造后)                  │
│  👉 从文件读取K线数据（按需）                            │
│  👉 计算指标（EMA/RSI/ADX等）                           │
│  👉 缓存指标结果（非K线原始数据）                        │
└─────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                    策略系统使用                           │
└─────────────────────────────────────────────────────────┘
```

### 3.2 数据流向

```
币安API → KLineSimpleSyncService → JSON文件 → IndicatorsHub → 指标计算 → 策略
                    ↓
              按周期调度（15m/1h/4h...）
```

---

## 四、执行步骤清单

### 阶段一：基础设施改造

- [x] **步骤1.1**: 增强 `kline-simple-storage.ts`，添加OHLCV格式转换函数
  - 新增 `getSimpleKLineAsOHLCV()` 函数
  - 将 SimpleKLineData 转换为 OHLCV 格式供 IndicatorsHub 使用
  - 新增 `getKLineFileMTime()` 函数获取文件修改时间
  - 新增 `hasKLineData()` 函数检查文件是否存在

- [x] **步骤1.2**: 在 `kline-simple-storage.ts` 中添加文件修改时间监听
  - ✅ 通过 `getKLineFileMTime()` 实现被动检查（无需复杂的文件监听）

### 阶段二：IndicatorsHub 核心改造

- [x] **步骤2.1**: 修改 `IndicatorsHub` 构造函数和初始化
  - 移除 `fetchAndCacheKlines()` 方法（不再直接API拉取）
  - 添加从文件加载K线的方法 `loadKlinesFromFile()`
  - 添加周期映射 `TIMEFRAME_MAP`（15m/1h/4h/1d 支持，1m/5m 暂不支持）

- [x] **步骤2.2**: 重构K线数据获取逻辑
  - `getKlines()` 改为从文件读取（带内存缓存）
  - 添加文件最后修改时间检查，过期自动重新加载

- [x] **步骤2.3**: 优化缓存策略
  - K线原始数据: 按需从文件加载，带内存缓存
  - 指标计算结果: 保留在内存缓存
  - 添加 `invalidateIndicatorsCache()` 缓存失效机制（文件更新时清除相关指标缓存）

- [x] **步骤2.4**: 保留必要的API调用
  - OI（持仓量）: 仍需从API获取（K线文件不包含）
  - 定时刷新间隔保持 60秒（可后续优化）

### 阶段三：集成与事件驱动

- [x] **步骤3.1**: 建立 KLineSimpleSyncService → IndicatorsHub 事件通知
  - ✅ 通过文件修改时间被动检测（无需复杂事件系统）
  - IndicatorsHub 在 `getKlines()` 时自动检查文件是否更新

- [ ] **步骤3.2**: 修改定时更新策略
  - `startUpdateLoop()` 间隔: 保持 60秒（主要用于OI数据）
  - K线更新依赖文件变化检测

### 阶段四：测试与验证

- [ ] **步骤4.1**: 单元测试
  - 测试文件读取转换
  - 测试指标计算准确性

- [ ] **步骤4.2**: 集成测试
  - 验证K线同步后指标自动更新
  - 验证API请求量显著减少

- [ ] **步骤4.3**: 性能监控
  - 记录改造前后API请求数对比
  - 记录内存使用情况

---

## 五、详细实施计划

### 5.1 文件修改清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `server/utils/kline-simple-storage.ts` | 增强 | 添加OHLCV转换、文件监听 |
| `server/modules/indicators/IndicatorsHub.ts` | 重构 | 核心改造，从文件读取K线 |
| `server/plugins/kline-sync.ts` | 增强 | 导出同步服务实例，添加事件 |
| `server/modules/kline-simple-sync/index.ts` | 增强 | 添加同步完成事件回调 |

### 5.2 关键代码变更点

#### 5.2.1 kline-simple-storage.ts 新增函数

```typescript
// 新增：获取OHLCV格式的K线数据
export function getSimpleKLineAsOHLCV(
  symbol: string,
  timeframe: KLineTimeframe,
  limit?: number
): OHLCV[] {
  const simpleData = getSimpleKLineData(symbol, timeframe, { limit })
  return simpleData.map(item => ({
    timestamp: item.t * 1000, // 转换为毫秒
    open: item.o,
    high: item.h,
    low: item.l,
    close: item.c,
    volume: item.v
  }))
}

// 新增：获取文件最后修改时间
export function getKLineFileMTime(
  symbol: string,
  timeframe: KLineTimeframe
): number | null {
  try {
    const filePath = getFilePath(symbol, timeframe)
    const stats = fs.statSync(filePath)
    return stats.mtimeMs
  } catch {
    return null
  }
}
```

#### 5.2.2 IndicatorsHub.ts 核心变更

```typescript
// 移除：fetchAndCacheKlines()
// 新增：loadKlinesFromFile()

private async loadKlinesFromFile(symbol: string, timeframe: Timeframe): Promise<OHLCV[]> {
  const limit = this.config.indicatorsConfig?.requiredCandles || 300
  const klines = getSimpleKLineAsOHLCV(symbol, timeframe as KLineTimeframe, limit)
  return klines
}

// 修改：getKlines() 检查文件时间
private fileMTimes: Map<string, number> = new Map()

getKlines(symbol: string, timeframe: Timeframe): OHLCV[] | undefined {
  const symbolData = this.getOrCreateSymbolData(symbol)
  const cacheKey = `${symbol}_${timeframe}`
  
  // 检查文件是否更新
  const currentMTime = getKLineFileMTime(symbol, timeframe as KLineTimeframe)
  const cachedMTime = this.fileMTimes.get(cacheKey)
  
  if (!currentMTime || currentMTime !== cachedMTime) {
    // 文件已更新，重新加载
    const klines = getSimpleKLineAsOHLCV(
      symbol, 
      timeframe as KLineTimeframe,
      this.config.indicatorsConfig?.requiredCandles || 300
    )
    symbolData.klineData.set(timeframe, klines)
    if (currentMTime) {
      this.fileMTimes.set(cacheKey, currentMTime)
    }
    // 清除相关指标缓存
    this.invalidateIndicatorsCache(symbol, timeframe)
  }
  
  return symbolData.klineData.get(timeframe)
}
```

---

## 六、风险与缓解措施

### 6.1 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 文件读取延迟 | 指标获取变慢 | 添加内存缓存，仅在文件更新时重读 |
| 文件不存在 | 初始化失败 | 启动时检查数据文件，提示先同步 |
| 并发读写冲突 | 数据损坏 | KLineSimpleSyncService 写入时使用原子操作 |
| OI数据延迟 | 策略信号受影响 | 仍保持定时刷新，可配置间隔 |

### 6.2 回滚方案
如遇问题，可通过 git  revert 快速回滚到改造前版本

---

## 七、成功验收标准

- [ ] API请求量减少 90% 以上
- [ ] 指标计算结果与改造前一致（误差 < 0.1%）
- [ ] 系统启动时间减少（不再初始拉取大量K线）
- [ ] 内存使用稳定或降低
- [ ] 所有现有功能正常工作

---

## 八、后续优化方向（可选）

1. **内存映射文件**: 对于超大K线文件使用 mmap 提升读取性能
2. **Redis缓存**: 分布式部署时可引入Redis共享指标缓存
3. **增量指标计算**: K线仅更新最后一根时，增量更新指标而非全量重算