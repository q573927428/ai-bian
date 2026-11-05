// ==================== 盘口服务生命周期 ====================
import { orderBookHub } from '../utils/order-book-hub'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => { orderBookHub.close() })
})
