# 资金流与 OI 联合判断图表改造方案

## 1. 目标与边界

在现有 K 线图下方增加“主动买卖成交额差 + Open Interest（OI）”指标区域，用于观察当前 K 线的资金流向、持仓变化和二者的联合状态。

本方案采用“首次有限补充，后续随 K 线追加”的策略：

- 每个交易对、每个周期继续保留现有的 2233 根 K 线。
- 不要求补齐更早历史 K 线的 OI。
- 首次使用时，只补充 Binance 当前能够提供的近期 OI。
- 后续在 K 线同步时顺带采集和保存最新 OI。
- 历史 OI 缺失时显示为空，不使用 0 代替。

## 2. 当前项目基础

| 模块 | 文件 | 当前职责 |
| --- | --- | --- |
| K 线页面容器 | app/components/kline-chart/KLineChartSimple.vue | 请求 K 线、管理周期和刷新 |
| 自研图表 | app/components/kline-chart/KLineChartCanvas.vue | 使用 lightweight-charts 绘制 K 线和成交量 |
| 引擎切换 | app/components/kline-chart/ChartEngineSwitcher.vue | 切换自研图表和 TradingView |
| K 线同步 | server/modules/kline-simple-sync/index.ts | 从 Binance 拉取和保存 K 线 |
| K 线接口 | server/api/kline-simple/index.ts | 向前端返回 K 线数据 |
| Binance 封装 | server/utils/binance.ts | 获取 K 线、当前 OI、历史 OI |
| OI 快照 | server/modules/indicators/OISnapshotService.ts | 短期内存 OI 序列和变化率计算 |

当前 K 线使用 SQLite `data/kline.db` 存储。`SimpleKLineData` 和 SQLite 已扩展资金流、OI 及联合状态字段；旧数据库启动时自动补列，旧记录的新增字段保持 `NULL`。

## 3. 指标口径

### 3.1 主动买卖成交额

使用 Binance Futures K 线的报价资产成交额字段：

- quoteVolume：总成交额
- takerBuyQuoteVolume：主动买入成交额

计算公式：

主动买入成交额 = takerBuyQuoteVolume

主动卖出成交额 = quoteVolume - takerBuyQuoteVolume

主动成交额差 = 主动买入成交额 - 主动卖出成交额
            = 2 × takerBuyQuoteVolume - quoteVolume

主动成交额差比例 = 主动成交额差 / quoteVolume

存储字段 `activeDeltaRatio` 使用小数比例（例如 `0.05` 表示 5%）；分类器计算阈值时转换为百分点。

使用 USDT 成交额而不是基础资产数量，便于不同价格阶段比较。

### 3.2 OI 变化

每根 K 线保存一个 OI 快照。项目统一使用当前 K 线与上一根有效 OI 快照进行比较：

oiPrevious = 上一根有效 OI 快照

oiChange = currentOI - oiPrevious

oiChangePercent = oiChange / oiPrevious × 100

上一根有效 OI 可以跨过历史缺失点向前查找；当前值或基准值缺失、非有限或小于等于 0 时返回空值，不使用 0 代替。

该口径直接反映每个周期的边际持仓变化，图表展示、联合状态、API 和策略输入保持一致；代价是短周期更容易受单根采样波动影响，需要依靠周期阈值和临时 K 线标记控制噪声。

OI 快照按时间桶与 K 线对齐。Binance `openInterestHist` 仅支持 `5m`、`15m`、`30m`、`1h`、`2h`、`4h`、`6h`、`12h`、`1d`，且只提供最近约 1 个月；项目没有请求 `1w` OI。超出 Binance 覆盖范围的 K 线保留为空。

### 3.3 当前未收盘 K 线

当前 K 线的资金流和 OI 会持续变化，写入 oiProvisional: true。收盘后由下一次同步写入最终值，并设为 false。

## 4. 基于资金流 EMA 和 OI 上一根快照的联合判断

不能仅用主动成交额差和 OI 变化的正负判断状态。资金流需要判断当前值相对自身 12 周期 EMA 的偏离；OI 使用当前 OI 相对上一根有效 OI 的变化率。两者分别使用不同基准，再与当前周期阈值比较。

### 4.1 资金流偏离

activeDeltaRatio = activeDelta / quoteVolume × 100

activeDeltaEma12 = EMA(activeDeltaRatio, 12)

activeFlowDeviation = activeDeltaRatio - activeDeltaEma12

activeFlowDeviation 的单位为百分点，不是 USDT 金额。

### 4.2 OI 变化方向

OI 方向直接使用上一根有效 OI 计算得到的 `oiChangePercent`，不再计算 OI 的 EMA：

oiPrevious = previous valid OI

oiChangePercent = (currentOI - oiPrevious) / oiPrevious × 100

oiDirection =
  oiChangePercent >= oiChangePercentThreshold -> positive
  oiChangePercent <= -oiChangePercentThreshold -> negative
  otherwise -> neutral

### 4.3 阈值方向

对每个 K 线周期分别配置：

- activeFlowDeviationThreshold：资金流比例相对 EMA 的最小有效偏离
- oiChangePercentThreshold：当前 OI 相对上一根有效 OI 的最小有效变化率

```text
flowDirection =
  activeFlowDeviation >= activeFlowDeviationThreshold  -> positive
  activeFlowDeviation <= -activeFlowDeviationThreshold -> negative
  otherwise                                             -> neutral

oiDirection =
  oiChangePercent >= oiChangePercentThreshold  -> positive
  oiChangePercent <= -oiChangePercentThreshold -> negative
  otherwise                            -> neutral
```

### 4.4 联合状态

| 资金流偏离方向 | OI 变化方向 | 联合状态 | 含义 |
| --- | --- | --- | --- |
| positive | positive | long-build | 资金流显著强于自身 EMA，OI 相对上一根有效 OI 显著增加，倾向多头增仓 |
| negative | positive | short-build | 资金流显著弱于自身 EMA，OI 相对上一根有效 OI 显著增加，倾向空头增仓 |
| positive | negative | short-cover | 资金流显著转强，但 OI 相对上一根有效 OI 显著减少，倾向空头回补 |
| negative | negative | long-liquidation | 资金流显著转弱，OI 相对上一根有效 OI 显著减少，倾向多头平仓 |
| neutral | 任意 | neutral | 资金流偏离不足，不给方向性结论 |
| 任意 | neutral | neutral | OI 偏离不足，不给方向性结论 |

只有资金流偏离超过 12 周期 EMA 阈值，且 OI 相对上一根有效 OI 的变化率超过阈值时，才输出四类方向状态；任一侧为 neutral 时输出 `neutral`，任一侧数据不足或不可用时输出 `unavailable`。

### 4.5 各周期阈值配置

周期越短，噪声通常越大；周期越长，变化更平滑但单根变化可能更集中。建议先提供以下初始值：

| 周期 | 资金流相对 EMA 偏离阈值 | OI 相对上一根有效 OI 变化率阈值 |
| --- | ---: | ---: |
| 5m | 3.0 个百分点 | 0.40 个百分点 |
| 15m | 4.0 个百分点 | 0.50 个百分点 |
| 1h | 5.0 个百分点 | 0.60 个百分点 |
| 4h | 7.0 个百分点 | 0.80 个百分点 |
| 1d | 10.0 个百分点 | 1.20 个百分点 |
| 1w | 12.0 个百分点 | 1.20 个百分点（实际不返回 OI） |

以上数值与 `server/utils/flow-oi-classifier.ts` 当前实现一致。由于改为单根变化口径，后续应根据每个交易对和周期最近 200 根 K 线的绝对变化率分布，用 60% 或 70% 分位数生成建议阈值，再允许用户手动覆盖。

### 4.6 数据不足和异常处理

- 少于 12 根有效资金流数据时，不计算资金流 EMA，返回 unavailable。
- 没有上一根有效 OI 基准时，不计算 OI 变化率，返回 unavailable。
- quoteVolume <= 0 时，资金流比例返回空值。
- previousOI <= 0、OI 历史未覆盖或 OI 请求失败时，OI 偏离返回空值。
- 当前未收盘 K 线可以显示临时偏离，但必须标记 provisional。
- 资金流 EMA 按有效数据计算，缺失点不能按 0 参与均线。
- OI 上一根基准只使用有效 OI 快照，缺失点不能按 0 参与比较。

联合判断已抽取到 `server/utils/flow-oi-classifier.ts`，由同步流程和图表 API 使用。

## 5. 数据结构改造

修改 types/kline-simple.ts，在兼容旧 JSON 文件的前提下增加可选字段：

- quoteVolume
- takerBuyQuoteVolume
- activeBuyAmount
- activeSellAmount
- activeDelta
- activeDeltaRatio
- oiValue
- oiChange
- oiChangePercent
- oiProvisional
- state

旧 K 线没有这些字段时，前端显示“暂无数据”，不能转换为零值。

## 6. 后端改造

### 6.1 K 线同步解析

修改 server/modules/kline-simple-sync/index.ts。除现有 OHLCV 外读取 Binance 数组的：

- item[7]：quote asset volume
- item[10]：taker buy quote asset volume

同步计算：

quoteVolume = item[7]

takerBuyQuoteVolume = item[10]

activeBuyAmount = takerBuyQuoteVolume

activeSellAmount = max(0, quoteVolume - takerBuyQuoteVolume)

activeDelta = activeBuyAmount - activeSellAmount

activeDeltaRatio = activeDelta / quoteVolume（quoteVolume 大于 0 时）

该逻辑必须覆盖首次历史同步、增量同步、未收盘 K 线更新和强制同步。

### 6.2 OI 写入流程

后续运行不单独维护无限 OI 历史，而是在 K 线同步时追加当前 OI；`oiChange`、`oiChangePercent`、`state` 作为派生快照同步保存：

K 线同步完成
→ 获取当前 OI
→ 对齐到当前 K 线时间桶
→ 写入 oiValue
→ 查找上一根有效 OI 基准
→ 计算 `oiChange`、`oiChangePercent`、`state`

未收盘 K 线可以按现有价格刷新机制更新临时 OI；收盘后固定最终值。

首次同步会在历史 K 线保存后请求 Binance 最近可用的 OI 历史；普通增量同步和高频同步请求当前 OI。`1w` 只同步资金流，不请求 OI。数据库写入使用保留非空字段的冲突更新，避免 K 线刷新擦除已有 OI。

### 6.3 首次补充脚本

新增 scripts/backfill-oi-for-kline-window.mjs：

1. 读取已有交易对和周期的 K 线范围。
2. 从 Binance K 线接口补齐资金流字段。
3. 只请求 Binance 最近约 1 个月可提供的 OI 历史（`limit <= 500`）。
4. 按当前 K 线周期聚合并对齐 OI。
5. 只写入能匹配到的 K 线，旧范围缺失部分保持为空。
6. 支持重复执行，不产生重复记录。
7. 失败时记录交易对、周期和时间范围，不破坏原 K 线文件。

5m 和 15m 的 OI 通常可覆盖最近约 1 个月内的范围；1h、4h、1d 仅补 Binance 当前可提供的近期数据；1w 跳过 OI。OI 请求失败不会阻塞资金流字段回补。脚本正式写入前创建数据库备份。

### 6.4 OI 口径迁移脚本

新增 `scripts/migrate-oi-change-to-previous.mjs`，用于将已有数据库中按旧口径保存的 `oiChange`、`oiChangePercent`、`state` 重算为上一根有效 OI 对比口径：

```text
node scripts/migrate-oi-change-to-previous.mjs                         # 预览
node scripts/migrate-oi-change-to-previous.mjs --write                  # 全量迁移并自动备份
node scripts/migrate-oi-change-to-previous.mjs --write --symbol BTCUSDT --timeframe 4h
```

脚本只读取本地 SQLite，不请求 Binance；缺失 OI 保持为空，写入前生成带时间戳的数据库备份。迁移完成后，后续 K 线同步由统一分类器继续按上一根有效 OI 计算。

## 7. API 设计

已新增独立接口，避免改变旧 K 线 API 的兼容行为：

GET /api/kline-simple/flow-oi?symbol=BTCUSDT&timeframe=4h&limit=2233

返回每根 K 线的：

- t、close
- quoteVolume
- activeBuyAmount
- activeSellAmount
- activeDelta
- activeDeltaRatio
- oiValue
- oiChange
- oiChangePercent
- state
- provisional

数据不足时：

- state 返回 unavailable
- 数值字段返回 null 或 undefined
- 不返回伪造的零值

## 8. 前端图表设计

已新增 `app/components/kline-chart/FlowOIPanel.vue` 并挂载到自研 K 线页面。

建议布局：

1. 标题：资金流与 OI
2. 当前 K 线摘要：成交额、主动净流、OI 变化、收盘价、联合状态
3. 资金流副图：主动净流比例相对 12 周期 EMA 的偏离柱状图（单位：百分点）
4. OI 副图：使用 `oiChangePercent`（当前 OI 相对上一根有效 OI）绘制变化率柱状图。

颜色建议：

- 绿色：主动买入占优
- 红色：主动卖出占优
- 蓝色：OI 增加
- 棕色：OI 减少
- 灰色：数据不足或中性

资金流金额和 OI 数量不能共用同一个 Y 轴，应使用两个独立副图或独立坐标轴。

当前面板使用独立 DOM 柱状副图，交易对和周期切换时重新请求 `flow-oi` 接口。历史 OI 未覆盖区域显示为空/灰色；尚未实现 K 线与副图的十字光标联动，也未实现独立 Tooltip 时间点联动。

## 9. 引擎兼容策略

自研引擎已优先实现基础副图。当前副图没有复用 lightweight-charts 的坐标轴和十字光标。

TradingView Widget 不能直接注入项目自有资金流和 OI 数据。第一版在 TradingView 下方挂载同一个 FlowOIPanel，允许副图独立十字光标，不强求完全联动。

## 10. 分阶段实施

### 阶段一：数据与当前 K 线（已完成）

- 扩展 K 线字段。
- 修改 Binance K 线解析。
- 增加 OI 写入逻辑。
- 增加联合判断函数。
- 实现当前 K 线摘要。
- 处理实时临时值和缺失数据。

### 阶段二：历史副图（基础版本已实现）

- 提供首次 OI/资金流补充脚本；实际写入需在部署环境手动执行并确认限频。
- 新增 FlowOIPanel.vue。
- 绘制资金流柱和 OI 变化柱。
- K 线与副图十字光标联动：未完成。

### 阶段三：稳定性和复用（部分完成）

- 增加重复执行：已完成；断点续跑：未完成。
- 增加 OI 时间对齐测试：未完成自动化测试。
- 将联合判断接入策略或 AI 分析。
- 增加 TradingView 下方独立副图。

## 11. 验收标准

### 数据正确性

- 主动买入额等于 Binance takerBuyQuoteVolume。
- 主动卖出额等于总成交额减主动买入额。
- 资金流差方向正确。
- OI 变化率、图表副图和 `state` 联合状态均与上一根有效 OI 比较。
- 缺失 OI 不显示为 0。
- Binance OI 历史查询只使用支持的周期和最近约 1 个月范围。

### 图表交互

- 切换交易对、周期后指标同步切换。
- 刷新和实时 K 线更新后副图同步更新。
- 鼠标移动到 K 线时可查看同一时间点的资金流和 OI：当前副图尚未完成十字光标联动。
- 当前未收盘 K 线显示实时估算或临时状态。
- 历史 OI 不足时页面不报错。

### 兼容性

- 旧 K 线文件仍可正常显示。
- 原有成交量、订单标记、扫描标记和主题切换不受影响。
- Binance OI 接口失败不会阻塞 K 线显示。

## 12. 当前实现审计结论

已完成的闭环：

- SQLite 自动迁移新增字段，旧数据保持 `NULL`。
- 首次同步补近期 OI，普通增量和高频同步补当前 OI。
- `oiChange`、`oiChangePercent`、`state` 在同步后重算并保存。
- OI 变化口径已统一为上一根有效 OI；历史数据可通过 `scripts/migrate-oi-change-to-previous.mjs` 重算。
- `1w` 不请求 OI。
- 回补脚本支持预览、备份写入、交易对/周期筛选和 OI 失败降级。
- K 线更新不会用空指标覆盖已有非空指标。

当前仍存在的明确边界：

- Binance 只提供最近约 1 个月 OI，早期历史不可补齐。
- 副图目前是独立 DOM 柱图，没有与 K 线十字光标联动。
- 回补脚本按交易对/周期顺序执行，具备重复执行能力，但尚未保存分页断点。
- `flow-oi` API 会再次运行分类器，数据库派生值与接口计算口径必须继续由同一分类器维护。

## 13. 最终方案

最终采用：

首次使用：补充 Binance 最近约 1 个月且接口支持周期的 OI；`1w` 不同步 OI。

后续运行：每次 K 线同步时写入最新 OI。

历史窗口：始终跟随现有 2233 根 K 线滚动。

历史缺口：保留为空，不伪造数据。

OI 口径：图表展示、联合状态、策略判断和 API 统一使用上一根有效 OI 的变化率。

优先引擎：自研 K 线图已实现基础副图；TradingView 和十字光标联动仍属于后续工作。

该方案不要求补齐几个月以前的 OI，也不需要立即引入复杂的长期历史数据库，能与当前项目的 K 线同步、文件存储和自研图表结构保持一致。
