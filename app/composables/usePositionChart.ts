// ==================== 当前持仓图表联动状态 ====================
import type { Position } from '../../types'
import { computed } from 'vue'

/** 图表使用的持仓快照，包含仓位所属策略标识。 */
export type ChartPosition = Pick<Position, 'symbol' | 'entryPrice' | 'openTime'> & Partial<Pick<Position, 'stopLoss' | 'initialStopLoss' | 'takeProfit1' | 'takeProfit2'>> & { strategyId?: string }

/** 复用当前持仓面板的轮询结果，所有图表均可按交易对自动匹配。 */
export function useChartPositions() {
  return useState<ChartPosition[]>('chart-active-positions', () => [])
}

/** 根据图表当前交易对响应式查找持仓，切换交易对或平仓后自动更新。 */
export function useChartPosition(symbol: () => string | undefined) {
  const positions = useChartPositions()
  return computed(() => {
    const normalized = symbol()?.replace('/', '').toUpperCase()
    return positions.value.find(position => position.symbol.replace('/', '').toUpperCase() === normalized) ?? null
  })
}

/** 在持仓面板和图表间共享选中仓位，避免复制价格和风险参数。 */
export function usePositionChart() {
  return useState<Position | null>('selected-position-chart', () => null)
}
