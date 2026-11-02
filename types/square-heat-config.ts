// ==================== 指标看板社区情绪统计窗口配置 ====================
export const SQUARE_HEAT_TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'] as const
// 前后端共享窗口边界，避免界面允许长窗口但后台静默截断为24小时。
export const SQUARE_HEAT_MAX_WINDOW_MINUTES = 10000
export type SquareHeatTimeframe = typeof SQUARE_HEAT_TIMEFRAMES[number]
/** 各 K 线周期对应的帖子回看分钟数，仅用于指标看板，不覆盖策略持仓窗口。 */
export type SquareHeatWindows = Record<SquareHeatTimeframe, number>

/** 旧配置保持 24 小时；各周期独立校验为 5～10000 分钟的整数。 */
export function normalizeSquareHeatWindows(input?: Partial<SquareHeatWindows> | null): SquareHeatWindows {
  return Object.fromEntries(SQUARE_HEAT_TIMEFRAMES.map(timeframe => {
    const value = input?.[timeframe]
    return [timeframe, typeof value === 'number' && Number.isFinite(value)
      ? Math.max(5, Math.min(SQUARE_HEAT_MAX_WINDOW_MINUTES, Math.floor(value))) : 1440]
  })) as SquareHeatWindows
}
