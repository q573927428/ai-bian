# 简单K线数据存储方案实现

## 概述
这是一个全新的K线数据存储方案，完全重写，不兼容旧版本。每个交易对每个周期一个文件，每个文件最多保存22000条K线数据。

## 核心特性
1. **单文件存储**: 每个交易对每个周期一个JSON文件
2. **数据限制**: 每个文件最多22000条K线数据
3. **简化格式**: 使用短字段名（t, o, h, l, c, v）减少文件大小
4. **直接读取**: 前端可以直接读取整个文件，无需分页
5. **简单API**: 提供简洁的API接口

## 文件结构
```
data/kline-simple/
├── BTCUSDT-1h.json      # BTC/USDT 1小时K线
├── BTCUSDT-15m.json     # BTC/USDT 15分钟K线
├── ETHUSDT-1h.json      # ETH/USDT 1小时K线
└── ETHUSDT-15m.json     # ETH/USDT 15分钟K线
```

## 数据格式
```json
{
  "symbol": "BTCUSDT",
  "timeframe": "1h",
  "data": [
    {
      "t": 1763978400,    // timestamp
      "o": 85913.8,       // open
      "h": 86164.7,       // high
      "l": 85654.1,       // low
      "c": 86017.1,       // close
      "v": 6800.987       // volume
    }
  ],
  "meta": {
    "first": 1763978400,  // 第一条数据时间戳
    "last": 1767193200,   // 最后一条数据时间戳
    "count": 894,         // 当前数据条数
    "max": 22000,         // 最大数据条数
    "updated": 1774776037 // 最后更新时间戳
  }
}
```

## 组件说明

### 1. 类型定义 (`types/kline-simple.ts`)
- 定义所有数据类型和接口
- 提供数据转换工具函数
- 包含默认配置

### 2. 存储工具 (`server/utils/kline-simple-storage.ts`)
- 文件读写操作
- 数据去重和排序
- 自动限制22000条数据
- 支持数据过滤和查询

### 3. API接口 (`server/api/kline-simple/index.ts`)
- `GET /api/kline-simple?symbol=BTC/USDT&timeframe=1h` - 获取K线数据
- `GET /api/kline-simple?action=stored-symbols` - 获取已存储交易对
- `GET /api/kline-simple?action=last-timestamp&symbol=BTC/USDT&timeframe=1h` - 获取最后时间戳

### 4. 同步服务 (`server/modules/kline-simple-sync/index.ts`)
- 从Binance API获取数据
- 定时同步最新数据
- 支持手动同步历史数据
- 状态管理和错误处理

### 5. 前端组件 (`app/components/KLineChartSimple.vue`)
- 基于Lightweight Charts的K线图表
- 支持主题切换
- 实时数据刷新
- 响应式设计

### 6. 测试页面 (`app/pages/kline-simple-test.vue`)
- 完整的测试界面
- API测试功能
- 系统说明文档

## 使用方法

### 1. 启动开发服务器
```bash
cd "f:\qukuailian\ai\zuoT\binance-futures-bot"
pnpm run dev
```

### 2. 访问测试页面
打开浏览器访问：`http://localhost:3000/kline-simple-test`

### 3. 启动数据同步服务
```bash
cd "f:\qukuailian\ai\zuoT\binance-futures-bot"
node scripts/start-kline-simple-sync.js
```

## API接口详情

### 获取K线数据
```
GET /api/kline-simple?symbol=BTC/USDT&timeframe=1h&limit=100&from=1763978400&to=1767193200
```

参数：
- `symbol`: 交易对（如：BTC/USDT）
- `timeframe`: 周期（15m, 1h, 4h, 1d, 1w）
- `limit`: 限制数量（可选）
- `from`: 开始时间戳（可选）
- `to`: 结束时间戳（可选）

### 获取已存储交易对
```
GET /api/kline-simple?action=stored-symbols
```

### 获取最后时间戳
```
GET /api/kline-simple?action=last-timestamp&symbol=BTC/USDT&timeframe=1h
```

## 同步服务配置

默认配置在 `types/kline-simple.ts` 中：
```typescript
export const DEFAULT_CONFIG: KLineSyncConfig = {
  symbols: ['BTC/USDT', 'ETH/USDT'],
  timeframes: ['15m', '1h', '4h', '1d', '1w'],
  maxBars: 22000,
  syncInterval: 300  // 5分钟
}
```

## 优势对比

### 旧方案（按年份分割）
- 优点：历史数据管理方便
- 缺点：文件数量多，读取复杂，需要跨文件查询

### 新方案（单文件）
- 优点：文件数量少，读取简单，前端直接加载
- 缺点：历史数据有限（最多22000条）

## 迁移建议

1. **并行运行**: 新旧系统可以同时运行
2. **逐步迁移**: 根据需要迁移特定交易对的数据
3. **重新同步**: 对于新系统，可以直接从Binance重新同步数据
4. **数据转换**: 可以编写脚本将旧数据转换为新格式

## 注意事项

1. **不兼容旧版本**: 这是全新实现，不兼容旧数据格式
2. **数据量限制**: 每个文件最多22000条数据，适合近期数据分析
3. **网络依赖**: 同步服务需要访问Binance API
4. **存储空间**: 每个文件约1-2MB，管理简单

## 故障排除

### 1. API返回空数据
- 检查交易对和周期参数是否正确
- 确认数据同步服务已启动
- 查看服务器日志是否有错误

### 2. 图表不显示
- 检查Lightweight Charts是否正确加载
- 确认API返回的数据格式正确
- 查看浏览器控制台错误信息

### 3. 同步服务失败
- 检查网络连接是否可以访问Binance API
- 确认交易对符号格式正确
- 查看同步服务日志输出

## 扩展开发

### 添加新交易对
修改 `types/kline-simple.ts` 中的 `DEFAULT_CONFIG.symbols` 数组

### 添加新周期
修改 `types/kline-simple.ts` 中的 `KLineTimeframe` 类型和 `DEFAULT_CONFIG.timeframes` 数组

### 修改数据限制
修改 `types/kline-simple.ts` 中的 `DEFAULT_CONFIG.maxBars` 值

## 性能优化

1. **文件压缩**: 可以考虑启用Gzip压缩
2. **内存缓存**: 频繁访问的数据可以加入内存缓存
3. **CDN加速**: 静态数据文件可以使用CDN加速
4. **分片存储**: 如果数据量过大，可以考虑按时间分片存储