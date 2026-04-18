// 同步策略 performance 数据工具
// 从全局交易历史计算并更新策略文件的 performance，同时清理 tradeRecords
import { readFile, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'

// 项目根目录
const PROJECT_ROOT = resolve(new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]):\//, '$1:/'))
const STRATEGIES_DIR = join(PROJECT_ROOT, 'data', 'strategies')
const TRADE_HISTORY_PATH = join(PROJECT_ROOT, 'data', 'trade-history.json')

async function syncStrategyPerformance() {
  console.log('开始同步策略 performance 数据...')

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

    // 3. 获取所有策略文件
    const { readdir } = await import('fs/promises')
    const files = await readdir(STRATEGIES_DIR)

    // 4. 处理每个策略
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'archive') {
        continue
      }

      const strategyId = file.replace('.json', '')
      const strategyPath = join(STRATEGIES_DIR, file)

      const strategyRaw = await readFile(strategyPath, 'utf-8')
      const strategy = JSON.parse(strategyRaw)

      // 获取该策略的交易记录
      const trades = strategyTrades[strategyId] || []

      // 计算 performance
      strategy.performance = calculatePerformance(strategyId, trades)

      // 移除 tradeRecords 字段
      delete strategy.tradeRecords

      // 更新 updatedAt
      strategy.updatedAt = new Date().toISOString()

      // 保存策略文件
      await writeFile(strategyPath, JSON.stringify(strategy, null, 2), 'utf-8')

      console.log(`策略 ${strategyId}: ${trades.length} 条记录, performance 已更新`)
    }

    console.log('同步完成!')
  } catch (error) {
    console.error('同步失败:', error)
  }
}

// 计算 performance
function calculatePerformance(strategyId, trades) {
  // 转换交易记录格式
  const convertedTrades = trades.map(trade => ({
    id: trade.id,
    strategyId: trade.strategyId,
    symbol: trade.symbol,
    direction: trade.direction?.toLowerCase() || 'long',
    profitLoss: trade.pnl,
    profitLossPercentage: trade.pnlPercentage,
    openTime: new Date(trade.openTime).toISOString(),
    closeTime: new Date(trade.closeTime).toISOString(),
    status: 'closed'
  }))

  const closedTrades = convertedTrades.filter(t => t.status === 'closed')
  const totalTrades = closedTrades.length

  if (totalTrades === 0) {
    return {
      strategyId,
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
  }

  // 计算基础统计
  const winningTrades = closedTrades.filter(t => (t.profitLoss || 0) > 0)
  const losingTrades = closedTrades.filter(t => (t.profitLoss || 0) <= 0)
  const totalWins = winningTrades.length
  const totalLosses = losingTrades.length

  const totalProfit = winningTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0)
  const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0))
  const netProfit = totalProfit - totalLoss

  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : Infinity

  // 计算最大盈利/亏损
  const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => t.profitLoss || 0)) : 0
  const largestLoss = losingTrades.length > 0 ? Math.max(...losingTrades.map(t => Math.abs(t.profitLoss || 0))) : 0

  // 平均盈亏
  const averageProfitPerTrade = totalWins > 0 ? totalProfit / totalWins : 0
  const averageLossPerTrade = totalLosses > 0 ? totalLoss / totalLosses : 0

  // 平均持仓时间
  const totalHoldTime = closedTrades.reduce((sum, t) => {
    if (t.openTime && t.closeTime) {
      const open = new Date(t.openTime).getTime()
      const close = new Date(t.closeTime).getTime()
      return sum + (close - open) / (1000 * 60)
    }
    return sum
  }, 0)
  const averageHoldTime = totalTrades > 0 ? totalHoldTime / totalTrades : 0

  // 计算连续盈亏
  let consecutiveWins = 0
  let consecutiveLosses = 0
  let maxConsecutiveWins = 0
  let maxConsecutiveLosses = 0

  // 按时间排序交易
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

  // 计算最大回撤
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

  return {
    strategyId,
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

syncStrategyPerformance()