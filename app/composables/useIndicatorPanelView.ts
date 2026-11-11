// ==================== 指标页右侧视图偏好 ====================
import { onMounted, ref, watch } from 'vue'

export type IndicatorPanelView = 'chart' | 'environment'
export const INDICATOR_PANEL_VIEW_KEY = 'indicator-panel-view'

/** 挂载后恢复上次视图；存储不可用或值非法时使用图表，偏好不包含行情数据。 */
export function useIndicatorPanelView() {
  const view = ref<IndicatorPanelView>('chart')
  let restored = false
  onMounted(() => {
    try {
      const saved = localStorage.getItem(INDICATOR_PANEL_VIEW_KEY)
      if (saved === 'chart' || saved === 'environment') view.value = saved
    } catch {
      // 浏览器禁用存储时仍允许本次页面切换。
    }
    restored = true
  })
  watch(view, value => {
    if (!restored) return
    try { localStorage.setItem(INDICATOR_PANEL_VIEW_KEY, value) } catch {
      // 偏好保存失败不影响指标查看。
    }
  })
  return view
}
