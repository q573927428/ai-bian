// ==================== 跨标签页共享实时价格 SSE ====================
const clients = new Map()
let source = null
let prices = {}
let status = null
let connected = false
let lastPriceAt = 0

/** 将上游事件转发到各页面，单个已关闭端口不能中断其他页面。 */
function send(port, message) {
  try { port.postMessage(message) } catch { clients.delete(port) }
}

/** 全部标签页共用一条同域 SSE，给 HTTP/1.1 普通请求留出连接名额。 */
function start() {
  if (source) return
  source = new EventSource('/api/market/prices/stream')
  source.onopen = () => {
    connected = true
    for (const port of clients.keys()) send(port, { type: 'open' })
  }
  source.onerror = () => {
    connected = false
    for (const port of clients.keys()) send(port, { type: 'error' })
  }
  for (const type of ['snapshot', 'prices', 'status', 'ping']) {
    source.addEventListener(type, event => {
      try {
        const payload = JSON.parse(event.data)
        if (type === 'snapshot') prices = payload.prices || {}
        if (type === 'prices') Object.assign(prices, payload.prices || {})
        if (type === 'snapshot' || type === 'prices') lastPriceAt = Date.now()
        if (type === 'status') status = event.data
      } catch { return }
      for (const port of clients.keys()) send(port, { type, data: event.data })
    })
  }
}

/** 最后一个页面退出后释放连接；心跳清理浏览器异常关闭留下的端口。 */
function cleanup() {
  const now = Date.now()
  for (const [port, lastSeen] of clients) {
    // 休眠标签页可能暂停心跳；保留端口供恢复后的 connect 重新注册。
    if (now - lastSeen > 90000) clients.delete(port)
  }
  if (clients.size || !source) return
  source.close()
  source = null
  prices = {}
  status = null
  connected = false
}

self.onconnect = event => {
  const port = event.ports[0]
  port.onmessage = message => {
    if (message.data === 'close') { clients.delete(port); port.close(); cleanup(); return }
    if (message.data === 'heartbeat') {
      // 已退出的页面如从休眠恢复，通过 connect 重新注册，不能仅靠心跳复活。
      if (clients.has(port)) clients.set(port, Date.now())
      return
    }
    if (message.data !== 'connect') return
    const existing = clients.has(port)
    clients.set(port, Date.now())
    start()
    if (existing) return
    if (connected) send(port, { type: 'open' })
    if (connected && Date.now() - lastPriceAt < 10000 && Object.keys(prices).length) {
      send(port, { type: 'snapshot', data: JSON.stringify({ timestamp: lastPriceAt, prices }) })
    }
    if (status) send(port, { type: 'status', data: status })
  }
  port.start()
}
setInterval(cleanup, 30000)
