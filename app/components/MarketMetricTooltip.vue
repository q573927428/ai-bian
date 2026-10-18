<!-- ==================== 市场指标详情提示 ==================== -->
<template>
  <el-tooltip placement="top" effect="light" :show-after="200" :hide-after="100" :z-index="2147483647" :popper-style="popperStyle" @show="emit('visibleChange', true)" @hide="emit('visibleChange', false)">
    <template #content>
      <div class="metric-details">
        <div v-for="(line, index) in details.split('；')" :key="index">{{ line }}</div>
      </div>
    </template>
    <slot />
  </el-tooltip>
</template>

<script setup lang="ts">
defineProps<{ details: string }>()
const emit = defineEmits<{ visibleChange: [visible: boolean] }>()
// 浮层传送至 body，直接使用主题变量，保持亮暗主题一致。
const popperStyle = {
  maxWidth: 'min(360px, calc(100vw - 24px))',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  borderColor: 'var(--el-border-color-light)',
}
</script>

<style scoped>
.metric-details { font-size: 12px; line-height: 1.7; white-space: normal; overflow-wrap: anywhere; }
</style>
