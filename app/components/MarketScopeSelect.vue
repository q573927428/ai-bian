<!-- ==================== 市场分类选择器 ==================== -->
<template>
  <el-select v-model="scope" class="market-scope-select" size="small" aria-label="市场分类" title="按资产分类切换统计和展示范围">
    <el-option label="全部" value="all" />
    <el-option label="加密" value="crypto" />
    <el-option label="股票" value="tradfi" />
  </el-select>
</template>

<script setup lang="ts">
import type { BreadthScope } from '../utils/market-breadth'
const scope = defineModel<BreadthScope>({ required: true })
</script>

<style scoped>
.market-scope-select { width: 60px; flex-shrink: 0; }
</style>
