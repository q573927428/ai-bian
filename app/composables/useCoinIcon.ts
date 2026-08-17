// ==================== 币安合约图标获取（官方清单驱动） ====================
//
// 唯一图标数据源：/assets/binance-coin-icons.json
// （由 scripts/sync-binance-coin-icons.mjs 生成，与币安 futures 页面图标完全一致）
// 解析顺序：本地已下载(localUrl) → 币安官方远程(iconUrl) → null
// 不提供任何本地拼接兜底：图标完全由官方清单决定，缺失时由组件展示占位符。

import type { CoinIconsManifest } from '../../types/coin-icons'

// 模块级缓存，避免重复请求；ref 保证清单异步加载完成后模板自动更新
let manifest = ref<CoinIconsManifest | null>(null)
let loaded = false
const loadState = ref<'idle' | 'loading' | 'ready'>('idle')

/** 从合约 symbol 中提取基础资产（如 "BTCUSDT" -> "BTC"、"1000PEPEUSDT" -> "1000PEPE"）。 */
function extractBaseAsset(symbol: string): string {
  return symbol.replace(/(USDT|USDC|FDUSD|BUSD)$/, '').toUpperCase()
}

/**
 * 静默加载官方图标清单。
 * 失败时保持 null，不影响页面其余功能；幂等，重复调用不会再次请求。
 */
async function loadManifest(): Promise<void> {
  if (loaded || import.meta.server) return
  loaded = true
  loadState.value = 'loading'
  try {
    manifest.value = await $fetch<CoinIconsManifest>('/assets/binance-coin-icons.json')
  } catch {
    manifest.value = null
  } finally {
    loadState.value = 'ready'
  }
}

/**
 * 根据合约 symbol 返回图标 URL。
 * @returns 本地地址 / 官方远程地址；清单缺失该资产时返回 null（组件显示占位符）
 */
function getCoinIconUrl(symbol: string): string | null {
  if (!manifest.value) return null
  const asset = manifest.value.assets[extractBaseAsset(symbol)]
  if (!asset) return null
  return asset.localUrl || asset.iconUrl
}

/**
 * 使用币安官方图标清单。
 * 返回 loadState（响应式，可用于控制渲染等待）与 getCoinIconUrl 查询函数。
 */
export function useCoinIcon() {
  // 客户端触发加载（幂等）
  if (import.meta.client) {
    void loadManifest()
  }

  return {
    loadState,
    getCoinIconUrl,
  }
}