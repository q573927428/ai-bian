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
  
  // 脱敏 aiPrompt.apiKey
  if (cloned.aiPrompt?.apiKey) {
    cloned.aiPrompt.apiKey = maskApiKey(cloned.aiPrompt.apiKey)
  }
  
  // 脱敏 versionHistory 快照中的 apiKey
  if (cloned.versionHistory && Array.isArray(cloned.versionHistory)) {
    for (const version of cloned.versionHistory) {
      if (version.snapshot?.aiPrompt?.apiKey) {
        version.snapshot.aiPrompt.apiKey = maskApiKey(version.snapshot.aiPrompt.apiKey)
      }
    }
  }
  
  return cloned as T
}