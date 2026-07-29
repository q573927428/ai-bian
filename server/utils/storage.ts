import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import type { TradeHistory, BotState, BotConfig } from '../../types'
import type { PositionInfo } from '../modules/position-manager/PositionManager'

const DATA_DIR = join(process.cwd(), 'data')
const HISTORY_FILE = join(DATA_DIR, 'trade-history.json')
const ACTIVE_POSITIONS_FILE = join(DATA_DIR, 'active-positions.json')
const SYMBOL_LOCKS_FILE = join(DATA_DIR, 'symbol-locks.json')
const BOT_STATE_FILE = join(DATA_DIR, 'bot-state.json')
const BOT_CONFIG_FILE = join(DATA_DIR, 'bot-config.json')

// 文件锁机制，防止并发写入
const fileLocks = new Map<string, Promise<void>>()

/**
 * 安全写入文件（带锁机制）
 */
async function safeWriteFile(filePath: string, content: string): Promise<void> {
  let lock = fileLocks.get(filePath) || Promise.resolve()

  const newLock = lock.then(async () => {
    try {
      await writeFile(filePath, content, 'utf-8')
    } finally {
      if (fileLocks.get(filePath) === newLock) {
        fileLocks.delete(filePath)
      }
    }
  })

  fileLocks.set(filePath, newLock)
  return newLock
}

/**
 * 确保数据目录存在
 */
async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true })
  }
}

/**
 * 添加交易历史记录
 */
export async function addTradeHistory(trade: TradeHistory): Promise<void> {
  try {
    await ensureDataDir()

    let history: TradeHistory[] = []

    if (existsSync(HISTORY_FILE)) {
      try {
        const data = await readFile(HISTORY_FILE, 'utf-8')
        if (data.trim()) {
          history = JSON.parse(data)
        }
      } catch (parseError: any) {
        console.warn('解析交易历史文件失败，创建新文件:', parseError.message)
        history = []
      }
    }

    if (!trade.id) {
      trade.id = `${trade.closeTime}-${trade.symbol.replace('/', '-')}`
    }

    // 币安订单ID参与交易ID后，同一平仓订单的重试必须覆盖原记录，避免对账重试重复累计收益。
    const existingIndex = history.findIndex(item => item.id === trade.id)
    if (existingIndex >= 0) {
      history[existingIndex] = trade
    } else {
      history.push(trade)
    }
    history.sort((a, b) => b.closeTime - a.closeTime)

    await safeWriteFile(HISTORY_FILE, JSON.stringify(history, null, 2))
    console.log(`交易历史已保存: ${trade.symbol} ${trade.direction} PnL: ${trade.pnl.toFixed(2)} USDT`)
  } catch (error: any) {
    console.error('保存交易历史失败:', error.message)
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
 * 保存活跃持仓
 */
export async function saveActivePositions(positions: PositionInfo[]): Promise<void> {
  try {
    await ensureDataDir()
    const safePositions = positions.map(pos => ({
      ...pos,
      position: pos.position ? { ...pos.position } : undefined
    }))
    await safeWriteFile(ACTIVE_POSITIONS_FILE, JSON.stringify(safePositions, null, 2))
  } catch (error: any) {
    console.error('保存活跃持仓失败:', error.message)
    throw error
  }
}

/**
 * 加载活跃持仓
 */
export async function loadActivePositions(): Promise<PositionInfo[]> {
  try {
    if (!existsSync(ACTIVE_POSITIONS_FILE)) {
      return []
    }
    const data = await readFile(ACTIVE_POSITIONS_FILE, 'utf-8')
    if (!data.trim()) {
      return []
    }
    const parsed = JSON.parse(data)
    if (!Array.isArray(parsed)) {
      console.warn('活跃持仓文件格式不正确，返回空数组')
      return []
    }
    return parsed
  } catch (error: any) {
    console.error('加载活跃持仓失败:', error.message)
    try {
      if (existsSync(ACTIVE_POSITIONS_FILE)) {
        const backupPath = ACTIVE_POSITIONS_FILE + '.backup-' + Date.now()
        const data = await readFile(ACTIVE_POSITIONS_FILE, 'utf-8')
        await safeWriteFile(backupPath, data)
        console.warn(`已备份损坏的活跃持仓文件到: ${backupPath}`)
      }
    } catch (backupError: any) {
      console.error('备份损坏文件失败:', backupError.message)
    }
    return []
  }
}

/**
 * 保存交易对锁
 */
export async function saveSymbolLocks(locks: Record<string, string>): Promise<void> {
  try {
    await ensureDataDir()
    await safeWriteFile(SYMBOL_LOCKS_FILE, JSON.stringify(locks, null, 2))
  } catch (error: any) {
    console.error('保存交易对锁失败:', error.message)
    throw error
  }
}

/**
 * 加载交易对锁
 */
export async function loadSymbolLocks(): Promise<Record<string, string>> {
  try {
    if (!existsSync(SYMBOL_LOCKS_FILE)) {
      return {}
    }
    const data = await readFile(SYMBOL_LOCKS_FILE, 'utf-8')
    return JSON.parse(data) || {}
  } catch (error: any) {
    console.error('加载交易对锁失败:', error.message)
    return {}
  }
}

/**
 * 清除活跃持仓和交易对锁（全部平仓时调用）
 */
export async function clearActiveState(): Promise<void> {
  try {
    await saveActivePositions([])
    await saveSymbolLocks({})
  } catch (error: any) {
    console.error('清除活跃状态失败:', error.message)
  }
}

/**
 * 保存机器人状态
 */
export async function saveBotState(state: BotState): Promise<void> {
  try {
    await ensureDataDir()
    await safeWriteFile(BOT_STATE_FILE, JSON.stringify(state, null, 2))
  } catch (error: any) {
    console.error('保存机器人状态失败:', error.message)
    throw error
  }
}

/**
 * 加载机器人状态
 */
export async function loadBotState(): Promise<BotState | null> {
  try {
    if (!existsSync(BOT_STATE_FILE)) {
      return null
    }
    const data = await readFile(BOT_STATE_FILE, 'utf-8')
    if (!data.trim()) {
      return null
    }
    return JSON.parse(data)
  } catch (error: any) {
    console.error('加载机器人状态失败:', error.message)
    return null
  }
}

/**
 * 加载机器人配置
 */
export async function loadBotConfig(): Promise<BotConfig> {
  return await getBotConfig()
}

/**
 * 获取机器人配置（loadBotConfig的别名）
 */
export async function getBotConfig(): Promise<BotConfig> {
  try {
    if (!existsSync(BOT_CONFIG_FILE)) {
      return getDefaultBotConfig()
    }
    const data = await readFile(BOT_CONFIG_FILE, 'utf-8')
    if (!data.trim()) {
      return getDefaultBotConfig()
    }
    const config = JSON.parse(data)
    
    // 确保 emaPeriods 存在
    if (!config.emaPeriods || !Array.isArray(config.emaPeriods)) {
      config.emaPeriods = [14, 50]
    }

    // 成交量EMA周期默认值
    if (!Number.isFinite(config.volumeEmaPeriod) || Number(config.volumeEmaPeriod) < 2) {
      config.volumeEmaPeriod = 12
    }
    
    return normalizeBotConfig(config)
  } catch (error: any) {
    console.error('加载机器人配置失败:', error.message)
    return getDefaultBotConfig()
  }
}

/**
 * 保存机器人配置
 */
export async function saveBotConfig(config: BotConfig): Promise<void> {
  try {
    await ensureDataDir()
    await safeWriteFile(BOT_CONFIG_FILE, JSON.stringify(normalizeBotConfig(config), null, 2))
  } catch (error: any) {
    console.error('保存机器人配置失败:', error.message)
    throw error
  }
}

function normalizeBotConfig(input: Partial<BotConfig> = {}): BotConfig {
  const defaults = getDefaultBotConfig()
  const config: BotConfig = {
    ...defaults,
    ...input,
    symbols: Array.isArray(input.symbols) ? input.symbols : defaults.symbols,
    indicatorsConfig: {
      ...defaults.indicatorsConfig,
      ...(input.indicatorsConfig || {})
    },
    aiAnalysisConfig: {
      ...defaults.aiAnalysisConfig,
      ...(input.aiAnalysisConfig || {})
    },
    concurrencyPool: {
      indicator: {
        ...defaults.concurrencyPool!.indicator,
        ...(input.concurrencyPool?.indicator || {})
      },
      ai: {
        ...defaults.concurrencyPool!.ai,
        ...(input.concurrencyPool?.ai || {})
      },
      tradeApi: {
        ...defaults.concurrencyPool!.tradeApi,
        ...(input.concurrencyPool?.tradeApi || {})
      }
    },
    strategyScheduler: {
      ...defaults.strategyScheduler!,
      ...(input.strategyScheduler || {})
    },
    aiRateLimit: {
      ...defaults.aiRateLimit!,
      ...(input.aiRateLimit || {})
    },
    binanceRateLimit: {
      ...defaults.binanceRateLimit!,
      ...(input.binanceRateLimit || {})
    },
    indicatorPrecompute: {
      ...defaults.indicatorPrecompute!,
      ...(input.indicatorPrecompute || {})
    },
    chartMarkerConfig: {
      ...defaults.chartMarkerConfig,
      ...(input.chartMarkerConfig || {})
    }
  }

  if (!config.emaPeriods || !Array.isArray(config.emaPeriods)) {
    config.emaPeriods = [14, 50]
  }

  if (!Number.isFinite(config.volumeEmaPeriod) || Number(config.volumeEmaPeriod) < 2) {
    config.volumeEmaPeriod = 12
  }

  config.concurrencyPool!.indicator.maxConcurrency = clampInteger(config.concurrencyPool!.indicator.maxConcurrency, 1, 64, 6)
  config.concurrencyPool!.ai.maxConcurrency = clampInteger(config.concurrencyPool!.ai.maxConcurrency, 1, 32, 3)
  config.concurrencyPool!.tradeApi.maxConcurrency = clampInteger(config.concurrencyPool!.tradeApi.maxConcurrency, 1, 16, 1)
  config.strategyScheduler!.symbolBatchSize = clampInteger(config.strategyScheduler!.symbolBatchSize, 1, 20, 3)
  config.strategyScheduler!.symbolBatchDelayMs = clampInteger(config.strategyScheduler!.symbolBatchDelayMs, 0, 60000, 5000)
  config.strategyScheduler!.maxLoopDurationMs = clampInteger(config.strategyScheduler!.maxLoopDurationMs, 30000, 600000, 240000)
  config.aiRateLimit!.maxConcurrent = clampInteger(config.aiRateLimit!.maxConcurrent, 1, 32, 3)
  config.aiRateLimit!.maxRequestsPerMinute = clampInteger(config.aiRateLimit!.maxRequestsPerMinute, 1, 120, 20)
  config.aiRateLimit!.maxRequestsPerScan = clampInteger(config.aiRateLimit!.maxRequestsPerScan, 1, 200, 40)
  config.aiRateLimit!.timeoutMs = clampInteger(config.aiRateLimit!.timeoutMs, 5000, 180000, 45000)
  config.aiRateLimit!.cooldownAfterErrorMs = clampInteger(config.aiRateLimit!.cooldownAfterErrorMs, 10000, 600000, 60000)
  config.binanceRateLimit!.marketDataConcurrency = clampInteger(config.binanceRateLimit!.marketDataConcurrency, 1, 10, 2)
  config.binanceRateLimit!.accountConcurrency = clampInteger(config.binanceRateLimit!.accountConcurrency, 1, 5, 1)
  config.binanceRateLimit!.tradeConcurrency = clampInteger(config.binanceRateLimit!.tradeConcurrency, 1, 5, 1)
  config.binanceRateLimit!.retryBaseMs = clampInteger(config.binanceRateLimit!.retryBaseMs, 250, 30000, 1000)
  config.binanceRateLimit!.retryMaxMs = clampInteger(config.binanceRateLimit!.retryMaxMs, 1000, 300000, 60000)
  config.indicatorPrecompute!.intervalMs = clampInteger(config.indicatorPrecompute!.intervalMs, 60000, 3600000, 300000)
  config.indicatorPrecompute!.maxConcurrency = clampInteger(config.indicatorPrecompute!.maxConcurrency, 1, 64, 8)
  config.indicatorPrecompute!.staleTtlMs = clampInteger(config.indicatorPrecompute!.staleTtlMs, 60000, 7200000, 900000)
  config.indicatorPrecompute!.technicalIndicatorIntervalMs = clampInteger(config.indicatorPrecompute!.technicalIndicatorIntervalMs, 60000, 3600000, 300000)
  config.indicatorPrecompute!.oiFastIntervalMs = clampInteger(config.indicatorPrecompute!.oiFastIntervalMs, 60000, 3600000, 600000)
  config.indicatorPrecompute!.oiSlowIntervalMs = clampInteger(config.indicatorPrecompute!.oiSlowIntervalMs, 60000, 7200000, 1800000)
  config.indicatorPrecompute!.squareHeatIntervalMs = clampInteger(config.indicatorPrecompute!.squareHeatIntervalMs, 60000, 7200000, 1800000)

  const ratio = Number(config.binanceRateLimit!.maxUsedWeight1mRatio)
  config.binanceRateLimit!.maxUsedWeight1mRatio = Number.isFinite(ratio)
    ? Math.min(0.95, Math.max(0.1, ratio))
    : 0.75

  return config
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, Math.floor(numberValue)))
}

/**
 * 获取默认机器人配置
 */
function getDefaultBotConfig(): BotConfig {
  return {
    symbols: [], // 默认监控交易对列表（从 bot-config.json 读取）
    monitorInterval: 60, // 持仓监控间隔（秒）
    indicatorsConfig: {
      requiredCandles: 500, // 指标计算所需最少K线数量
      adxSlopePeriod: 3, // ADX斜率计算回看周期
      emaSlopePeriod: 3 // EMA斜率计算回看周期
    },
    emaPeriods: [14, 50], // EMA周期数组
    volumeEmaPeriod: 12, // 成交量EMA均值周期
    aiCacheTtlMinutes: 10, // AI缓存时间（分钟）
    aiAnalysisConfig: {
      enabled: true, // 是否启用AI分析日志
      maxRecords: 3500, // 单文件最大保存条数
      saveIdle: false, // 是否保存IDLE分析记录
      minConfidence: 30,
      enableHistorySection: false, // 是否在系统提示词中包含历史分析经验
    },
    defaultTimeframe: '1h', // 默认K线周期
    defaultCandleProgress: 0.1, // 默认K线进度（用于无法获取最新K线时兜底）
    commissionRate: 0.0005, // 手续费率
    concurrencyPool: {
      indicator: { maxConcurrency: 8 }, // 指标计算并发数
      ai: { maxConcurrency: 5 }, // AI分析并发数
      tradeApi: { maxConcurrency: 1 }, // 交易API并发数
    },
    strategyScheduler: {
      symbolBatchSize: 3,
      symbolBatchDelayMs: 5000,
      maxLoopDurationMs: 240000,
    },
    aiRateLimit: {
      maxConcurrent: 3,
      maxRequestsPerMinute: 20,
      maxRequestsPerScan: 40,
      timeoutMs: 45000,
      cooldownAfterErrorMs: 60000,
    },
    binanceRateLimit: {
      marketDataConcurrency: 2,
      accountConcurrency: 1,
      tradeConcurrency: 1,
      maxUsedWeight1mRatio: 0.75,
      retryBaseMs: 1000,
      retryMaxMs: 60000,
    },
    indicatorPrecompute: {
      enabled: true,
      intervalMs: 300000,
      maxConcurrency: 8,
      staleTtlMs: 900000,
      computeOnStrategyChange: true,
      technicalIndicatorIntervalMs: 300000,
      oiFastIntervalMs: 600000,
      oiSlowIntervalMs: 1800000,
      squareHeatIntervalMs: 1800000,
    },
    chartMarkerConfig: {
      showEMAMarkers: false, // 显示EMA金叉死叉标记
      showOrderMarkers: true, // 显示历史订单开仓平仓标记
      showEMALines: true, // 显示EMA快慢线
    },
    initialCapital: 0, // 初始本金（USDT），需用户在配置中设置
  }
}
