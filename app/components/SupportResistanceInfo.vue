<!-- ==================== 看板及交易记录共用支撑阻力展示 ==================== -->
<template>
  <div v-if="snapshot" class="structure-info">
    <el-tooltip placement="top">
      <template #content>
        <template v-if="'algorithm' in snapshot">
          <div>{{ snapshot.timeframe }} · {{ snapshot.closedCandles }} 根已收盘K线</div>
        </template>
        <div>触碰：支撑 {{ snapshot.nearestSupport?.touches ?? '--' }} 次 / 阻力 {{ snapshot.nearestResistance?.touches ?? '--' }} 次</div>
        <div>参考价 {{ price(snapshot.referencePrice) }}</div>
        <template v-if="'algorithm' in snapshot">
        <div>ATR {{ price(snapshot.atr) }}</div>
        <div>区域更新 {{ time(snapshot.calculatedAt) }}</div>
        <div>价格更新 {{ time(snapshot.priceUpdatedAt ?? snapshot.calculatedAt) }}</div>
        <div v-if="snapshot.brokenSupport">新近跌破 {{ zone(snapshot.brokenSupport) }}</div>
        <div v-if="snapshot.brokenResistance">新近突破 {{ zone(snapshot.brokenResistance) }}</div>
        </template>
        <div>未识别不代表无支撑阻力。</div>
      </template>
      <div>
        <div class="support">支撑 {{ zone(snapshot.nearestSupport) }}{{ snapshot.nearestSupport ? `（${snapshot.nearestSupport.touches}）` : '' }}</div>
        <div class="distance">距离 {{ number(snapshot.supportDistancePercent) }}% / {{ number(snapshot.supportDistanceATR) }} ATR</div>
        <div class="resistance">阻力 {{ zone(snapshot.nearestResistance) }}{{ snapshot.nearestResistance ? `（${snapshot.nearestResistance.touches}）` : '' }}</div>
        <div class="distance">距离 {{ number(snapshot.resistanceDistancePercent) }}% / {{ number(snapshot.resistanceDistanceATR) }} ATR</div>
        <div>{{ statusLabel }}</div>
      </div>
    </el-tooltip>
    <div v-if="detailed" class="distance">
      {{ snapshot.timeframe }} · 决策参考价 {{ price(snapshot.referencePrice) }}
    </div>
  </div>
  <span v-else class="distance">暂无结构数据</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EntrySupportResistance, PriceZone, SupportResistanceSnapshot } from '../../types/support-resistance'

/** 同一组件兼容实时看板和冻结的历史快照，旧订单缺失时展示空状态。 */
interface Props {
  snapshot?: SupportResistanceSnapshot | EntrySupportResistance | null
  detailed?: boolean
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
const time = (value: number | null) => value == null ? '--' : new Date(value).toLocaleString('zh-CN', { hour12: false })
</script>

<style scoped>
.structure-info { line-height: 1.55; }
.support { color: #67c23a; }
.resistance { color: #f56c6c; }
.distance { color: var(--el-text-color-secondary); font-size: 12px; }
</style>
