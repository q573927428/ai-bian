/**
 * 热重载交易对 API
 * 当 bot-config.json 新增或删除交易对时，无需重启服务器即可生效
 * 
 * body 参数:
 *   - symbols?: string[] - 最终的交易对列表（直接覆盖写入配置文件）
 *   - added?: string[] - 仅新增的交易对
 *   - removed?: string[] - 仅删除的交易对
 * 
 * 三种调用方式:
 *   1. 只传 symbols: 用新的完整列表替换配置文件，根据差异处理增删
 *   2. 传 added: 只处理新增
 *   3. 传 removed: 只处理删除
 * 
 * 安全规则:
 *   - 若删除的交易对当前有持仓，则该交易对不会被删除并在响应中返回 blockedByPosition 列表
 *   - 删除交易对时，同步从所有策略的 marketData.symbols 中移除该交易对
 */
import { getSyncService } from '../../utils/kline-sync-service'
import { getBotConfig, saveBotConfig } from '../../utils/storage'
import { positionManager } from '../../modules/position-manager/PositionManager'
import { StrategyStore } from '../../modules/strategy-store/StrategyStore'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const fullSymbols: string[] | undefined = body?.symbols
    const addedOnly: string[] | undefined = body?.added
    const removedOnly: string[] | undefined = body?.removed

    const syncService = getSyncService()
    const currentConfig = await getBotConfig()
    const existingSymbols: string[] = currentConfig.symbols || []

    let added: string[] = []
    let removed: string[] = []
    let blockedByPosition: string[] = [] // 因持仓阻止删除的交易对
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
    } else if (addedOnly && Array.isArray(addedOnly) && addedOnly.length > 0) {
      const existingSet = new Set(existingSymbols)
      added = addedOnly.filter(s => !existingSet.has(s))
      
      if (added.length === 0) {
        return {
          success: true,
          message: '没有新增的交易对，无需重载',
          added: [],
          removed: [],
          blockedByPosition: [],
          total: existingSymbols.length
        }
      }
      
      finalSymbols = [...existingSymbols, ...added]
    } else if (removedOnly && Array.isArray(removedOnly) && removedOnly.length > 0) {
      removed = removedOnly.filter(s => existingSymbols.includes(s))
      
      if (removed.length === 0) {
        return {
          success: true,
          message: '没有需要删除的交易对',
          added: [],
          removed: [],
          blockedByPosition: [],
          total: existingSymbols.length
        }
      }
      
      finalSymbols = existingSymbols.filter(s => !removed.includes(s))
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
        finalSymbols = [...finalSymbols, ...blocked]
      }

      removed = safeToRemove
    }

    // 更新配置文件
    await saveBotConfig({ ...currentConfig, symbols: finalSymbols })

    // ========== 处理新增交易对 ==========
    if (added.length > 0 && syncService) {
      syncService.addSymbols(added)
      console.log(`🔄 热重载: 已为 K线同步服务注册新交易对: ${added.join(', ')}`)
      
      // 异步触发新交易对的初始同步
      syncService.syncSymbols(added).catch((err: Error) => {
        console.error('新交易对初始同步失败:', err.message)
      })
    }

    // ========== 处理删除交易对 ==========
    if (removed.length > 0) {
      // 1. 从 K线同步服务和数据库移除
      if (syncService) {
        syncService.removeSymbols(removed)
      }

      // 2. 从所有策略的 marketData.symbols 中移除该交易对
      try {
        const strategyStore = new StrategyStore()
        const allStrategies = await strategyStore.getAllStrategies()
        
        for (const strategy of allStrategies) {
          if (!strategy.marketData?.symbols) continue
          
          const strategySymbols = strategy.marketData.symbols
          const updatedSymbols = strategySymbols.filter(
            (s: string) => !removed.includes(s)
          )
          
          // 如果有变化，更新策略
          if (updatedSymbols.length !== strategySymbols.length) {
            await strategyStore.updateStrategyWithoutVersion(strategy.id, {
              marketData: {
                ...strategy.marketData,
                symbols: updatedSymbols
              }
            })
            console.log(`🔄 热重载: 已从策略 ${strategy.name} (${strategy.id}) 中移除交易对: ${
              strategySymbols.filter((s: string) => !updatedSymbols.includes(s)).join(', ')
            }`)
          }
        }
      } catch (err: any) {
        console.error('从策略中同步移除交易对失败:', err.message)
      }

      console.log(`🔄 热重载: 已从 K线同步服务和所有策略中移除交易对: ${removed.join(', ')}`)
    }

    const parts: string[] = []
    if (added.length > 0) parts.push(`新增 ${added.length} 个: ${added.join(', ')}`)
    if (removed.length > 0) parts.push(`删除 ${removed.length} 个: ${removed.join(', ')}`)
    if (blockedByPosition.length > 0) parts.push(`因持仓阻止删除 ${blockedByPosition.length} 个: ${blockedByPosition.join(', ')}`)

    console.log(`✅ 热重载完成: ${parts.join('，')}`)

    return {
      success: true,
      message: parts.join('；') || '无变化',
      added,
      removed,
      blockedByPosition,
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