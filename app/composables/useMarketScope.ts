// ==================== 价格与指标看板共享市场范围 ====================
import { computed, onMounted, watch, type ComputedRef, type Ref } from 'vue'
import type { MarketBreadthSnapshot } from '../../types/market-breadth'
import { filterBreadthSymbols, type BreadthScope } from '../utils/market-breadth'

/** 两页共享分类偏好；分类仅改变观察范围，不改变配置、订阅或 AI 快照。 */
export function useMarketScope(symbols: ComputedRef<string[]>, snapshot: Ref<MarketBreadthSnapshot | null>) {
  const marketScope = useState<BreadthScope>('market-board-scope', () => 'all')
  const restored = useState('market-board-scope-restored', () => false)
  const storageKey = 'market-board-scope'

  onMounted(() => {
    if (restored.value) return
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved === 'all' || saved === 'crypto' || saved === 'tradfi') marketScope.value = saved
    } catch {
      // 本地存储受限时仍可正常使用本次会话的分类选择。
    }
    restored.value = true
  })
  watch(marketScope, value => {
    if (!import.meta.client || !restored.value) return
    try {
      localStorage.setItem(storageKey, value)
    } catch {
      // 偏好保存失败不阻断页面筛选。
    }
  })

  const scopeSymbols = computed(() => filterBreadthSymbols(symbols.value, snapshot.value?.assetCategories, marketScope.value))
  const scopeSymbolSet = computed(() => new Set(scopeSymbols.value))
  const scopeLabel = computed(() => ({ all: '全部资产', crypto: '加密资产', tradfi: '传统金融资产' })[marketScope.value])
  const unknownCount = computed(() => symbols.value.filter(symbol => {
    const category = snapshot.value?.assetCategories?.[symbol]
    return !category || category === 'unknown'
  }).length)

  return { marketScope, scopeSymbols, scopeSymbolSet, scopeLabel, unknownCount }
}
