// ==================== 宏观图表日历时间与横向视区换算 ====================
import type { InjectionKey, Ref } from 'vue'
import type { MacroPeriod } from '../../../types/macro-market'

/** 使用真实时间窗口广播，避免不同交易日历的 K 线索引错位。 */
export interface MacroViewport {
  source: string
  period: MacroPeriod
  from: number
  to: number
}

/** 网格内共享联动开关与各周期最近视区，供延迟加载的图表对齐。 */
export interface MacroViewportChannel {
  enabled: Ref<boolean>
  latest: Map<MacroPeriod, MacroViewport>
  publish: (viewport: MacroViewport) => void
  subscribe: (listener: (viewport: MacroViewport) => void) => () => void
}

export const macroViewportKey: InjectionKey<MacroViewportChannel> = Symbol('macro-viewport')

/** 柱间按实际日期插值；图外留白按周期延伸，不截断到最后一根柱。 */
export function logicalToCalendar(keys: number[], logical: number, step: number): number {
  const last = keys.length - 1
  if (logical <= 0) return keys[0]! + logical * step
  if (logical >= last) return keys[last]! + (logical - last) * step
  const index = Math.floor(logical)
  return keys[index]! + (keys[index + 1]! - keys[index]!) * (logical - index)
}

/** 日期窗口映射到本图索引；休市按相邻交易柱插值，缺失历史保留图外空白。 */
export function calendarToLogical(keys: number[], time: number, step: number): number {
  const last = keys.length - 1
  if (time <= keys[0]!) return (time - keys[0]!) / step
  if (time >= keys[last]!) return last + (time - keys[last]!) / step
  let left = 0
  let right = last
  while (right - left > 1) {
    const mid = Math.floor((left + right) / 2)
    if (keys[mid]! <= time) left = mid
    else right = mid
  }
  return left + (time - keys[left]!) / (keys[right]! - keys[left]!)
}
