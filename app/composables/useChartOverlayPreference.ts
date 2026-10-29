// ==================== 图表覆盖层开关本地偏好 ====================
import { onMounted, ref, watch } from 'vue'

/** 挂载后恢复开关；存储受限或内容无效时保留默认值。 */
export function useChartOverlayPreference(key: string, defaultValue: boolean) {
  const enabled = ref(defaultValue)
  let restored = false

  onMounted(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved === 'true' || saved === 'false') enabled.value = saved === 'true'
    } catch {
      // 浏览器禁用本地存储时，仍允许本次页面正常切换。
    }
    restored = true
  })

  watch(enabled, (value) => {
    if (!restored) return
    try {
      localStorage.setItem(key, String(value))
    } catch {
      // 写入失败不阻断图表交互。
    }
  }, { flush: 'sync' })

  return enabled
}
