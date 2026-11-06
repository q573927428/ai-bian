// ==================== 策略数据脱敏工具 ====================
// 在返回前端前，对敏感字段进行脱敏处理

import { maskApiKey } from './crypto'
import type { Strategy } from '../../types/strategy'

/**
 * 深度拷贝并脱敏策略对象的敏感字段
 * - apiKey: 只保留前4后4，中间脱敏
 * - 不影响原始对象
 */
export function maskStrategyData<T extends Strategy | null>(strategy: T): T {
  if (!strategy) return strategy
  
  // 深拷贝避免污染原始对象
  const cloned = JSON.parse(JSON.stringify(strategy))
  
  // 回滚可能产生嵌套历史；遍历全部对象，避免只处理一层快照而泄露密钥。
  const pending: any[] = [cloned]
  while (pending.length) {
    const node = pending.pop()
    if (!node || typeof node !== 'object') continue
    for (const [key, value] of Object.entries(node)) {
      if (/^(?:apiKey|apiSecret|secret|password|token|authorization)$/i.test(key) && typeof value === 'string') {
        node[key] = maskApiKey(value)
      } else if (value && typeof value === 'object') pending.push(value)
    }
  }
  
  return cloned as T
}
