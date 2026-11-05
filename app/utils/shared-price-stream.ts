// ==================== 浏览器共享价格连接适配 ====================

/** 与 Store 使用的 EventSource 事件接口兼容，底层可由 SharedWorker 跨标签页复用。 */
export type PriceStream = Pick<EventSource, 'onopen' | 'onerror' | 'addEventListener' | 'close'>

/** 优先共享价格 SSE；不支持 SharedWorker 或加载失败时退回页面独立连接。 */
export function createPriceStream(): PriceStream {
  if (typeof SharedWorker === 'undefined') return new EventSource('/api/market/prices/stream')
  let worker: SharedWorker
  try { worker = new SharedWorker('/workers/market-prices.js', { name: 'market-prices-v1' }) }
  catch { return new EventSource('/api/market/prices/stream') }
  const events = new EventTarget()
  let closed = false
  let fallback: EventSource | null = null
  let heartbeat: ReturnType<typeof setInterval>
  const bridge: PriceStream = {
    onopen: null,
    onerror: null,
    // 具名行情事件均由下方 dispatch 构造为 MessageEvent，与 EventSource 的事件签名一致。
    addEventListener: events.addEventListener.bind(events) as PriceStream['addEventListener'],
    close() {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      window.removeEventListener('pagehide', closeForPageHide)
      worker.port.postMessage('close')
      worker.port.close()
      fallback?.close()
    }
  }
  /** 真正离开页面时释放端口；浏览器回退缓存保留的页面由心跳恢复订阅。 */
  function closeForPageHide(event: PageTransitionEvent) {
    if (!event.persisted) bridge.close()
  }
  function dispatch(type: string, data?: string) {
    if (closed) return
    if (type === 'open') bridge.onopen?.call(bridge as EventSource, new Event('open'))
    else if (type === 'error') bridge.onerror?.call(bridge as EventSource, new Event('error'))
    else events.dispatchEvent(new MessageEvent(type, { data }))
  }
  worker.port.onmessage = event => dispatch(event.data.type, event.data.data)
  worker.port.start()
  worker.port.postMessage('connect')
  heartbeat = setInterval(() => {
    if (!closed && !fallback) worker.port.postMessage('connect')
  }, 20000)
  worker.onerror = () => {
    if (closed || fallback) return
    worker.port.close()
    clearInterval(heartbeat)
    fallback = new EventSource('/api/market/prices/stream')
    fallback.onopen = () => dispatch('open')
    fallback.onerror = () => dispatch('error')
    for (const type of ['snapshot', 'prices', 'status', 'ping']) {
      fallback.addEventListener(type, event => dispatch(type, (event as MessageEvent).data))
    }
  }
  window.addEventListener('pagehide', closeForPageHide)
  return bridge
}
