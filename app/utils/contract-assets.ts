// ==================== 热门行情合约资产分类 ====================

export const CONTRACT_ASSET_LABELS = {
  crypto: '加密', equity: '美股', hk_equity: '港股',
  kr_equity: '韩股', cn_equity: '中股', commodity: '商品',
  fx: '外汇', premarket: 'IPO', index: '指数', tradfi: '其他', unknown: '未知',
} as const

export type ContractAssetCategory = keyof typeof CONTRACT_ASSET_LABELS

/** 分类所需的官方元数据；不使用交易对名称推断股票或 ETF。 */
interface ContractAssetMetadata {
  symbol: string
  contractType?: string
  underlyingType?: unknown
  underlyingSubType?: unknown
}

/** 优先使用标的类型；缺少元数据的旧缓存保留在未分类中，等待行情刷新。 */
export function classifyContractAsset(row: ContractAssetMetadata): ContractAssetCategory {
  const type = typeof row.underlyingType === 'string' ? row.underlyingType.toUpperCase() : ''
  const subtypes = Array.isArray(row.underlyingSubType)
    ? row.underlyingSubType.filter((value): value is string => typeof value === 'string').map(value => value.toUpperCase()) : []
  switch (type) {
    case 'EQUITY': return 'equity'
    case 'HK_EQUITY': return 'hk_equity'
    case 'KR_EQUITY': return 'kr_equity'
    case 'CN_EQUITY': return 'cn_equity'
    case 'COMMODITY': return 'commodity'
    case 'FX': return 'fx'
    case 'PREMARKET': return 'premarket'
    case 'INDEX':
      // 指数也可能跟踪加密资产，明确 Crypto 标签及已知加密指数优先。
      return subtypes.includes('CRYPTO') || ['DEFIUSDT', 'BTCDOMUSDT'].includes(row.symbol) ? 'crypto' : 'index'
  }
  if (row.contractType === 'TRADIFI_PERPETUAL' || subtypes.includes('TRADFI')) return 'tradfi'
  if (type === 'COIN' || subtypes.includes('CRYPTO')) return 'crypto'
  return 'unknown'
}

/** 表格、详情和热力图共用同一分类名称。 */
export function contractAssetLabel(row: ContractAssetMetadata): string {
  return CONTRACT_ASSET_LABELS[classifyContractAsset(row)]
}
