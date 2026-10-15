// ==================== 永续合约类型查询 ====================

import { getBinanceExchangeInfo } from '../../utils/binance-exchange-info'

/**
 * 使用与热门榜单相同的官方合约类型，覆盖榜单之外的交易对。
 * 统一复用持久化元数据，接口本身不再维护另一份独立有效期。
 */
export default defineEventHandler(async () => {
  const exchangeInfo = await getBinanceExchangeInfo()

  return {
    contractTypes: Object.fromEntries(
      exchangeInfo.symbols.map(symbol => [symbol.symbol, symbol.contractType])
    ) as Record<string, string>
  }
})
