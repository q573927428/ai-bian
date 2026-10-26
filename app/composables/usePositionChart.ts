// ==================== 当前持仓图表联动状态 ====================
import type { Position } from '../../types'

/** 在持仓面板和图表间共享选中仓位，避免复制价格和风险参数。 */
export function usePositionChart() {
  return useState<Position | null>('selected-position-chart', () => null)
}
