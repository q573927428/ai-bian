/**
 * K线数据同步服务插件
 * 在Nuxt服务器启动时自动初始化并启动K线数据同步服务
 */

import type { NitroApp } from 'nitropack'
import { KLineSimpleSyncService } from '../modules/kline-simple-sync'
import type { KLineSyncConfig } from '../../types/kline-simple'
import { setSyncService, getSyncService, setSyncReadyPromise } from '../utils/kline-sync-service'
import { initKLineDb, closeKLineDb, flushDb, getSimpleKLineCount } from '../utils/kline-simple-storage'
import { startMacroSync, stopMacroSync } from '../modules/macro-kline-sync'

// 默认配置
const DEFAULT_SYNC_CONFIG: KLineSyncConfig = {
  symbols: [],
  timeframes: ['5m', '15m', '1h', '4h', '1d', '1w'],
  maxBars: 495,
  syncInterval: 600, // 按周期调度，此值不再使用，但保留用于API兼容性
  timeframeConfigs: [
    { timeframe: '5m', syncInterval: 60, enabled: true },     // ✅ 1分钟
    { timeframe: '15m', syncInterval: 600, enabled: true },   // ✅ 10分钟
    { timeframe: '1h',  syncInterval: 1800, enabled: true },  // ✅ 30分钟
    { timeframe: '4h',  syncInterval: 3600, enabled: true },  // ✅ 1小时
    { timeframe: '1d',  syncInterval: 14400, enabled: true },  // ✅ 2小时
    { timeframe: '1w',  syncInterval: 43200, enabled: true }  // ✅ 12小时
  ]
}

export default defineNitroPlugin(async (nitroApp: NitroApp) => {
  console.log('🚀 初始化K线数据同步服务插件...')
  
  try {
    // 初始化 K 线数据库（node:sqlite）
    await initKLineDb()
    // 宏观数据独立下载，不加入交易白名单，也不阻塞策略初始化。
    startMacroSync()
    nitroApp.hooks.hook('close', async () => {
      await stopSyncService()
    })
    
    // 从环境变量或配置文件中获取配置
    const config = await getSyncConfig()
    
    // 创建同步服务实例
    const syncService = new KLineSimpleSyncService(config)
    setSyncService(syncService)
    
    // console.log('✅ K线同步服务配置:', JSON.stringify(config, null, 2))
    
    const readyPromise = startInitialSync()
    setSyncReadyPromise(readyPromise)
    await readyPromise
    
  } catch (error) {
    console.error('❌ 初始化K线同步服务失败:', error)
  }
})

/**
 * 获取同步配置
 */
async function getSyncConfig(): Promise<KLineSyncConfig> {
  // 这里可以从环境变量、配置文件或数据库获取配置
  // 目前使用默认配置，后续可以扩展
  
  // 只从 bot-config 读取 symbols。bot-config.symbols 是唯一交易对白名单。
  let configSymbols = DEFAULT_SYNC_CONFIG.symbols
  try {
    const fs = await import('fs/promises')
    const path = await import('path')
    const configPath = path.join(process.cwd(), 'data', 'bot-config.json')
    const configContent = await fs.readFile(configPath, 'utf-8')
    const botConfig = JSON.parse(configContent)
    if (botConfig.symbols && Array.isArray(botConfig.symbols)) {
      configSymbols = botConfig.symbols.map((symbol: string) => symbol.replace('/', ''))
    }
  } catch (error) {
    console.error('读取bot配置文件失败，使用默认symbols:', error)
  }

  return {
    ...DEFAULT_SYNC_CONFIG,
    symbols: configSymbols
  }
}

function getMinRequiredBars(timeframe: KLineSyncConfig['timeframes'][number]): number {
  const minByTimeframe: Record<string, number> = {
    '5m': 10,
    '15m': 10,
    '1h': 10,
    '4h': 10,
    '1d': 5,
    '1w': 1
  }
  return minByTimeframe[timeframe] ?? 10
}

/**
 * 启动初始同步
 */
async function startInitialSync(): Promise<void> {
  const syncService = getSyncService()
  if (!syncService) {
    console.error('❌ 同步服务未初始化，无法启动初始同步')
    return
  }
  
  try {
    console.log('📊 开始K线数据初始同步...')
    
    // 检查是否需要初始同步 - 通过检查SQLite数据库中是否有数据
    const config = syncService.getConfig()
    const missingPairs: string[] = []
    
    for (const symbol of config.symbols) {
      for (const timeframe of config.timeframes) {
        // 检查数据库中是否有足够数据。只要有 1 根并不代表指标可计算，
        // RSI/ADX/ATR/Volume 至少需要几十根，策略侧当前按 100 根兜底。
        const count = getSimpleKLineCount(symbol, timeframe)
        const minRequiredBars = getMinRequiredBars(timeframe)
        
        if (count < minRequiredBars) {
          console.log(`⚠️  数据库K线不足: ${symbol}/${timeframe}，当前 ${count}/${minRequiredBars}，需要初始同步`)
          missingPairs.push(symbol)
        } else {
          // 已有数据的交易对，后续进行增量同步
        }
      }
    }
    
    // 去重得到真正缺少数据的交易对
    const uniqueMissingSymbols = [...new Set(missingPairs)]
    
    if (uniqueMissingSymbols.length > 0) {
      console.log(`🔄 检测到 ${uniqueMissingSymbols.length} 个交易对缺少数据，开始初始同步: ${uniqueMissingSymbols.join(', ')}`)
      // 只同步缺少数据的交易对，避免重复同步已有数据的交易对
      const results = await syncService.syncSymbols(uniqueMissingSymbols)
      
      const successCount = results.filter(r => r.success).length
      const totalBars = results.reduce((sum, r) => sum + r.count, 0)
      
      console.log(`✅ 初始同步完成: ${successCount}/${results.length} 成功，共获取 ${totalBars} 条数据`)
    }
    
    // 总有数据的交易对（已有的 + 刚同步完的），进行增量同步
    console.log('📊 进行增量同步（更新已有交易对的最新K线）...')
    const results = await syncService.syncAllKLine({ force: false })
    
    const successCount = results.filter(r => r.success).length
    const totalBars = results.reduce((sum, r) => sum + r.count, 0)
    
    console.log(`✅ 增量同步完成: ${successCount}/${results.length} 成功，共获取 ${totalBars} 条数据`)
    await flushDb()
    
    // 显示当前状态
    const status = syncService.getSyncStatus()
    status.forEach(s => {
      // console.log(`  ${s.symbol}/${s.timeframe}: 最后同步: ${new Date(s.lastSyncTime * 1000).toLocaleString()}, 总数据: ${s.totalBars}`)
    })
    
    console.log('✅ K线初始同步和启动增量同步已完成，等待策略系统完成预计算后启动定时同步')
    
  } catch (error) {
    console.error('❌ 启动初始同步失败:', error)
  }
}

/**
 * 停止同步服务
 */
async function stopSyncService(): Promise<void> {
  await stopMacroSync()
  const syncService = getSyncService()
  if (syncService) {
    console.log('🛑 停止K线同步服务...')
    syncService.stopAutoSync()
    setSyncService(null)
    console.log('✅ K线同步服务已停止')
  }
  
  // 关闭K线数据库
  await closeKLineDb()
}
