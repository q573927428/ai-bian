// ==================== 页面与组件的全局轮询订阅 ====================
import { onMounted, onBeforeUnmount, useId, watch, type WatchStopHandle } from 'vue'
import { useBotStore } from '../stores/bot'

/** 复用全局 60 秒节拍；首屏由调用方加载，隐藏和卸载时取消订阅，慢请求不重入。 */
export function useGlobalPolling(refresh: () => void | Promise<unknown>, enabled: () => boolean = () => true) {
  const store = useBotStore()
  const subscriberId = `global-polling-${useId()}`
  let active = false
  let pending = false
  let stopWatching: WatchStopHandle | undefined

  /** 等待当前刷新结束后才允许下一轮，避免慢接口堆积请求。 */
  async function run() {
    if (!active || !enabled() || pending) return
    pending = true
    try { await refresh() }
    catch (error) { console.error('[Polling] 自动刷新失败:', error) }
    finally { pending = false }
  }

  onMounted(() => {
    stopWatching = watch(enabled, value => {
      active = value
      if (value) store.subscribeToPolling(subscriberId, run)
      else store.unsubscribeFromPolling(subscriberId)
    }, { immediate: true })
  })
  onBeforeUnmount(() => {
    active = false
    stopWatching?.()
    store.unsubscribeFromPolling(subscriberId)
  })
}
