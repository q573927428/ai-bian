<!-- ==================== 看板及交易记录共用支撑阻力展示 ==================== -->
<template>
  <div v-if="compact && snapshot" class="structure-info-compact">
    <span class="support">支撑 {{ zone(snapshot.nearestSupport) }}<template v-if="snapshot.nearestSupport"> · {{ number(snapshot.supportDistancePercent) }}% / {{ number(snapshot.supportDistanceATR) }} ATR</template></span>
    <span class="resistance">阻力 {{ zone(snapshot.nearestResistance) }}<template v-if="snapshot.nearestResistance"> · {{ number(snapshot.resistanceDistancePercent) }}% / {{ number(snapshot.resistanceDistanceATR) }} ATR</template></span>
  </div>
  <div v-else-if="snapshot" class="structure-info" :class="{ 'structure-info-detailed': detailed }">
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
      <div class="structure-levels">
        <div class="level-group">
        <div class="support">支撑 {{ zone(snapshot.nearestSupport) }}{{ snapshot.nearestSupport ? `（${snapshot.nearestSupport.touches}）` : '' }}</div>
        <div class="distance">距离 {{ number(snapshot.supportDistancePercent) }}% / {{ number(snapshot.supportDistanceATR) }} ATR</div>
        </div>
        <div class="level-group">
        <div class="resistance">阻力 {{ zone(snapshot.nearestResistance) }}{{ snapshot.nearestResistance ? `（${snapshot.nearestResistance.touches}）` : '' }}</div>
        <div class="distance">距离 {{ number(snapshot.resistanceDistancePercent) }}% / {{ number(snapshot.resistanceDistanceATR) }} ATR</div>
        </div>
        <div class="structure-status">{{ statusLabel }}</div>
      </div>
    </el-tooltip>
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
const time = (value: number | null) => value == null ? '--' : new Date(value).toLocaleString('zh-CN', { hour12: false })
</script>

<style scoped>
.structure-info { line-height: 1.55; }
.structure-info-compact { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 11px; line-height: 1.5; }
.support { color: #67c23a; }
.resistance { color: #f56c6c; }
.distance { color: var(--el-text-color-secondary); font-size: 12px; }
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
