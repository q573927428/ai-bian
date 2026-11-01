// ==================== 支撑阻力看板试算参数 ====================
import { useState } from '#app'

/** 看板与实时图表共享试算参数，仅在本次应用会话内保留，不写入交易策略。 */
export function useSupportResistancePreview() {
  return useState('support-resistance-preview', () => ({ pivotLeft: 3, pivotRight: 3 }))
}
