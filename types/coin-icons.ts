// ==================== 币安官方图标清单类型定义 ====================
//
// 对应 scripts/sync-binance-coin-icons.mjs 产出的
// public/assets/binance-coin-icons.json 结构。

/**
 * 单个基础资产的图标与合约信息。
 * 由 binance-coin-icons.json 的 assets 键值对映射而来，键为 baseAsset（如 "BTC"）。
 */
export interface CoinIconAsset {
  /** 主合约的 symbol（如 "BTCUSDT"），用于跳转币安交易页 */
  symbol: string
  /** 该基础资产关联的全部合约 symbol 列表 */
  symbols: string[]
  /** 合约类型：PERPETUAL / TRADIFI_PERPETUAL */
  contractType: string
  /** 标的类型，如 COIN / MULTI_ASSET / INDEX 等 */
  underlyingType: string | null
  /** 计价资产，如 USDT / USDC */
  quoteAsset: string | null
  /** Binance 官方远程图标地址（https://bin.bnbstatic.com 或 public.bnbstatic.com） */
  iconUrl: string | null
  /** 本地图标地址（/assets/crypto-icons/BTC.png），未下载时为 null */
  localUrl: string | null
  /** 图标来源：binance=官方当次匹配 / retained=沿用旧清单 */
  source: 'binance' | 'retained' | null
}

/**
 * 币安合约图标清单整体结构。
 */
export interface CoinIconsManifest {
  /** 清单版本号 */
  version: number
  /** 同步时间（ISO 8601） */
  updatedAt: string
  /** 数据来源接口 */
  source: {
    contracts: string
    logos: string
  }
  /** 币安交易页模板，{symbol} 为占位符 */
  pageTemplate: string
  /** 基础资产总数 */
  assetCount: number
  /** 已解析图标数量（官方 + 保留旧值） */
  resolvedCount: number
  /** 官方当次匹配数量 */
  officialCount: number
  /** 沿用旧清单数量 */
  retainedCount: number
  /** 官方未提供 Logo 的数量 */
  unresolvedCount: number
  /** 官方未提供 Logo 的资产列表 */
  unresolved: { baseAsset: string; symbol: string }[]
  /** 资产映射，键为 baseAsset（大写） */
  assets: Record<string, CoinIconAsset>
}