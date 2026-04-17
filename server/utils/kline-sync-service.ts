/**
 * K线同步服务实例存储
 * 用于避免插件与其他模块之间的循环依赖
 */

import type { KLineSimpleSyncService } from '../modules/kline-simple-sync'

let syncServiceInstance: KLineSimpleSyncService | null = null

export function setSyncService(service: KLineSimpleSyncService | null): void {
  syncServiceInstance = service
}

export function getSyncService(): KLineSimpleSyncService | null {
  return syncServiceInstance
}