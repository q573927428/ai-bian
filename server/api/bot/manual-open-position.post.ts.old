import type { ApiResponse } from '../../../types'
import { logger } from '../../utils/logger'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const {
      symbol,
      direction,
      orderType = 'MARKET',
      price,
      amountType = 'USDT',
      amount,
      leverage,
      password
    } = body

    // 验证必填参数
    if (!symbol || !direction || !amount || !leverage) {
      return {
        success: false,
        message: '缺少必填参数：symbol, direction, amount, leverage'
      } as ApiResponse
    }

    // 验证方向
    if (!['LONG', 'SHORT'].includes(direction)) {
      return {
        success: false,
        message: 'direction必须是LONG或SHORT'
      } as ApiResponse
    }

    // 验证订单类型
    if (!['MARKET', 'LIMIT'].includes(orderType)) {
      return {
        success: false,
        message: 'orderType必须是MARKET或LIMIT'
      } as ApiResponse
    }

    // 如果是限价订单，需要价格
    if (orderType === 'LIMIT' && !price) {
      return {
        success: false,
        message: '限价订单需要price参数'
      } as ApiResponse
    }

    // 验证金额类型
    if (!['USDT', 'PERCENTAGE'].includes(amountType)) {
      return {
        success: false,
        message: 'amountType必须是USDT或PERCENTAGE'
      } as ApiResponse
    }

    // 验证金额
    const amountNum = Number(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      return {
        success: false,
        message: 'amount必须是大于0的数字'
      } as ApiResponse
    }

    // 验证杠杆
    const leverageNum = Number(leverage)
    if (isNaN(leverageNum) || leverageNum <= 0) {
      return {
        success: false,
        message: 'leverage必须是大于0的数字'
      } as ApiResponse
    }

    // 密码验证
    const config = useRuntimeConfig()
    const configPassword = config.configEditPassword
    
    if (configPassword && configPassword.length > 0) {
      if (!password) {
        return {
          success: false,
          message: '需要密码验证',
          requiresPassword: true
        } as ApiResponse
      }
      
      if (password !== configPassword) {
        return {
          success: false,
          message: '密码错误',
          requiresPassword: true
        } as ApiResponse
      }
    }

    // 获取FuturesBot实例
    const futuresBotModule = await import('../../modules/futures-bot/index')
    const futuresBot = futuresBotModule.getFuturesBot()
    
    if (!futuresBot) {
      return {
        success: false,
        message: '交易机器人未初始化'
      } as ApiResponse
    }

    // 调用手动开仓方法
    const result = await futuresBot.manualOpenPosition({
      symbol,
      direction,
      orderType,
      price: price ? Number(price) : undefined,
      amountType,
      amount: amountNum,
      leverage: leverageNum
    })

    if (result.success) {
      return {
        success: true,
        message: result.message || '手动开仓成功',
        state: result.state
      } as ApiResponse
    } else {
      return {
        success: false,
        message: result.message || '手动开仓失败'
      } as ApiResponse
    }

  } catch (error: any) {
    logger.error('手动开仓API', '手动开仓失败', error.message)
    return {
      success: false,
      message: error.message || '手动开仓失败'
    } as ApiResponse
  }
})