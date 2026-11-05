<!-- ==================== 看板及交易记录共用支撑阻力展示 ==================== -->
<template>
  <div v-if="compact && snapshot" class="structure-info-compact">
    <span class="resistance">阻力 {{ zone(snapshot.nearestResistance) }}<template v-if="snapshot.nearestResistance"> · {{ number(snapshot.resistanceDistancePercent) }}% / {{ number(snapshot.resistanceDistanceATR) }} ATR</template></span>
    <span class="support">支撑 {{ zone(snapshot.nearestSupport) }}<template v-if="snapshot.nearestSupport"> · {{ number(snapshot.supportDistancePercent) }}% / {{ number(snapshot.supportDistanceATR) }} ATR</template></span>
  </div>
  <div v-else-if="snapshot" class="structure-info" :class="{ 'structure-info-detailed': detailed }">
      <div class="structure-levels" :title="structureTitle">
        <div class="level-group">
        <div><span class="resistance">阻力</span> {{ nearestOnly ? nearestPrice(snapshot.nearestResistance) : zone(snapshot.nearestResistance) }}{{ !nearestOnly && snapshot.nearestResistance ? `（${snapshot.nearestResistance.touches}）` : '' }}<span v-if="nearestOnly && snapshot.nearestResistance" class="distance">{{ number(snapshot.resistanceDistanceATR) }}</span></div>
        </div>
        <div class="level-group">
        <div><span class="support">支撑</span> {{ nearestOnly ? nearestPrice(snapshot.nearestSupport) : zone(snapshot.nearestSupport) }}{{ !nearestOnly && snapshot.nearestSupport ? `（${snapshot.nearestSupport.touches}）` : '' }}<span v-if="nearestOnly && snapshot.nearestSupport" class="distance">{{ number(snapshot.supportDistanceATR) }}</span></div>
        </div>
      </div>
    <!-- 状态始终放在价位下方，区域之间等常态也能直接查看。 -->
    <div class="structure-status">{{ statusLabel }}</div>
    <div v-if="detailed" class="distance">
      {{ snapshot.timeframe }} · 决策参考价 {{ price(snapshot.referencePrice) }}
    </div>
  </div>
  <span v-else class="distance">{{ historical ? '暂无入场支撑阻力快照' : '暂无结构数据' }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EntrySupportResistance, PriceZone, SupportResistanceSnapshot } from '../../types/support-resistance'

/** 同一组件兼容实时看板和冻结的历史快照，旧订单缺失时展示空状态。 */
interface Props {
  snapshot?: SupportResistanceSnapshot | EntrySupportResistance | null
  detailed?: boolean
  /** 指标看板仅显示距参考价最近的区域边界及 ATR 距离。 */
  nearestOnly?: boolean
  /** 图表内紧凑显示价位、百分比距离及 ATR 距离倍数。 */
  compact?: boolean
  historical?: boolean
}
const props = defineProps<Props>()
const labels: Record<SupportResistanceSnapshot['status'], string> = {
  insufficient_data: '数据不足', no_levels: '未识别到有效区域', between_levels: '区域之间',
  at_support: '位于支撑区', at_resistance: '位于阻力区',
  breakdown_pending: '盘中跌破待确认', breakout_pending: '盘中突破待确认',
  breakdown_confirmed: '最新收盘确认跌破', breakout_confirmed: '最新收盘确认突破'
}
const statusLabel = computed(() => props.snapshot ? labels[props.snapshot.status] : '暂无结构数据')
const number = (value: number | null) => value == null ? '--' : value.toFixed(2)
// 小币价保留有效数字，避免固定小数位将区域两端都显示为0。
const price = (value: number | null) => value == null ? '--' : Number(value.toPrecision(7)).toString()
const zone = (value: Pick<PriceZone, 'lower' | 'upper'> | null) => value ? `${price(value.lower)}～${price(value.upper)}` : '未识别'
/** 取离当前参考价格最近的边界，区域内价格也使用同一比较规则。 */
function nearestPrice(value: Pick<PriceZone, 'lower' | 'upper'> | null) {
  if (!value) return '未识别'
  const reference = props.snapshot?.referencePrice
  if (reference == null) return '--'
  return price(Math.abs(reference - value.lower) <= Math.abs(reference - value.upper) ? value.lower : value.upper)
}
const time = (value: number | null) => value == null ? '--' : new Date(value).toLocaleString('zh-CN', { hour12: false })

/** 原生 title 使用换行拼接，保留实时结构与历史快照各自的提示内容。 */
const structureTitle = computed(() => {
  const snapshot = props.snapshot
  if (!snapshot) return ''
  const lines = [
    ...('algorithm' in snapshot ? [`${snapshot.timeframe} · ${snapshot.closedCandles} 根已收盘K线`] : []),
    `参考价 ${price(snapshot.referencePrice)}`,
    // 看板不再常驻展示触碰次数，保留在价位区域的悬停详情中。
    `阻力触碰次数 ${snapshot.nearestResistance?.touches ?? '--'}`,
    `支撑触碰次数 ${snapshot.nearestSupport?.touches ?? '--'}`,
    `阻力距离 ${number(snapshot.resistanceDistancePercent)}% / ${number(snapshot.resistanceDistanceATR)} ATR`,
    `支撑距离 ${number(snapshot.supportDistancePercent)}% / ${number(snapshot.supportDistanceATR)} ATR`
  ]
  if ('algorithm' in snapshot) {
    lines.push(`ATR ${price(snapshot.atr)}`, `区域更新 ${time(snapshot.calculatedAt)}`,
      `价格更新 ${time(snapshot.priceUpdatedAt ?? snapshot.calculatedAt)}`)
    if (snapshot.brokenSupport) lines.push(`新近跌破 ${zone(snapshot.brokenSupport)}`)
    if (snapshot.brokenResistance) lines.push(`新近突破 ${zone(snapshot.brokenResistance)}`)
  }
  return lines.join('\n')
})
</script>

<style scoped>
.structure-info { line-height: 1.55; }
.structure-info-compact { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 11px; line-height: 1.5; }
.support { color: #67c23a; }
.resistance { color: #f56c6c; }
.distance { color: var(--el-text-color-secondary); font-size: 12px; }
.structure-levels .distance { margin-left: 6px; }
/* 历史快照利用详情区域横向展示，避免多行信息挤在左侧；看板继续使用紧凑纵排。 */
.structure-info-detailed {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.structure-info-detailed .structure-levels {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 24px;
}
.structure-info-detailed .level-group {
  padding: 8px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: var(--el-fill-color-light);
  overflow-wrap: anywhere;
}
.structure-info-detailed .structure-status {
  color: var(--el-text-color-regular);
}
</style>
