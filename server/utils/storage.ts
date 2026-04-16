import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import type { TradeHistory, BotState } from '../../types'
import type { PositionInfo } from '../modules/position-manager/PositionManager'
import dayjs from 'dayjs'

const DATA_DIR = join(process.cwd(), 'data')
const STATE_FILE = join(DATA_DIR, 'bot-state.json')
const HISTORY_FILE = join(DATA_DIR, 'trade-history.json')
const ACTIVE_POSITIONS_FILE = join(DATA_DIR, 'active-positions.json')
const SYMBOL_LOCKS_FILE = join(DATA_DIR, 'symbol-locks.json')
const CONFIG_FILE = join(DATA_DIR, 'bot-config.json')

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
 * 加载机器人配置
 */
export async function loadBotConfig(): Promise<any | null> {
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
  } catch (error: any) {
    console.error('保存交易历史失败:', error.message)
    // 不重新抛出错误，避免影响主流程
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
 * 保存活跃持仓
 */
export async function saveActivePositions(positions: PositionInfo[]): Promise<void> {
  try {
    await ensureDataDir()
    await writeFile(ACTIVE_POSITIONS_FILE, JSON.stringify(positions, null, 2), 'utf-8')
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
    return JSON.parse(data) || []
  } catch (error: any) {
    console.error('加载活跃持仓失败:', error.message)
    return []
  }
}

/**
 * 保存交易对锁
 */
export async function saveSymbolLocks(locks: Record<string, string>): Promise<void> {
  try {
    await ensureDataDir()
    await writeFile(SYMBOL_LOCKS_FILE, JSON.stringify(locks, null, 2), 'utf-8')
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