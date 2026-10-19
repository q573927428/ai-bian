// ==================== AI 建连故障重试 ====================

import { setTimeout as delay } from 'node:timers/promises'

/** 仅识别请求发送前的建连故障，避免重复提交已被服务端处理的生成请求。 */
function isConnectionFailure(error: any, depth = 0): boolean {
  if (!error || depth > 4) return false
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    return error.errors.every((item: unknown) => isConnectionFailure(item, depth + 1))
  }
  if (error.cause) return isConnectionFailure(error.cause, depth + 1)
  return ['UND_ERR_CONNECT_TIMEOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'EAI_AGAIN'].includes(error.code)
    || (error.code === 'ETIMEDOUT' && error.syscall === 'connect')
}

/** 建连失败最多重试两次；退避等待和所有尝试共用调用方的超时信号。 */
export async function fetchAIWithConnectionRetry(
  url: string,
  init: RequestInit & { signal: AbortSignal },
  onRetry: (attempt: number, delayMs: number) => void
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    init.signal.throwIfAborted()
    try {
      return await fetch(url, init)
    } catch (error) {
      if (init.signal.aborted || attempt >= 2 || !isConnectionFailure(error)) throw error
      // 短暂退避并添加抖动，避免多个策略同时重连造成瞬时洪峰。
      const delayMs = 500 * (2 ** attempt) + Math.floor(Math.random() * 250)
      onRetry(attempt + 1, delayMs)
      await delay(delayMs, undefined, { signal: init.signal })
    }
  }
}
