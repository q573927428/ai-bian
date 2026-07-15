/**
 * K线同步服务实例存储
 * 用于避免插件与其他模块之间的循环依赖
 */

import type { KLineSimpleSyncService } from '../modules/kline-simple-sync'

let syncServiceInstance: KLineSimpleSyncService | null = null
let syncReadyPromise: Promise<void> = Promise.resolve()
let autoSyncStarted = false

export function setSyncService(service: KLineSimpleSyncService | null): void {
  syncServiceInstance = service
  if (!service) {
    syncReadyPromise = Promise.resolve()
    autoSyncStarted = false
  }
}

export function getSyncService(): KLineSimpleSyncService | null {
  return syncServiceInstance
}

export function setSyncReadyPromise(promise: Promise<void>): void {
  syncReadyPromise = promise
}

export async function waitForSyncReady(): Promise<void> {
  await syncReadyPromise
}

export function startKLineAutoSync(): void {
  if (!syncServiceInstance || autoSyncStarted) return
  console.log('⏰ 启动K线定时同步...')
  syncServiceInstance.startAutoSync()
  autoSyncStarted = true
  console.log('🎯 K线同步服务已完全启动')
}
