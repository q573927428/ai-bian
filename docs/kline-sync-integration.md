# K线数据同步服务集成方案

## 概述

本方案将原本独立的 `scripts/start-kline-simple-sync.js` 脚本集成到 Nuxt 3 应用中，作为服务器插件运行。这样就不再需要单独启动一个 Node 进程，使整个应用更加专业和易于维护。

## 主要改进

### 1. 集成到 Nuxt 应用
- 同步服务作为 Nuxt 服务器插件启动
- 与主应用共享配置和环境变量
- 统一的日志和错误处理

### 2. 提供完整的 API 接口
- `/api/kline-sync/status` - 获取同步状态
- `/api/kline-sync/sync` - 手动触发同步
- `/api/kline-sync/config` - 获取/更新配置
- `/api/kline-sync/history` - 同步历史数据
- `/api/kline-sync/auto-sync` - 启动/停止定时同步

### 3. 自动管理
- 应用启动时自动初始化
- 延迟启动避免影响服务器启动
- 应用关闭时自动停止

### 4. 测试页面
- 提供可视化测试页面 `/kline-sync-test`
- 实时查看同步状态
- 手动控制同步操作

## 使用方法

### 启动应用（带同步服务）

```bash
# 开发模式
pnpm run dev:with-sync

# 生产模式
pnpm run start:with-sync
```

### API 接口使用示例

#### 获取同步状态
```bash
curl http://localhost:3002/api/kline-sync/status
```

#### 手动触发同步
```bash
curl -X POST http://localhost:3002/api/kline-sync/sync \
  -H "Content-Type: application/json" \
  -d '{"force": false}'
```

#### 获取配置
```bash
curl http://localhost:3002/api/kline-sync/config
```

#### 更新配置
```bash
curl -X PUT http://localhost:3002/api/kline-sync/config \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["BTCUSDT", "ETHUSDT"], "syncInterval": 600}'
```

#### 同步历史数据
```bash
curl -X POST http://localhost:3002/api/kline-sync/history \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BTCUSDT", "timeframe": "1h", "totalBars": 10000}'
```

#### 控制定时同步
```bash
# 启动定时同步
curl -X POST http://localhost:3002/api/kline-sync/auto-sync \
  -H "Content-Type: application/json" \
  -d '{"action": "start"}'

# 停止定时同步
curl -X POST http://localhost:3002/api/kline-sync/auto-sync \
  -H "Content-Type: application/json" \
  -d '{"action": "stop"}'
```

### 可视化测试页面
访问 `http://localhost:3002/kline-sync-test` 查看和管理同步服务。

## 文件结构

```
server/plugins/kline-sync.ts          # 同步服务插件
app/pages/kline-sync-test.vue         # 测试页面
package.json                          # 更新了启动脚本
```

## 配置说明

### 默认配置
```typescript
{
  symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'],
  timeframes: ['15m', '1h', '4h', '1d', '1w'],
  maxBars: 22000,
  syncInterval: 300  // 5分钟
}
```

### 环境变量配置（计划支持）
未来可以通过环境变量配置：
- `KLINE_SYNC_SYMBOLS` - 交易对列表（逗号分隔）
- `KLINE_SYNC_TIMEFRAMES` - 时间周期列表（逗号分隔）
- `KLINE_SYNC_INTERVAL` - 同步间隔（秒）

## 与旧方案的对比

| 特性 | 旧方案 (`scripts/start-kline-simple-sync.js`) | 新方案 (Nuxt 插件) |
|------|---------------------------------------------|-------------------|
| 启动方式 | 单独 Node 进程 | 集成到 Nuxt 应用 |
| 配置管理 | 硬编码在脚本中 | 可通过 API 动态配置 |
| 监控管理 | 需要外部工具 | 内置 API 和测试页面 |
| 错误处理 | 简单的控制台输出 | 统一的错误处理 |
| 集成度 | 低，独立运行 | 高，与应用深度集成 |
| 维护性 | 较差，需要单独维护 | 良好，统一代码库 |

## 迁移指南

### 从旧方案迁移到新方案

1. **停止旧服务**
   ```bash
   # 如果旧服务正在运行，按 Ctrl+C 停止
   ```

2. **启动新服务**
   ```bash
   pnpm run dev:with-sync
   ```

3. **验证服务**
   - 访问 `http://localhost:3002/kline-sync-test`
   - 检查同步状态
   - 测试手动同步功能

4. **更新部署脚本**
   - 将 `node scripts/start-kline-simple-sync.js` 替换为 `pnpm run start:with-sync`
   - 或直接使用 `pnpm run start`（如果配置了同步插件）

## 故障排除

### 1. 插件未加载
- 检查 `server/plugins/kline-sync.ts` 文件是否存在
- 查看服务器启动日志是否有插件初始化信息

### 2. API 端点不可用
- 确认服务器正在运行
- 检查端口配置（默认 3002）
- 查看浏览器控制台网络请求

### 3. 同步失败
- 检查网络连接
- 确认 Binance API 可用性
- 查看服务器控制台错误日志

### 4. 数据存储问题
- 确认 `data/kline-simple/` 目录存在且有写入权限
- 检查磁盘空间

## 扩展建议

### 1. 添加数据库支持
- 将配置存储到数据库
- 记录同步历史
- 支持多用户配置

### 2. 添加监控告警
- 集成 Sentry 错误监控
- 添加邮件/钉钉告警
- 监控同步成功率

### 3. 支持更多交易所
- 扩展 `KLineSimpleSyncService` 类
- 添加交易所适配器
- 支持配置切换

### 4. 添加 WebSocket 实时更新
- 使用 WebSocket 推送同步状态
- 实时显示同步进度
- 客户端自动刷新

## 总结

新的集成方案提供了更专业、更易维护的 K 线数据同步服务。通过将服务集成到 Nuxt 应用中，我们实现了：
- 统一的启动和管理
- 完整的 API 接口
- 可视化的管理界面
- 更好的错误处理和监控

建议尽快迁移到新方案，享受更专业的开发体验。