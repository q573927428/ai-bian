// ==================== 支撑阻力区域缓存与轻量价格更新 ====================
import type { SupportResistanceSnapshot } from '../../../types/support-resistance'
import { updateSupportResistancePrice } from './SupportResistanceCalculator.ts'

/** 共享区域缓存：预计算定时刷新，首次访问或五分钟过期时兜底构建一次。 */
export class SupportResistanceCache {
  private regions = new Map<string, SupportResistanceSnapshot>()

  /** force 仅供统一预计算任务使用，普通读取不会因价格变化重新识别区域。 */
  get(
    key: string, price: number | null, now: number,
    build: () => SupportResistanceSnapshot, force = false
  ): SupportResistanceSnapshot {
    let regions = this.regions.get(key)
    if (force || !regions || now - regions.calculatedAt >= 300_000) {
      regions = build()
      this.regions.set(key, regions)
    }
    return updateSupportResistancePrice(regions, price, now)
  }
}
