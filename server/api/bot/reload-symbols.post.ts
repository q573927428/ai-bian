/**
 * 热重载交易对 API
 * 当 bot-config.json 新增或删除交易对时，无需重启服务器即可生效
 * 
 * body 参数:
 *   - symbols?: string[] - 最终的交易对列表（直接覆盖写入配置文件）
 *   - added?: string[] - 仅新增的交易对
 *   - removed?: string[] - 仅删除的交易对
 *   - syncStrategies?: boolean - 是否同步更新所有策略，默认 true
 * 
 * 三种调用方式:
 *   1. 只传 symbols: 用新的完整列表替换配置文件，根据差异处理增删
 *   2. 传 added: 只处理新增
 *   3. 传 removed: 只处理删除
 * 
 * 安全规则:
 *   - 若删除的交易对当前有持仓，则该交易对不会被删除并在响应中返回 blockedByPosition 列表
 *   - 新增/删除交易对时，同步更新所有策略的 marketData.symbols
 *   - 运行中的策略更新后会自动重启，以应用新的扫描交易对列表
 */
import { getSyncService } from '../../utils/kline-sync-service'
import { getBotConfig, saveBotConfig } from '../../utils/storage'
import { positionManager } from '../../modules/position-manager/PositionManager'
import { getStrategyManager } from '../../modules/strategy-manager'
import { marketPriceHub } from '../../utils/market-price-hub'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const fullSymbols: string[] | undefined = body?.symbols
    const addedOnly: string[] | undefined = body?.added
    const removedOnly: string[] | undefined = body?.removed
    const syncStrategies = body?.syncStrategies !== false

    const syncService = getSyncService()
    const currentConfig = await getBotConfig()
    const existingSymbols: string[] = currentConfig.symbols || []
    const uniqueSymbols = (symbols: string[]) => Array.from(new Set(symbols))
    const toSyncSymbol = (symbol: string) => symbol.replace('/', '')

    let added: string[] = []
    let removed: string[] = []
    let blockedByPosition: string[] = [] // 因持仓阻止删除的交易对
    let strategiesUpdated = 0
    let activeStrategiesReloaded = 0
    let finalSymbols: string[] = [...existingSymbols]

    if (fullSymbols && Array.isArray(fullSymbols)) {
      // 方式1: 传入完整 symbols 列表，计算差异
      const newSet = new Set(fullSymbols)
      const existingSet = new Set(existingSymbols)

      added = fullSymbols.filter(s => !existingSet.has(s))
      removed = existingSymbols.filter(s => !newSet.has(s))
      finalSymbols = [...fullSymbols]

      if (added.length === 0 && removed.length === 0) {
        return {
          success: true,
          message: '交易对列表没有变化，无需重载',
          added: [],
          removed: [],
          blockedByPosition: [],
          total: finalSymbols.length
        }
      }
    } else if (
      (addedOnly && Array.isArray(addedOnly) && addedOnly.length > 0) ||
      (removedOnly && Array.isArray(removedOnly) && removedOnly.length > 0)
    ) {
      const requestedAdded = uniqueSymbols(Array.isArray(addedOnly) ? addedOnly : [])
      const requestedRemoved = uniqueSymbols(Array.isArray(removedOnly) ? removedOnly : [])

      // 显式增删量可能是在配置保存后才传入的，不能再用当前配置过滤掉。
      added = requestedAdded
      removed = requestedRemoved
      
      if (added.length === 0 && removed.length === 0) {
        return {
          success: true,
          message: '交易对列表没有变化，无需重载',
          added: [],
          removed: [],
          blockedByPosition: [],
          total: existingSymbols.length
        }
      }
      
      finalSymbols = uniqueSymbols([
        ...existingSymbols.filter(s => !removed.includes(s)),
        ...added
      ])
    } else {
      return {
        success: false,
        message: '请提供 symbols、added 或 removed 参数'
      }
    }

    // ========== 持仓检查：阻止删除有活跃持仓的交易对 ==========
    if (removed.length > 0) {
      // 确保仓位管理器已初始化
      await positionManager.waitForInit()

      const safeToRemove: string[] = []
      const blocked: string[] = []

      for (const symbol of removed) {
        if (positionManager.hasPosition(symbol)) {
          blocked.push(symbol)
          console.log(`⚠️ 热重载: 交易对 ${symbol} 当前有活跃持仓，阻止删除`)
        } else {
          safeToRemove.push(symbol)
        }
      }

      if (blocked.length > 0) {
        blockedByPosition = blocked
        // 将被阻止的交易对重新加回 finalSymbols
        finalSymbols = uniqueSymbols([...finalSymbols, ...blocked])
      }

      removed = safeToRemove
    }

    // 更新配置文件
    await saveBotConfig({ ...currentConfig, symbols: finalSymbols })

    const syncAdded = added.map(toSyncSymbol)
    const syncRemoved = removed.map(toSyncSymbol)
    const syncFinalSymbols = finalSymbols.map(toSyncSymbol)

    // ========== 处理删除交易对 ==========
    if (removed.length > 0) {
      // 1. 从 K线同步服务和数据库移除
      if (syncService) {
        syncService.removeSymbols(syncRemoved)
      }

      console.log(`🔄 热重载: 已从 K线同步服务和所有策略中移除交易对: ${removed.join(', ')}`)
    }

    // 兜底收敛：避免 add/remove 因格式或历史状态导致同步服务内部 symbol 数量漂移。
    if (syncService) {
      syncService.updateConfig({ symbols: syncFinalSymbols })
    }

    // ========== 处理新增交易对 ==========
    if (added.length > 0 && syncService) {
      console.log(`🔄 热重载: 已为 K线同步服务注册新交易对: ${added.join(', ')}`)
      syncService.enqueueInitialSync(syncAdded)
    }

    try {
      // 行情订阅由服务端统一维护，配置变化后立即向所有 SSE 客户端发布新快照。
      await marketPriceHub.syncSymbols(syncFinalSymbols)
    } catch (priceSyncError: any) {
      // 行情网络故障不能回滚已经落盘的交易对配置；后续 SSE 初始化会按配置再次收敛。
      console.warn(`实时价格交易对同步失败，将在下次连接时重试: ${priceSyncError.message}`)
    }

    // ========== 同步所有策略的交易对 ==========
    // K 线和行情订阅在上方始终热重载；开关关闭时只跳过策略文件更新。
    if (syncStrategies && (added.length > 0 || removed.length > 0)) {
      try {
        const strategyManager = getStrategyManager()
        const allStrategies = await strategyManager.getAllStrategies()

        for (const strategy of allStrategies) {
          if (!strategy.marketData?.symbols) continue

          const originalStrategySymbols = strategy.marketData.symbols
          const updatedSymbols = uniqueSymbols([
            ...originalStrategySymbols.filter((s: string) => !removed.includes(s)),
            ...added
          ])

          const changed =
            updatedSymbols.length !== originalStrategySymbols.length ||
            updatedSymbols.some((s, index) => s !== originalStrategySymbols[index])

          if (!changed) continue

          const updatedStrategy = await strategyManager.updateStrategyWithoutVersion(strategy.id, {
            marketData: {
              ...strategy.marketData,
              symbols: updatedSymbols
            }
          })

          if (updatedStrategy) {
            strategiesUpdated++
            if (strategy.isActive) activeStrategiesReloaded++

            const addedForStrategy = added.filter(s => !originalStrategySymbols.includes(s))
            const removedForStrategy = originalStrategySymbols.filter((s: string) => removed.includes(s))
            console.log(`🔄 热重载: 已同步策略 ${strategy.name} (${strategy.id}) 交易对: ${
              [
                addedForStrategy.length > 0 ? `新增 ${addedForStrategy.join(', ')}` : '',
                removedForStrategy.length > 0 ? `删除 ${removedForStrategy.join(', ')}` : ''
              ].filter(Boolean).join('；')
            }`)
          }
        }
      } catch (err: any) {
        console.error('同步策略交易对失败:', err.message)
        throw new Error(`同步策略交易对失败: ${err.message}`)
      }
    }

    const parts: string[] = []
    if (added.length > 0) parts.push(`新增 ${added.length} 个: ${added.join(', ')}`)
    if (removed.length > 0) parts.push(`删除 ${removed.length} 个: ${removed.join(', ')}`)
    if (blockedByPosition.length > 0) parts.push(`因持仓阻止删除 ${blockedByPosition.length} 个: ${blockedByPosition.join(', ')}`)
    if (strategiesUpdated > 0) parts.push(`同步策略 ${strategiesUpdated} 个`)
    if (activeStrategiesReloaded > 0) parts.push(`重载运行中策略 ${activeStrategiesReloaded} 个`)
    const strategiesSkipped = !syncStrategies && (added.length > 0 || removed.length > 0)
    if (strategiesSkipped) parts.push('未同步策略')

    console.log(`✅ 热重载完成: ${parts.join('，')}`)

    return {
      success: true,
      message: parts.join('；') || '无变化',
      added,
      removed,
      blockedByPosition,
      strategiesUpdated,
      activeStrategiesReloaded,
      strategiesSkipped,
      total: finalSymbols.length
    }
  } catch (error: any) {
    console.error('热重载交易对失败:', error)
    return {
      success: false,
      message: `热重载失败: ${error.message}`
    }
  }
})
