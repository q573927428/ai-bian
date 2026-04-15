import { KLineSimpleSyncService } from '../../modules/kline-simple-sync'

// 创建同步服务实例（使用默认配置）
const syncService = new KLineSimpleSyncService()

export default defineEventHandler(async (event) => {
  try {
    // 获取同步状态
    const syncStatus = syncService.getSyncStatus()
    
    // 获取配置信息
    const config = syncService.getConfig()
    
    return {
      success: true,
      timestamp: Math.floor(Date.now() / 1000),
      data: {
        status: syncStatus,
        config: {
          symbols: config.symbols,
          timeframes: config.timeframes,
          syncInterval: config.syncInterval,
          timeframeConfigs: config.timeframeConfigs
        },
        serviceInfo: {
          totalSymbols: config.symbols.length,
          totalTimeframes: config.timeframes.length,
          totalStatusEntries: syncStatus.length
        }
      }
    }
  } catch (error: any) {
    console.error('获取同步状态失败:', error)
    
    return {
      success: false,
      timestamp: Math.floor(Date.now() / 1000),
      error: error.message || '未知错误'
    }
  }
})