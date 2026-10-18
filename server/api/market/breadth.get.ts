// ==================== 已选交易对共享市场广度 API ====================
import { getBotConfig } from '../../utils/storage'
import { getMarketBreadth } from '../../utils/market-breadth'

/** 看板与策略使用同一份聚合快照，不按浏览器重复计算。 */
export default defineEventHandler(async () => getMarketBreadth(await getBotConfig()))
