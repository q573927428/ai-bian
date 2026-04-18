import { getStrategyManager } from '../../modules/strategy-manager'
import { logger } from '../../utils/logger'
import type { CryptoBalance, BotState, TradeHistory } from '../../../types'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export default defineEventHandler(async (event) => {
  try {
    const manager = getStrategyManager()
    const engine = manager.getEngine()
    const positionManager = engine.getPositionManager()
    const binance = engine.getBinanceService()
    
    // 获取策略运行状态
    const runningStrategies = engine.getRunningStrategies()
    const allStrategies = await manager.getAllStrategies()
    
    // 获取日志
    const logs = logger.getRecentLogs(300)
    
    // 获取加密货币余额
    let cryptoBalances: CryptoBalance[] = []
    try {
      const balance = await binance.fetchCryptoBalances()
      
      if (balance && typeof balance === 'object') {
        const targetAssets = ['USDT']
        
        for (const asset of targetAssets) {
          const assetBalance = balance[asset]
          if (assetBalance) {
            const free = Number(Number(assetBalance.free || 0).toFixed(5))
            const locked = Number(Number(assetBalance.used || 0).toFixed(5))
            const total = Number((free + locked).toFixed(5))

            if (total > 1) {
              cryptoBalances.push({
                asset,
                free,
                locked,
                total,
              })
            }
          }
        }
      }
    } catch (error: any) {
      // 静默处理错误，返回空数组
    }
    
    // 获取当前持仓
    const positions = positionManager.getAllPositions()
    
    // 从 trade-history.json 计算统计数据
    let totalTrades = 0
    let todayTrades = 0
    let totalPnL = 0
    let dailyPnL = 0
    let winRate = 0
    const today = new Date().toISOString().split('T')[0]
    
    const tradeHistoryPath = join(process.cwd(), 'data', 'trade-history.json')
    
    if (existsSync(tradeHistoryPath)) {
      try {
        const tradeHistoryRaw = await readFile(tradeHistoryPath, 'utf-8')
        const tradeHistory: TradeHistory[] = JSON.parse(tradeHistoryRaw)
        
        totalTrades = tradeHistory.length
        totalPnL = tradeHistory.reduce((sum, t) => sum + (t.pnl || 0), 0)
        
        const winningTrades = tradeHistory.filter(t => (t.pnl || 0) > 0)
        winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0
        
        // 计算今日数据
        const todayTradesList = tradeHistory.filter(t => {
          const tradeDate = new Date(t.closeTime).toISOString().split('T')[0]
          return tradeDate === today
        })
        todayTrades = todayTradesList.length
        dailyPnL = todayTradesList.reduce((sum, t) => sum + (t.pnl || 0), 0)
      } catch (error) {
        console.error('读取交易历史失败:', error)
      }
    }
    
    return {
      success: true,
      data: {
        state: {
          isRunning: runningStrategies.length > 0,
          runningStrategies,
          totalStrategies: allStrategies.length,
          activeStrategies: allStrategies.filter(s => s.isActive).length,
          currentPositions: positions.length,
          // 添加统计数据
          totalTrades,
          todayTrades,
          totalPnL,
          dailyPnL,
          winRate,
          // 保持兼容性的默认值
          status: 'MONITORING',
          currentPosition: null,
          circuitBreaker: {
            isTriggered: false,
            reason: '',
            timestamp: Date.now(),
            dailyLoss: 0,
            consecutiveLosses: 0
          },
          lastResetDate: today,
          monitoringSymbols: [],
          allowNewTrades: true
        } as BotState,
        config: {
          strategies: allStrategies,
        },
        logs,
        cryptoBalances,
        positions,
      },
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '获取状态失败',
    }
  }
})