import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import type { StrategyAnalysisMetrics } from '../../types'
import dayjs from 'dayjs'

const DATA_DIR = join(process.cwd(), 'data')
const ANALYSIS_FILE = join(DATA_DIR, 'strategy-analysis.json')

/**
 * 确保数据目录存在
 */
async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true })
  }
}

/**
 * 保存策略分析指标
 */
export async function saveStrategyAnalysisMetrics(metrics: StrategyAnalysisMetrics): Promise<void> {
  try {
    await ensureDataDir()
    
    let allMetrics: StrategyAnalysisMetrics[] = []
    
    if (existsSync(ANALYSIS_FILE)) {
      try {
        const data = await readFile(ANALYSIS_FILE, 'utf-8')
        if (data.trim()) {
          allMetrics = JSON.parse(data)
        }
      } catch (parseError: any) {
        console.warn('解析策略分析文件失败，创建新文件:', parseError.message)
        allMetrics = []
      }
    }
    
    // 确保指标有唯一的ID
    if (!metrics.tradeId) {
      metrics.tradeId = `${metrics.openTime}-${metrics.symbol.replace('/', '-')}`
    }
    
    // 设置创建时间
    metrics.createdAt = metrics.createdAt || Date.now()
    
    // 添加到数组
    allMetrics.push(metrics)
    
    // 按关闭时间排序，最新的在前面
    allMetrics.sort((a, b) => b.closeTime - a.closeTime)
    
    await writeFile(ANALYSIS_FILE, JSON.stringify(allMetrics, null, 2), 'utf-8')
    console.log(`策略分析指标已保存: ${metrics.symbol} ${metrics.direction} PnL: ${metrics.pnl.toFixed(2)} USDT`)
  } catch (error: any) {
    console.error('保存策略分析指标失败:', error.message)
    console.error('错误堆栈:', error.stack)
  }
}

/**
 * 获取策略分析指标
 */
export async function getStrategyAnalysisMetrics(limit?: number): Promise<StrategyAnalysisMetrics[]> {
  try {
    if (!existsSync(ANALYSIS_FILE)) {
      return []
    }
    
    const data = await readFile(ANALYSIS_FILE, 'utf-8')
    const metrics: StrategyAnalysisMetrics[] = JSON.parse(data)
    
    // 按关闭时间排序，最新的在前面
    metrics.sort((a, b) => b.closeTime - a.closeTime)
    
    if (limit) {
      return metrics.slice(0, limit)
    }
    
    return metrics
  } catch (error: any) {
    console.error('加载策略分析指标失败:', error.message)
    return []
  }
}

/**
 * 获取指定交易ID的分析指标
 */
export async function getStrategyAnalysisMetricsByTradeId(tradeId: string): Promise<StrategyAnalysisMetrics | null> {
  try {
    const metrics = await getStrategyAnalysisMetrics()
    return metrics.find(m => m.tradeId === tradeId) || null
  } catch (error: any) {
    console.error('按交易ID加载策略分析指标失败:', error.message)
    return null
  }
}

/**
 * 获取今日策略分析指标
 */
export async function getTodayStrategyAnalysisMetrics(): Promise<StrategyAnalysisMetrics[]> {
  try {
    const metrics = await getStrategyAnalysisMetrics()
    const todayStart = dayjs().startOf('day').valueOf()
    
    return metrics.filter(metric => metric.closeTime >= todayStart)
  } catch (error: any) {
    console.error('获取今日策略分析指标失败:', error.message)
    return []
  }
}

/**
 * 计算策略分析统计数据
 */
export async function calculateStrategyAnalysisStats(): Promise<{
  totalTrades: number
  totalPnL: number
  winRate: number
  avgRiskRewardRatio: number
  avgMFE: number
  avgMAE: number
  avgDuration: number
  avgPositionSize: number
}> {
  try {
    const metrics = await getStrategyAnalysisMetrics()
    
    if (metrics.length === 0) {
      return {
        totalTrades: 0,
        totalPnL: 0,
        winRate: 0,
        avgRiskRewardRatio: 0,
        avgMFE: 0,
        avgMAE: 0,
        avgDuration: 0,
        avgPositionSize: 0
      }
    }
    
    const totalTrades = metrics.length
    const totalPnL = metrics.reduce((sum, metric) => sum + metric.pnl, 0)
    const winningTrades = metrics.filter(metric => metric.pnl > 0).length
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0
    
    const avgRiskRewardRatio = metrics.reduce((sum, metric) => sum + metric.riskRewardRatio, 0) / totalTrades
    const avgMFE = metrics.reduce((sum, metric) => sum + metric.mfe, 0) / totalTrades
    const avgMAE = metrics.reduce((sum, metric) => sum + metric.mae, 0) / totalTrades
    const avgDuration = metrics.reduce((sum, metric) => sum + metric.duration, 0) / totalTrades
    const avgPositionSize = metrics.reduce((sum, metric) => sum + metric.positionSizePercentage, 0) / totalTrades
    
    return {
      totalTrades,
      totalPnL,
      winRate: parseFloat(winRate.toFixed(2)),
      avgRiskRewardRatio: parseFloat(avgRiskRewardRatio.toFixed(2)),
      avgMFE: parseFloat(avgMFE.toFixed(2)),
      avgMAE: parseFloat(avgMAE.toFixed(2)),
      avgDuration: parseFloat(avgDuration.toFixed(0)),
      avgPositionSize: parseFloat(avgPositionSize.toFixed(2))
    }
  } catch (error: any) {
    console.error('计算策略分析统计数据失败:', error.message)
    return {
      totalTrades: 0,
      totalPnL: 0,
      winRate: 0,
      avgRiskRewardRatio: 0,
      avgMFE: 0,
      avgMAE: 0,
      avgDuration: 0,
      avgPositionSize: 0
    }
  }
}

/**
 * 按退出原因分类统计
 */
export async function getExitReasonStats(): Promise<Record<string, {
  count: number
  totalPnL: number
  avgPnL: number
  winRate: number
}>> {
  try {
    const metrics = await getStrategyAnalysisMetrics()
    
    const stats: Record<string, {
      count: number
      totalPnL: number
      avgPnL: number
      winRate: number
    }> = {}
    
    metrics.forEach(metric => {
      const reason = metric.exitReasonCategory || 'OTHER'
      
      if (!stats[reason]) {
        stats[reason] = {
          count: 0,
          totalPnL: 0,
          avgPnL: 0,
          winRate: 0
        }
      }
      
      stats[reason].count++
      stats[reason].totalPnL += metric.pnl
    })
    
    // 计算平均值和胜率
    Object.keys(stats).forEach(reason => {
      const stat = stats[reason]
      if (!stat) return
      
      const reasonMetrics = metrics.filter(m => (m.exitReasonCategory || 'OTHER') === reason)
      const winningTrades = reasonMetrics.filter(m => m.pnl > 0).length
      
      stat.avgPnL = stat.totalPnL / stat.count
      stat.winRate = stat.count > 0 ? (winningTrades / stat.count * 100) : 0
    })
    
    return stats
  } catch (error: any) {
    console.error('计算退出原因统计失败:', error.message)
    return {}
  }
}

/**
 * 按交易对分类统计
 */
export async function getSymbolStats(): Promise<Record<string, {
  count: number
  totalPnL: number
  avgPnL: number
  winRate: number
  longCount: number
  shortCount: number
}>> {
  try {
    const metrics = await getStrategyAnalysisMetrics()
    
    const stats: Record<string, {
      count: number
      totalPnL: number
      avgPnL: number
      winRate: number
      longCount: number
      shortCount: number
    }> = {}
    
    metrics.forEach(metric => {
      const symbol = metric.symbol
      
      if (!stats[symbol]) {
        stats[symbol] = {
          count: 0,
          totalPnL: 0,
          avgPnL: 0,
          winRate: 0,
          longCount: 0,
          shortCount: 0
        }
      }
      
      stats[symbol].count++
      stats[symbol].totalPnL += metric.pnl
      
      if (metric.direction === 'LONG') {
        stats[symbol].longCount++
      } else if (metric.direction === 'SHORT') {
        stats[symbol].shortCount++
      }
    })
    
    // 计算平均值和胜率
    Object.keys(stats).forEach(symbol => {
      const stat = stats[symbol]
      if (!stat) return
      
      const symbolMetrics = metrics.filter(m => m.symbol === symbol)
      const winningTrades = symbolMetrics.filter(m => m.pnl > 0).length
      
      stat.avgPnL = stat.totalPnL / stat.count
      stat.winRate = stat.count > 0 ? (winningTrades / stat.count * 100) : 0
    })
    
    return stats
  } catch (error: any) {
    console.error('计算交易对统计失败:', error.message)
    return {}
  }
}