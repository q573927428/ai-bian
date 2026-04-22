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

    history.push(trade)
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
    return JSON.parse(data)
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
    await safeWriteFile(BOT_CONFIG_FILE, JSON.stringify(config, null, 2))
  } catch (error: any) {
    console.error('保存机器人配置失败:', error.message)
    throw error
  }
}

/**
 * 获取默认机器人配置
 */
function getDefaultBotConfig(): BotConfig {
  return {
    symbols: [], // 默认监控交易对（空数组表示由外部配置决定）
    indicatorsConfig: {
      requiredCandles: 300, // 指标计算所需最少K线数量
      adxSlopePeriod: 3 // ADX斜率计算回看周期
    },

    aiCacheTtlMinutes: 10, // AI非IDLE信号缓存时间（分钟）
    aiIdleCacheTtlMinutes: 2, // AI IDLE信号缓存时间（分钟）

    aiAnalysisConfig: {
      enabled: true, // 是否启用AI分析保存
      maxRecords: 1000, // 单文件最大保存条数
      saveIdle: true // 是否保存IDLE分析记录
    },

    minConfidence: 70, // 信号最小置信度阈值
    defaultCandleProgress: 0.1 // 默认K线进度（用于无法获取最新K线时兜底）
  }
}
