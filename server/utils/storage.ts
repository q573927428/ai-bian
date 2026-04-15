import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import type { BotState, BotConfig, TradeHistory } from '../../types'
import dayjs from 'dayjs'

const DATA_DIR = join(process.cwd(), 'data')
const STATE_FILE = join(DATA_DIR, 'bot-state.json')
const CONFIG_FILE = join(DATA_DIR, 'bot-config.json')
const HISTORY_FILE = join(DATA_DIR, 'trade-history.json')

/**
 * 确保数据目录存在
 */
async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true })
  }
}

/**
 * 保存机器人状态
 */
export async function saveBotState(state: BotState): Promise<void> {
  try {
    await ensureDataDir()
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
  } catch (error: any) {
    console.error('保存状态失败:', error.message)
    throw error
  }
}

/**
 * 加载机器人状态
 */
export async function loadBotState(): Promise<BotState | null> {
  try {
    if (!existsSync(STATE_FILE)) {
      return null
    }
    const data = await readFile(STATE_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (error: any) {
    console.error('加载状态失败:', error.message)
    return null
  }
}

/**
 * 保存配置
 */
export async function saveBotConfig(config: BotConfig): Promise<void> {
  try {
    await ensureDataDir()
    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error: any) {
    console.error('保存配置失败:', error.message)
    throw error
  }
}

/**
 * 加载配置
 */
export async function loadBotConfig(): Promise<BotConfig | null> {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null
    }
    const data = await readFile(CONFIG_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (error: any) {
    console.error('加载配置失败:', error.message)
    return null
  }
}

/**
 * 计算总统计数据
 */
function calculateTotalStats(history: TradeHistory[]): { totalTrades: number; totalPnL: number; winRate: number } {
  const totalTrades = history.length
  const totalPnL = history.reduce((sum, trade) => sum + trade.pnl, 0)
  const winningTrades = history.filter(trade => trade.pnl > 0).length
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades * 100) : 0
  
  return {
    totalTrades,
    totalPnL,
    winRate: parseFloat(winRate.toFixed(2))
  }
}

/**
 * 更新总统计数据到状态并返回更新后的状态
 */
export async function updateTotalStatsInState(): Promise<BotState | null> {
  try {
    const history = await getTradeHistory()
    const stats = calculateTotalStats(history)
    
    const currentState = await loadBotState()
    if (currentState) {
      currentState.totalTrades = stats.totalTrades
      currentState.totalPnL = stats.totalPnL
      currentState.winRate = stats.winRate
      await saveBotState(currentState)
      return currentState
    }
    return null
  } catch (error: any) {
    console.error('更新总统计数据失败:', error.message)
    return null
  }
}

/**
 * 添加交易历史记录并更新总统计数据
 */
export async function addTradeHistory(trade: TradeHistory): Promise<BotState | null> {
  try {
    await ensureDataDir()
    
    let history: TradeHistory[] = []
    
    if (existsSync(HISTORY_FILE)) {
      try {
        const data = await readFile(HISTORY_FILE, 'utf-8')
        // 检查文件是否为空或无效JSON
        if (data.trim()) {
          history = JSON.parse(data)
        }
      } catch (parseError: any) {
        console.warn('解析交易历史文件失败，创建新文件:', parseError.message)
        // 如果解析失败，从空数组开始
        history = []
      }
    }
    
    // 确保交易有唯一的ID
    if (!trade.id) {
      trade.id = `${trade.closeTime}-${trade.symbol.replace('/', '-')}`
    }
    
    history.push(trade)
    
    // 按关闭时间排序，最新的在前面
    history.sort((a, b) => b.closeTime - a.closeTime)
    
    await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
    console.log(`交易历史已保存: ${trade.symbol} ${trade.direction} PnL: ${trade.pnl.toFixed(2)} USDT`)
    
    // 更新总统计数据并返回更新后的状态
    return await updateTotalStatsInState()
  } catch (error: any) {
    console.error('保存交易历史失败:', error.message)
    console.error('错误堆栈:', error.stack)
    // 不重新抛出错误，避免影响主流程
    // 但记录详细错误信息以便调试
    return null
  }
}

/**
 * 获取交易历史记录
 */
export async function getTradeHistory(limit?: number): Promise<TradeHistory[]> {
  try {
    if (!existsSync(HISTORY_FILE)) {
      return []
    }
    
    const data = await readFile(HISTORY_FILE, 'utf-8')
    const history: TradeHistory[] = JSON.parse(data)
    
    // 按关闭时间排序，最新的在前面
    history.sort((a, b) => b.closeTime - a.closeTime)
    
    if (limit) {
      return history.slice(0, limit)
    }
    
    return history
  } catch (error: any) {
    console.error('加载交易历史失败:', error.message)
    return []
  }
}

/**
 * 获取今日交易历史
 */
export async function getTodayTradeHistory(): Promise<TradeHistory[]> {
  try {
    const history = await getTradeHistory()
    const todayStart = dayjs().startOf('day').valueOf()
    
    return history.filter(trade => trade.closeTime >= todayStart)
  } catch (error: any) {
    console.error('获取今日交易历史失败:', error.message)
    return []
  }
}

/**
 * 获取默认配置
 * 默认值与 data/bot-config.json 保持同步
 */
export function getDefaultConfig(): BotConfig {
  return {
    strategyMode: 'medium_term',      // 策略模式：short_term(短期)或medium_term(中长期)
    symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'DOGE/USDT', 'HYPE/USDT', 'XAU/USDT', 'XAG/USDT', 'BNB/USDT'],
    leverage: 10,                     // 杠杆倍数（静态杠杆，当动态杠杆禁用时使用）
    maxRiskPercentage: 20,            // 单笔最大风险比例（%）
    stopLossATRMultiplier: 2.5,       // 止损ATR倍数
    maxStopLossPercentage: 2,         // 最大止损比例（%）
    positionTimeoutHours: 8,          // 持仓超时时间（小时）
    scanInterval: 180,                // 市场扫描间隔（秒）
    positionScanInterval: 60,         // 持仓扫描间隔（秒）
    tradeCooldownInterval: 7200,      // 交易冷却时间间隔（秒）- 默认2小时
    aiConfig: { 
      enabled: true,                  // 启用AI分析
      analysisInterval: 1500,         // AI分析间隔（秒）
      minScore:70,                    // AI分析分数（0-100）
      minConfidence: 70,              // 最小置信度（0-100）
      conditionMode: 'SCORE_ONLY',    // AI条件模式：仅评分/评分+置信度
      maxRiskLevel: 'MEDIUM',         // 最大风险等级：LOW/MEDIUM/HIGH
      technicalPostAdjustmentMode: 'PENALTY_ONLY', // 技术后处理模式：惩罚优先/平衡
      useForEntry: true,              // 用于开仓决策
      useForExit: true,               // 用于平仓决策
      cacheDuration: 10,              // 缓存时长（分钟）
    },
    riskConfig: {
      circuitBreaker: {
        dailyLossThreshold: 10,       // 当日亏损阈值（%）
        consecutiveLossesThreshold: 3, // 连续止损阈值（次）
      },
      forceLiquidateTime: {
        enabled: false,               // 是否启用强制平仓
        hour: 23,                     // 小时（0-23）
        minute: 55,                   // 分钟（0-59）
      },
      takeProfit: {
        tp1RiskRewardRatio: 2,        // TP1盈亏比（1:2）
        tp2RiskRewardRatio: 3,        // TP2盈亏比（1:3）
        tp1MinProfitRatio: 1,         // TP1最小盈利比例（1R）
        rsiExtreme: {
          long: 78,                   // 多头RSI极值
          short: 22,                  // 空头RSI极值
        },
        adxDecreaseThreshold: 0.8,    // ADX下降阈值
        adxSlopePeriod: 3,            // ADX斜率计算周期
      },
      dailyTradeLimit: 5,             // 当天交易次数限制
    },
    dynamicLeverageConfig: {
      enabled: false,                 // 启用动态杠杆
      minLeverage: 2,                 // 最小杠杆倍数
      maxLeverage: 20,                // 最大杠杆倍数
      baseLeverage: 8,                // 基础杠杆倍数
      riskLevelMultipliers: {         // 风险等级乘数
        LOW: 1.5,
        MEDIUM: 1.0,
        HIGH: 0.5,
      },
    },
    trailingStopConfig: {
      enabled: true,                  // 启用移动止损
      activationRatio: 0.6,           // 激活盈亏比：盈利达到风险的60%时启用
      trailingDistance: 1.2,          // 跟踪距离：ATR的1.2倍
      minMovePercent: 0.2,           // 最小移动幅度百分比：止损移动超过这个值才更新
    },
    indicatorsConfig: {
      requiredCandles: 300, // 计算指标所需K线数量
      emaPeriods: {
        short_term: {
          fast: 20,    // 快速EMA周期 (默认 20)
          medium: 30,  // 中速EMA周期 (默认 30)
          slow: 60,    // 慢速EMA周期 (默认 60)
        },
        medium_term: {
          fast: 50,    // 快速EMA周期 (默认 50)
          medium: 100, // 中速EMA周期 (默认 100)
          slow: 200,   // 慢速EMA周期 (默认 200)
        },
      },
       adxTrend: {
         adx1hThreshold: 20,           // 1小时ADX阈值
         adx4hThreshold: 15,           // 4小时ADX阈值
         adx15mThreshold: 25,          // 15分钟ADX阈值
         enableAdx15mVs1hCheck: false, // 启用15分钟ADX > 1小时ADX检查
       },
       priceBreakout: {
         enabled: false,               // 启用价格突破指标
         period: 5,                    // 突破周期（K线数）
         requireConfirmation: true,    // 需要收盘价确认
         confirmationCandles: 1,       // 确认K线数量
       },
       volatility: {
         enabled: true,                // 启用波动率过滤
         minATRPercent: 0.5,           // 最小ATR百分比阈值（0.5%）
         skipSymbols: [],              // 跳过波动率检查的交易对列表
       },
       // OI持仓量配置
       openInterest: {
         enabled: true, // 是否启用OI分析
         trendPeriod: 12, // OI趋势计算周期（默认12）
         trendThresholdPercent: 0.5, // OI趋势判定阈值（EMA相邻两期变化百分比，默认0.5%）
         changePeriod: {
           short_term: 96,
           medium_term: 24
         }
       },
       // 入场相关配置
       crossEntryEnabled: true,      // 启用EMA交叉直接入场（金叉做多/死叉做空）
       showCrossFailureReason: false, // 是否显示交叉失败原因，默认false（生产模式日志更简洁）
       predictiveCross: {
         enabled: true,               // 预判交叉总开关
         distancePercent: 0.0008,      // EMA快慢线距离小于此百分比时触发预判（默认0.08%）
         onlyTrend: true,             // 只在顺势时预判（默认true）
       },
       entryConfig: {
         emaDeviationThreshold: 0.005,         // EMA回踩偏离阈值（百分比）
         emaDeviationEnabled: true,            // 是否启用EMA回踩检查
         emaSlowDeviationThreshold: 0.05,      // 慢速EMA偏离阈值（百分比）
         emaSlowDeviationEnabled: true,        // 是否启用慢速EMA偏离检查
         rsiMin: 35,                           // RSI最小值（入场时RSI需大于该值）
         rsiMax: 35,                         // RSI最大值（入场时RSI需小于该值）
         candleShadowThreshold: 0.005,         // K线影线阈值（百分比，多头检查下影线，空头检查上影线）
         volumeConfirmation: true,             // 是否启用成交量确认
         volumeEMAPeriod: 10,                  // 成交量EMA计算周期
         volumeEMAMultiplier: 1.5,             // 成交量EMA倍数阈值（当前成交量需大于EMA*该倍数）
         minScoreThreshold: 70,                // 入场最低综合评分阈值（0-100）
       },
       priceAction: {
         enabled: false,               // 启用价格行为(PA)策略
         skipOtherChecks: true,       // 满足PA条件直接开仓，跳过所有其他检查
         pinBarEnabled: true,          // 启用Pin Bar针形K线检测
         shadowBodyRatio: 3,           // Pin Bar影线/实体比例阈值
         maxBodyRatio: 0.3,            // Pin Bar实体最大占比阈值
         engulfingEnabled: true,         // 启用吞没形态检测
         minEngulfRatio: 1.8,          // 吞没形态最小实体比例阈值
       },
    },
  }
}

/**
 * 获取默认状态
 */
export function getDefaultState(): BotState {
  return {
    status: 'IDLE' as any,
    currentPosition: null,
    circuitBreaker: {
      isTriggered: false,
      reason: '',
      timestamp: Date.now(),
      dailyLoss: 0,
      consecutiveLosses: 0,
    },
    todayTrades: 0,
    dailyPnL: 0,
    lastResetDate: dayjs().format('YYYY-MM-DD'),
    monitoringSymbols: [],
    isRunning: false,
    allowNewTrades: true,  // 默认允许新交易
    lastTradeTime: 0,      // 上次交易时间，默认为0
    // 总统计数据默认值
    totalTrades: 0,
    totalPnL: 0,
    winRate: 0,
  }
}
