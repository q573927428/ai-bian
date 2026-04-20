import { getStrategyManager } from '../../modules/strategy-manager'
import type { BotConfig } from '../../../types'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const config = body.config as BotConfig

    if (!config) {
      return {
        success: false,
        message: '配置数据不能为空'
      }
    }

    const manager = getStrategyManager()
    await manager.updateConfig(config)

    return {
      success: true,
      message: '配置更新成功'
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '更新配置失败'
    }
  }
})