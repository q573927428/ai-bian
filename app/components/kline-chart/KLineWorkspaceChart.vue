<!-- ==================== 首页 K 线主图与共享时间轴副图 ==================== -->
<template>
  <KLineChartSimple v-if="symbol" :symbol="symbol" :timeframe="timeframe" :indicator="indicator"
    @timeframe-change="emit('timeframe-change', $event)" @toolbar-height-change="emit('toolbar-height-change', $event)">
    <template #indicator-controls>
      <div class="indicator-buttons" role="group" aria-label="副图指标">
        <button v-for="option in KLINE_INDICATORS" :key="option" type="button" :aria-pressed="indicator === option" @click="indicator = option">
          {{ option }}
        </button>
      </div>
    </template>
  </KLineChartSimple>
  <el-empty v-else description="等待交易对数据" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import KLineChartSimple from './KLineChartSimple.vue'
import { DEFAULT_KLINE_INDICATOR, KLINE_INDICATORS, type KlineIndicator, type KlineWorkspacePeriod } from '../../utils/kline-indicators'

/** 首页主图只接受与副图兼容的 K 线周期。 */
defineProps<{ symbol: string; timeframe: KlineWorkspacePeriod }>()
const emit = defineEmits<{ 'timeframe-change': [timeframe: string]; 'toolbar-height-change': [height: number] }>()

// 指标选择独立于交易对、主图周期和右侧面板，查看其他行情时保留当前副图。
const indicator = ref<KlineIndicator>(DEFAULT_KLINE_INDICATOR)
</script>

<style scoped>
.indicator-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 3px;
  border: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-card) 12%, transparent);
}
.indicator-buttons button {
  border: 1px solid color-mix(in srgb, var(--el-border-color) 55%, transparent);
  border-radius: 4px;
  padding: 3px 6px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  cursor: pointer;
}
.indicator-buttons button:hover,
.indicator-buttons button[aria-pressed="true"] {
  border-color: var(--el-color-primary);
}
.indicator-buttons button[aria-pressed="true"] {
  background: color-mix(in srgb, var(--el-color-primary) 26%, transparent);
}
@media (max-width: 480px) {
  .indicator-buttons button { padding-inline: 4px; }
}
</style>
