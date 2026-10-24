// ==================== 每日开仓次数限制器 ====================

import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StrategyId } from '../../../types/strategy'
import type { PositionManager } from '../position-manager/PositionManager'
import { logger } from '../../utils/logger'

const DATA_DIR = join(process.cwd(), 'data')
const STATE_FILE = join(DATA_DIR, 'daily-trade-counts.json')
const TIME_ZONE = 'Asia/Shanghai'

/**
 * 已确认的每日开仓记录
 *
 * key 优先使用交易所开仓订单 ID，用于跨成交历史、当前持仓和持久化状态去重。
 */
interface DailyOpeningRecord {
  key: string
  strategyId: StrategyId
  symbol: string
  openedAt: number
}

/**
 * 每日开仓计数持久化状态
 */
interface DailyTradeCountState {
  dayKey: string
  openings: DailyOpeningRecord[]
}

/**
 * 开仓名额预占结果
 */
export interface DailyTradeReservationResult {
  allowed: boolean
  reservationId?: string
  openedCount: number
  reservedCount: number
  limit: number
}

/**
 * 每日开仓次数限制器
 *
 * 核心职责：
 * 1. 按北京时间自然日和策略分别统计成功开仓次数
 * 2. 原子预占开仓名额，防止并发信号突破每日上限
 * 3. 从成交历史、当前持仓和本地状态恢复计数，避免重启后清零
 */
export class DailyTradeLimiter {
  private readonly openings = new Map<string, DailyOpeningRecord>()
  private readonly reservations = new Map<string, { strategyId: StrategyId; dayKey: string }>()
  private mutex: Promise<void> = Promise.resolve()
  private initializedDayKey = ''
  private reservationSequence = 0

  constructor(private readonly positionManager: PositionManager) {}

  /** 读取与开仓检查相同的当日计数，不预占名额；跨北京时间零点时自动恢复新日计数。 */
  async getStatus(strategyId: StrategyId, maxDailyTrades: number, now = Date.now()) {
    return this.withLock(async () => {
      const dayKey = this.getDayKey(now)
      await this.ensureInitialized(dayKey)
      const limit = Math.max(0, Math.floor(Number(maxDailyTrades) || 0))
      const openedCount = this.countOpenings(strategyId, dayKey)
      // 预占名额尚未成交，不能显示为今日已成功开仓。
      return { todayOpenedCount: openedCount, dailyTradeLimitReached: openedCount >= limit }
    })
  }

  /**
   * 原子检查并预占一个开仓名额
   */
  async reserve(strategyId: StrategyId, maxDailyTrades: number, now = Date.now()): Promise<DailyTradeReservationResult> {
    return this.withLock(async () => {
      const dayKey = this.getDayKey(now)
      await this.ensureInitialized(dayKey)

      const limit = Math.max(0, Math.floor(Number(maxDailyTrades) || 0))
      const openedCount = this.countOpenings(strategyId, dayKey)
      const reservedCount = this.countReservations(strategyId, dayKey)

      if (limit === 0 || openedCount + reservedCount >= limit) {
        return { allowed: false, openedCount, reservedCount, limit }
      }

      this.reservationSequence += 1
      const reservationId = `${dayKey}:${strategyId}:${now}:${this.reservationSequence}`
      this.reservations.set(reservationId, { strategyId, dayKey })

      return { allowed: true, reservationId, openedCount, reservedCount, limit }
    })
  }

  /**
   * 开仓成交确认后提交计数
   */
  async commit(
    reservationId: string,
    opening: { strategyId: StrategyId; symbol: string; openedAt: number; entryOrderId?: string | number }
  ): Promise<void> {
    await this.withLock(async () => {
      const reservation = this.reservations.get(reservationId)
      if (!reservation) return

      this.reservations.delete(reservationId)
      const dayKey = this.getDayKey(opening.openedAt)

      // 信号可能跨过零点才成交，成交次数必须归入实际开仓日。
      await this.ensureInitialized(dayKey)
      const key = this.getOpeningKey(opening)
      this.openings.set(key, {
        key,
        strategyId: opening.strategyId,
        symbol: opening.symbol,
        openedAt: opening.openedAt
      })

      await this.persistState()
    })
  }

  /**
   * 开仓未成交时释放预占名额
   */
  async release(reservationId: string): Promise<void> {
    await this.withLock(async () => {
      this.reservations.delete(reservationId)
    })
  }

  /**
   * 初始化或切换北京时间自然日
   */
  private async ensureInitialized(dayKey: string): Promise<void> {
    if (this.initializedDayKey === dayKey) return

    this.openings.clear()
    this.reservations.clear()
    this.initializedDayKey = dayKey

    await this.loadPersistedState(dayKey)
    await this.loadTradeHistory(dayKey)
    this.loadActivePositions(dayKey)
    await this.persistState()
  }

  /**
   * 从持久化状态恢复已确认开仓记录
   */
  private async loadPersistedState(dayKey: string): Promise<void> {
    if (!existsSync(STATE_FILE)) return

    try {
      const state = JSON.parse(await readFile(STATE_FILE, 'utf-8')) as DailyTradeCountState
      if (state.dayKey !== dayKey || !Array.isArray(state.openings)) return

      for (const opening of state.openings) {
        if (opening.symbol && this.getDayKey(opening.openedAt) === dayKey) {
          this.openings.set(opening.key, opening)
        }
      }
    } catch (error: any) {
      logger.error('每日开仓限制', `读取计数状态失败: ${error.message}`)
    }
  }

  /**
   * 从所有成交历史文件恢复当天已经平仓的开仓次数
   */
  private async loadTradeHistory(dayKey: string): Promise<void> {
    try {
      const fileNames = (await readdir(DATA_DIR)).filter(name => /^trade-history(?:-\d{8})?\.json$/.test(name))

      for (const fileName of fileNames) {
        const trades = JSON.parse(await readFile(join(DATA_DIR, fileName), 'utf-8'))
        if (!Array.isArray(trades)) continue

        for (const trade of trades) {
          const openedAt = Number(trade.openTime)
          if (!openedAt || this.getDayKey(openedAt) !== dayKey || !trade.strategyId) continue

          const key = this.getOpeningKey({
            strategyId: trade.strategyId,
            symbol: trade.symbol,
            openedAt,
            entryOrderId: trade.entryOrderId
          })
          this.openings.set(key, { key, strategyId: trade.strategyId, symbol: trade.symbol, openedAt })
        }
      }
    } catch (error: any) {
      logger.error('每日开仓限制', `读取成交历史失败: ${error.message}`)
    }
  }

  /**
   * 从当前持仓恢复当天尚未平仓的开仓次数
   */
  private loadActivePositions(dayKey: string): void {
    for (const position of this.positionManager.getActivePositions()) {
      const openedAt = Number(position.openTime)
      if (!openedAt || this.getDayKey(openedAt) !== dayKey) continue

      const key = this.getOpeningKey({
        strategyId: position.strategyId,
        symbol: position.symbol,
        openedAt,
        entryOrderId: position.entryOrderId || position.orderId
      })
      this.openings.set(key, { key, strategyId: position.strategyId, symbol: position.symbol, openedAt })
    }
  }

  /**
   * 保存当天计数，保证服务重启后仍能执行限制
   */
  private async persistState(): Promise<void> {
    const state: DailyTradeCountState = {
      dayKey: this.initializedDayKey,
      openings: Array.from(this.openings.values())
    }

    try {
      await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
    } catch (error: any) {
      // 内存计数仍然有效，持久化失败不能影响已经建立的真实仓位。
      logger.error('每日开仓限制', `保存计数状态失败: ${error.message}`)
    }
  }

  /**
   * 生成可跨数据源去重的开仓键
   */
  private getOpeningKey(opening: {
    strategyId: StrategyId
    symbol: string
    openedAt: number
    entryOrderId?: string | number
  }): string {
    if (opening.entryOrderId !== undefined && opening.entryOrderId !== null && String(opening.entryOrderId)) {
      return `${opening.strategyId}:${opening.symbol}:order:${String(opening.entryOrderId)}`
    }
    return `${opening.strategyId}:${opening.symbol}:${opening.openedAt}`
  }

  /**
   * 获取北京时间自然日键
   */
  private getDayKey(timestamp: number): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(timestamp))
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  }

  private countOpenings(strategyId: StrategyId, dayKey: string): number {
    return Array.from(this.openings.values()).filter(
      opening => opening.strategyId === strategyId && this.getDayKey(opening.openedAt) === dayKey
    ).length
  }

  private countReservations(strategyId: StrategyId, dayKey: string): number {
    return Array.from(this.reservations.values()).filter(
      reservation => reservation.strategyId === strategyId && reservation.dayKey === dayKey
    ).length
  }

  /**
   * 串行执行计数检查和更新，避免并发信号同时越过上限
   */
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutex
    let release!: () => void
    this.mutex = new Promise<void>(resolve => {
      release = resolve
    })

    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
