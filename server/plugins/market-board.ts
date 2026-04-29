/**
 * 市场看板服务插件
 * 在Nuxt服务器启动时自动初始化市场数据管理器
 */

import type { NitroApp } from 'nitropack'
import { MarketDataManager } from '../modules/market-board/MarketDataManager'

let marketDataManager: MarketDataManager | null = null

export default defineNitroPlugin(async (nitroApp: NitroApp) => {
  console.log('🚀 初始化市场看板服务插件...')

  try {
    // 创建并初始化市场数据管理器
    marketDataManager = MarketDataManager.getInstance()
    await marketDataManager.initialize()

    console.log('✅ 市场看板服务初始化完成')

    // 处理服务器关闭
    nitroApp.hooks.hook('close', async () => {
      console.log('🛑 停止市场看板服务...')
      if (marketDataManager) {
        marketDataManager.destroy()
      }
      console.log('✅ 市场看板服务已停止')
    })
  } catch (error) {
    console.error('❌ 初始化市场看板服务失败:', error)
  }
})
