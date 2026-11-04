// ==================== 支撑阻力看板试算参数 ====================
import { useState } from '#app'
import { watch } from 'vue'
import { useBotStore } from '../stores/bot'
import { normalizeSupportResistanceConfig } from '../../types/support-resistance'

/** 看板与实时图表共享试算参数，仅在本次应用会话内保留，不写入交易策略。 */
export function useSupportResistancePreview() {
  const store = useBotStore()
  const preview = useState('support-resistance-preview', () => normalizeSupportResistanceConfig(store.botConfig?.supportResistanceConfig))
  // 分别比较参数值，避免每次配置轮询替换对象时重置试算并重复刷新列表、图表。
  watch([
    () => store.botConfig?.supportResistanceConfig?.pivotLeft,
    () => store.botConfig?.supportResistanceConfig?.pivotRight
  ], () => {
    preview.value = normalizeSupportResistanceConfig(store.botConfig?.supportResistanceConfig)
  })
  return preview
}
