// ==================== 实时价格 SSE 接口 ====================

import { createEventStream, setResponseHeaders } from 'h3'
import {
  marketPriceHub,
  type MarketPriceClient,
  type MarketPriceEventName,
  type MarketPriceEventPayload
} from '../../../utils/market-price-hub'

const HEARTBEAT_INTERVAL_MS = 20_000

/**
 * 建立浏览器实时价格流
 *
 * 每个浏览器标签页只建立一条连接，首次发送快照，随后发送批量价格增量。
 */
export default defineEventHandler(async (event) => {
  await marketPriceHub.initialize()

  setResponseHeaders(event, {
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive'
  })

  const eventStream = createEventStream(event)
  let sendQueue = Promise.resolve()

  const client: MarketPriceClient = {
    send(eventName: MarketPriceEventName, payload: MarketPriceEventPayload): Promise<void> {
      // 同一连接内严格串行写入，防止首次快照被较新的价格增量反向覆盖。
      sendQueue = sendQueue.then(() => eventStream.push({
        event: eventName,
        data: JSON.stringify(payload)
      }))
      return sendQueue
    }
  }

  const unregister = marketPriceHub.registerClient(client)
  const heartbeatTimer = setInterval(() => {
    void client.send('ping', { timestamp: Date.now() })
  }, HEARTBEAT_INTERVAL_MS)

  eventStream.onClosed(() => {
    clearInterval(heartbeatTimer)
    unregister()
  })

  return eventStream.send()
})
