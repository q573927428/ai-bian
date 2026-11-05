// ==================== 原生图表盘口 SSE ====================
import { createError, createEventStream, getQuery, setResponseHeaders } from 'h3'
import { orderBookHub, OrderBookCapacityError } from '../../../utils/order-book-hub'

/** 只提供公开 USDT 合约深度；慢客户端丢弃旧帧，不累积过期行情写入队列。 */
export default defineEventHandler((event) => {
  const raw = String(getQuery(event).symbol || '').trim().toUpperCase()
  const symbol = raw.replace(/:USDT$/, '').replace('/', '')
  if (!/^[A-Z0-9]{1,30}USDT$/.test(symbol)) throw createError({ statusCode: 400, statusMessage: 'Invalid USDT symbol' })
  setResponseHeaders(event, { 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' })
  const stream = createEventStream(event)
  let writing = false
  let closed = false
  let unsubscribe = () => {}
  try {
    unsubscribe = orderBookHub.subscribe(symbol, (snapshot) => {
      if (writing || closed) return
      writing = true
      void stream.push({ event: 'depth', data: JSON.stringify(snapshot) })
        .catch(() => { closed = true; unsubscribe(); void stream.close() })
        .finally(() => { writing = false })
    })
  } catch (error) {
    if (!(error instanceof OrderBookCapacityError)) throw error
    // EventSource 无法读取 HTTP 错误正文；用具名事件通知客户端主动 close，终止自动重试。
    void stream.push({ event: 'capacity', data: JSON.stringify({ message: error.message }) })
      .catch(() => {})
      .finally(() => { void stream.close() })
  }
  stream.onClosed(() => { closed = true; unsubscribe() })
  return stream.send()
})
