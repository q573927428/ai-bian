// 导入交易历史数据工具
import { readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'

// 项目根目录
const PROJECT_ROOT = resolve(new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]):\//, '$1:/'))
const STRATEGIES_DIR = join(PROJECT_ROOT, 'data', 'strategies')
const TRADE_HISTORY_PATH = join(PROJECT_ROOT, 'data', 'trade-history.json')

async function importTradeHistory() {
  console.log('开始导入交易历史数据...')

  try {
    // 1. 读取交易历史数据
    if (!existsSync(TRADE_HISTORY_PATH)) {
      console.log('交易历史文件不存在')
      return
    }

    const tradeHistoryRaw = await readFile(TRADE_HISTORY_PATH, 'utf-8')
    const tradeHistory = JSON.parse(tradeHistoryRaw)

    console.log(`找到 ${tradeHistory.length} 条交易记录`)

    // 2. 按策略ID分组
    const strategyTrades = {}
    for (const trade of tradeHistory) {
      if (!strategyTrades[trade.strategyId]) {
        strategyTrades[trade.strategyId] = []
      }
      strategyTrades[trade.strategyId].push(trade)
    }

    console.log(`涉及 ${Object.keys(strategyTrades).length} 个策略`)

    // 3. 为每个策略导入数据
    for (const [strategyId, trades] of Object.entries(strategyTrades)) {
      const strategyPath = join(STRATEGIES_DIR, `${strategyId}.json`)

      if (!existsSync(strategyPath)) {
        console.log(`策略文件不存在: ${strategyId}, 跳过`)
        continue
      }

      const strategyRaw = await readFile(strategyPath, 'utf-8')
      const strategy = JSON.parse(strategyRaw)

      // 转换并添加交易记录
      const convertedTrades = trades.map(trade => convertTradeRecord(trade, strategy))

      // 检查是否已存在相同记录
      const existingIds = new Set(strategy.tradeRecords.map(t => t.id))
      const newTrades = convertedTrades.filter(t => !existingIds.has(t.id))

      if (newTrades.length > 0) {
        strategy.tradeRecords = [...strategy.tradeRecords, ...newTrades]
        strategy.updatedAt = new Date().toISOString()

        // 重新计算性能统计
        await recalculatePerformance(strategy)

        await writeFile(strategyPath, JSON.stringify(strategy, null, 2), 'utf-8')
        console.log(`策略 ${strategyId} 已导入 ${newTrades.length} 条新记录`)
      } else {
        console.log(`策略 ${strategyId} 没有新记录需要导入`)
      }
    }

    console.log('导入完成!')
  } catch (error) {
    console.error('导入失败:', error)
  }
}

// 转换交易记录格式
function convertTradeRecord(trade, strategy) {
  return {
    id: trade.id,
    strategyId: trade.strategyId,
    strategyVersion: strategy.version,
    symbol: trade.symbol,
    direction: trade.direction.toLowerCase(),
    action: 'close',
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    quantity: trade.quantity,
    leverage: trade.leverage,
    marginMode: strategy.executionConfig.marginMode || 'cross',
    positionMode: strategy.executionConfig.positionMode || 'one-way',
    openTime: new Date(trade.openTime).toISOString(),
    closeTime: new Date(trade.closeTime).toISOString(),
    profitLoss: trade.pnl,
    profitLossPercentage: trade.pnlPercentage,
    status: 'closed',
    reason: trade.reason
  }
}

// 重新计算性能统计
async function recalculatePerformance(strategy) {
  const closedTrades = strategy.tradeRecords.filter(t => t.status === 'closed')
  const totalTrades = closedTrades.length

  if (totalTrades === 0) {
    strategy.performance = {
      strategyId: strategy.id,
      totalTrades: 0,
      totalWins: 0,
      totalLosses: 0,
      winRate: 0,
      totalProfit: 0,
      totalLoss: 0,
      netProfit: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      averageProfitPerTrade: 0,
      averageLossPerTrade: 0,
      largestWin: 0,
      largestLoss: 0,
      averageHoldTime: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      updatedAt: new Date().toISOString()
    }
    return
  }

  const winningTrades = closedTrades.filter(t => (t.profitLoss || 0) > 0)
  const losingTrades = closedTrades.filter(t => (t.profitLoss || 0) <= 0)
  const totalWins = winningTrades.length
  const totalLosses = losingTrades.length

  const totalProfit = winningTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0)
  const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0))
  const netProfit = totalProfit - totalLoss

  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : Infinity

  const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profitLoss || 0)) : 0
  const largestLoss = losingTrades.length > 0 ? Math.max(...losingTrades.map(t => Math.abs(t.profitLoss || 0))) : 0

  const averageProfitPerTrade = totalWins > 0 ? totalProfit / totalWins : 0
  const averageLossPerTrade = totalLosses > 0 ? totalLoss / totalLosses : 0

  const totalHoldTime = closedTrades.reduce((sum, t) => {
    if (t.openTime && t.closeTime) {
      const open = new Date(t.openTime).getTime()
      const close = new Date(t.closeTime).getTime()
      return sum + (close - open) / (1000 * 60)
    }
    return sum
  }, 0)
  const averageHoldTime = totalTrades > 0 ? totalHoldTime / totalTrades : 0

  let consecutiveWins = 0
  let consecutiveLosses = 0
  let maxConsecutiveWins = 0
  let maxConsecutiveLosses = 0

  const sortedTrades = [...closedTrades].sort((a, b) =>
    new Date(a.closeTime || a.openTime).getTime() - new Date(b.closeTime || b.openTime).getTime()
  )

  for (const trade of sortedTrades) {
    const profit = trade.profitLoss || 0
    if (profit > 0) {
      consecutiveWins++
      consecutiveLosses = 0
      maxConsecutiveWins = Math.max(maxConsecutiveWins, consecutiveWins)
    } else {
      consecutiveLosses++
      consecutiveWins = 0
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses)
    }
  }

  let peak = 0
  let maxDrawdown = 0
  let cumulativeProfit = 0
  for (const trade of sortedTrades) {
    cumulativeProfit += trade.profitLoss || 0
    if (cumulativeProfit > peak) {
      peak = cumulativeProfit
    }
    const drawdown = peak > 0 ? ((peak - cumulativeProfit) / peak) * 100 : 0
    maxDrawdown = Math.max(maxDrawdown, drawdown)
  }

  strategy.performance = {
    strategyId: strategy.id,
    totalTrades,
    totalWins,
    totalLosses,
    winRate,
    totalProfit,
    totalLoss,
    netProfit,
    profitFactor,
    maxDrawdown,
    averageProfitPerTrade,
    averageLossPerTrade,
    largestWin,
    largestLoss,
    averageHoldTime,
    consecutiveWins,
    consecutiveLosses,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    updatedAt: new Date().toISOString()
  }
}

importTradeHistory()