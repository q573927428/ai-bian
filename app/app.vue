<template>
  <div id="app">
    <NuxtPage />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useBotStore } from './stores/bot'
import { useTheme } from './composables/useTheme'

const botStore = useBotStore()
const { initTheme } = useTheme()

// 页面关闭/刷新时取消 WebSocket 订阅
onMounted(() => {
  window.addEventListener('beforeunload', botStore.cleanupOnUnload)
  // 初始化主题
  initTheme()
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', botStore.cleanupOnUnload)
})
</script>

<style>
/* ─────────── CSS 变量定义 ─────────── */
:root {
  /* 主背景 */
  --bg-main: #f5f7fa;
  --bg-card: #ffffff;
  --bg-page: #ffffff;
  --bg-tooltip: #ffffff;
  --bg-log: #fafafa;
  --bg-table-header: #f5f7fa;
  --bg-hover: #f8f9fa;
  --bg-code-block: rgba(0, 0, 0, 0.03);
  --bg-expand: #fafafa;

  /* 文字 */
  --text-primary: #303133;
  --text-regular: #606266;
  --text-secondary: #909399;
  --text-placeholder: #c0c4cc;
  --text-disabled: #c0c4cc;

  /* 边框 */
  --border-color: #ebeef5;
  --border-light: #e4e7ed;
  --border-lighter: #dcdfe6;

  /* 阴影 */
  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.08);
  --shadow-card-hover: 0 4px 12px rgba(0, 0, 0, 0.1);

  /* 语义色（与 Element Plus 一致） */
  --color-success: #67c23a;
  --color-warning: #e6a23c;
  --color-danger: #f56c6c;
  --color-info: #909399;
  --color-primary: #409eff;

  /* 特殊卡片渐变 */
  --stat-card-bg: linear-gradient(135deg, #f8f9fa 0%, #fff 100%);
  --stat-card-border: #ebeef5;

  --balance-card-bg: linear-gradient(135deg, #f0f9ff 0%, #e6f7ff 100%);
  --balance-card-border: #91d5ff;
  --balance-details-bg: rgba(255, 255, 255, 0.8);
  --balance-total-color: #1890ff;
  --balance-free-color: #52c41a;
  --balance-locked-color: #fa8c16;

  --position-profit-bg: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
  --position-profit-border: #10b981;
  --position-loss-bg: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);
  --position-loss-border: #f56c6c;
  --position-neutral-bg: linear-gradient(135deg, #ebeef5 0%, #ebeef5 100%);
  --position-neutral-border: #c4c6cb;

  /* 价格卡片 */
  --price-card-bg: linear-gradient(135deg, #f8f9fa 0%, #fff 100%);
  --price-card-border: #ebeef5;
  --price-up-hover-border: #67c23a;
  --price-down-hover-border: #f56c6c;
  --price-up-hover-shadow: rgba(103, 194, 58, 0.15);
  --price-down-hover-shadow: rgba(245, 108, 108, 0.15);

  /* 日志 */
  --log-info-bg: #f4f4f5;
  --log-success-bg: #f0f9ff;
  --log-warn-bg: #fdf6ec;
  --log-error-bg: #fef0f0;

  /* 持仓详情 */
  --position-info-bg: #ffffff;
  --position-scores-bg: rgba(238, 238, 238, 0.7);
  --position-scores-bg-final: rgba(139, 92, 246, 0.1);
  --position-score-color: #1e40af;
  --position-score-color-final: #7c3aed;
  --position-reasoning-bg: #ffffff;
  --position-reasoning-border: #c7d2fe;
  --position-scores-border: #a5b4fc;

  /* AI 按钮 */
  --ai-toggle-bg: #f8fafc;
  --ai-toggle-hover: #e2e8f0;
  --ai-toggle-color: #4f46e5;

  /* 图表 */
  --chart-bg: transparent;
  --stats-container-bg: #f5f7fa;

  /* 筛选 */
  --filter-bar-border: #ebeef5;

  /* 表格样式 */
  --table-header-bg: #f5f7fa;
  --table-header-color: #303133;
}

/* 暗色主题 */
:root.dark {
  --bg-main: #141414;
  --bg-card: #1d1e1f;
  --bg-page: #141414;
  --bg-tooltip: #2c2c2d;
  --bg-log: #1a1a1a;
  --bg-table-header: #1d1e1f;
  --bg-hover: #2c2c2d;
  --bg-code-block: rgba(255, 255, 255, 0.03);
  --bg-expand: #1a1a1a;

  --text-primary: #e5eaf3;
  --text-regular: #cfd3dc;
  --text-secondary: #a3a6ad;
  --text-placeholder: #8d9095;
  --text-disabled: #6c6e72;

  --border-color: #363637;
  --border-light: #4c4d4f;
  --border-lighter: #5c5e66;

  --shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-card-hover: 0 4px 12px rgba(0, 0, 0, 0.4);

  --color-success: #67c23a;
  --color-warning: #e6a23c;
  --color-danger: #f56c6c;
  --color-info: #909399;
  --color-primary: #409eff;

  --stat-card-bg: linear-gradient(135deg, #1d1e1f 0%, #252627 100%);
  --stat-card-border: #363637;

  --balance-card-bg: linear-gradient(135deg, #162231 0%, #1a2a3d 100%);
  --balance-card-border: #2c4a6a;
  --balance-details-bg: rgba(29, 30, 31, 0.8);
  --balance-total-color: #5dade2;
  --balance-free-color: #52c41a;
  --balance-locked-color: #fa8c16;

  --position-profit-bg: linear-gradient(135deg, #0a2e1a 0%, #0d3d20 100%);
  --position-profit-border: #10b981;
  --position-loss-bg: linear-gradient(135deg, #2e0a0a 0%, #3d1414 100%);
  --position-loss-border: #f56c6c;
  --position-neutral-bg: linear-gradient(135deg, #1d1e1f 0%, #252627 100%);
  --position-neutral-border: #363637;

  --price-card-bg: linear-gradient(135deg, #1d1e1f 0%, #252627 100%);
  --price-card-border: #363637;
  --price-up-hover-border: #67c23a;
  --price-down-hover-border: #f56c6c;
  --price-up-hover-shadow: rgba(103, 194, 58, 0.2);
  --price-down-hover-shadow: rgba(245, 108, 108, 0.2);

  --log-info-bg: #1d1e1f;
  --log-success-bg: #0a2e1a;
  --log-warn-bg: #2e2a0a;
  --log-error-bg: #2e0a0a;

  --position-info-bg: #1a1a1a;
  --position-scores-bg: rgba(238, 238, 238, 0.1);
  --position-scores-bg-final: rgba(139, 92, 246, 0.2);
  --position-score-color: #93c5fd;
  --position-score-color-final: #a78bfa;
  --position-reasoning-bg: #1a1a1a;
  --position-reasoning-border: #3730a3;
  --position-scores-border: #4338ca;

  --ai-toggle-bg: #1a1a1a;
  --ai-toggle-hover: #2c2c2d;
  --ai-toggle-color: #818cf8;

  --chart-bg: transparent;
  --stats-container-bg: #1d1e1f;

  --filter-bar-border: #363637;

  --table-header-bg: #1d1e1f;
  --table-header-color: #e5eaf3;
}

/* ─────────── 全局样式 ─────────── */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

#app {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  min-height: 100vh;
  background: var(--bg-main);
  color: var(--text-primary);
  transition: background-color 0.3s, color 0.3s;
}

/* ─────────── Element Plus 暗色适配 ─────────── */

/* Element Plus 全局暗色 CSS 变量覆写（解决 el-select popper 白底等问题） */
html.dark {
  --el-bg-color-overlay: #1d1e1f;
  --el-fill-color-blank: #141414;
  --el-fill-color: #1d1e1f;
  --el-fill-color-light: #2c2c2d;
  --el-border-color: #2c2c2d;
  --el-border-color-light: #363637;
  --el-border-color-lighter: #3a3a3b;
  --el-text-color-regular: #cfd3dc;
  --el-text-color-primary: #e5eaf3;
  --el-text-color-secondary: #a3a6ad;
  --el-text-color-placeholder: #6c6e72;
  --el-color-primary-light-9: rgba(64, 158, 255, 0.15);
  --el-color-white: #1d1e1f;
  --el-color-black: #e5eaf3;
}

/* 表格 */
html.dark .el-table {
  --el-table-header-bg-color: #1a1a1b;
  --el-table-header-text-color: #e5eaf3;
  --el-table-border-color: #2c2c2d;
  --el-table-bg-color: #1d1e1f;
  --el-table-tr-bg-color: #1d1e1f;
  --el-table-row-hover-bg-color: #252627;
  --el-table-text-color: #cfd3dc;
  --el-table-expanded-cell-bg-color: #1a1a1a;
}

/* 表格条纹行 */
html.dark .el-table--striped .el-table__body tr.el-table__row--striped td,
html.dark .el-table--striped .el-table__body tr.el-table__row--striped th {
  background-color: #222324 !important;
}
html.dark .el-table--striped .el-table__body tr.el-table__row--striped:hover td {
  background-color: #252627 !important;
}
html.dark .el-table .el-table__body td.el-table__cell {
  background-color: inherit;
}

/* 卡片 */
html.dark .el-card {
  --el-card-bg-color: #1d1e1f;
  --el-card-border-color: #2c2c2d;
}
html.dark .el-card__header {
  color: #e5eaf3;
  border-bottom: 1px solid #2c2c2d;
}

/* 对话框 */
html.dark .el-dialog {
  --el-dialog-bg-color: #1d1e1f;
  --el-dialog-border-color: #2c2c2d;
}

/* 输入框 */
html.dark .el-input__wrapper {
  background-color: #141414;
  box-shadow: 0 0 0 1px #2c2c2d inset;
}
html.dark .el-input__wrapper:hover {
  box-shadow: 0 0 0 1px #3a3a3b inset;
}
html.dark .el-input__wrapper.is-focus {
  box-shadow: 0 0 0 1px var(--color-primary) inset;
}
html.dark .el-input__inner {
  color: #e5eaf3;
  background: transparent;
}
html.dark .el-input__inner::placeholder {
  color: #6c6e72;
}

/* 数字输入框 */
html.dark .el-input-number {
  --el-input-number-controls-bg-color: #141414;
}
html.dark .el-input-number .el-input__wrapper {
  background-color: #141414;
}
html.dark .el-input-number__decrease,
html.dark .el-input-number__increase {
  background: #1d1e1f;
  color: #a3a6ad;
  border-left: 1px solid #3a3a3b;
}
html.dark .el-input-number__decrease:hover,
html.dark .el-input-number__increase:hover {
  background: #252627;
  color: #e5eaf3;
}
html.dark .el-input-number__decrease.is-disabled,
html.dark .el-input-number__increase.is-disabled {
  color: #6c6e72;
  background: #1a1a1b;
}

/* 选择器 */
html.dark .el-select .el-input__wrapper {
  background-color: #141414;
  box-shadow: 0 0 0 1px #2c2c2d inset;
}
html.dark .el-select .el-input__wrapper:hover {
  box-shadow: 0 0 0 1px #3a3a3b inset;
}
html.dark .el-select .el-input.is-focus .el-input__wrapper {
  box-shadow: 0 0 0 1px var(--color-primary) inset;
}

/* 通用弹层（el-select-dropdown / el-picker-panel / el-cascader / el-popover / el-dropdown / el-autocomplete 等 popper 的背景） */
html.dark .el-popper,
html.dark .el-picker-panel {
  background: #1d1e1f !important;
  color: #cfd3dc !important;
}
html.dark .el-popper .popper__arrow::before {
  border-bottom-color: #2c2c2d !important;
  border-top-color: #2c2c2d !important;
}
html.dark .el-popper .popper__arrow::after {
  border-bottom-color: #1d1e1f !important;
  border-top-color: #1d1e1f !important;
}
/* 日期/时间选择器面板内部元素 */
html.dark .el-picker-panel__body,
html.dark .el-picker-panel__body-wrapper,
html.dark .el-picker-panel__content {
  background: #1d1e1f !important;
}
html.dark .el-date-table th {
  color: #a3a6ad !important;
  border-bottom-color: #2c2c2d !important;
}
html.dark .el-date-table td {
  color: #cfd3dc !important;
}
html.dark .el-date-table td.next-month,
html.dark .el-date-table td.prev-month {
  color: #6c6e72 !important;
}
html.dark .el-date-table td.today .cell {
  color: var(--color-primary) !important;
}
html.dark .el-date-table td.current:not(.disabled) .cell {
  background: var(--color-primary) !important;
  color: #fff !important;
}
html.dark .el-date-table td.available:hover .cell {
  background: #252627 !important;
}
html.dark .el-picker-panel__icon-btn {
  color: #a3a6ad !important;
}
html.dark .el-picker-panel__icon-btn:hover {
  color: var(--color-primary) !important;
}
html.dark .el-date-editor .el-input__wrapper {
  background-color: #141414;
}
/* 级联选择器面板 */
html.dark .el-cascader-panel {
  background: #1d1e1f !important;
}
html.dark .el-cascader-node {
  color: #cfd3dc !important;
}
html.dark .el-cascader-node:not(.is-disabled):hover {
  background: #252627 !important;
}
html.dark .el-cascader-menu__wrap,
html.dark .el-cascader-menu {
  background: #1d1e1f !important;
  border-right-color: #2c2c2d !important;
}
/* 下拉菜单 */
html.dark .el-dropdown-menu {
  background: #1d1e1f !important;
  border: 1px solid #2c2c2d !important;
}
html.dark .el-dropdown-menu__item {
  color: #cfd3dc !important;
}
html.dark .el-dropdown-menu__item:not(.is-disabled):hover {
  background: #252627 !important;
  color: var(--color-primary) !important;
}
/* 弹出框 */
html.dark .el-popover {
  background: #1d1e1f !important;
  border: 1px solid #2c2c2d !important;
  color: #cfd3dc !important;
}

/* 选择器下拉面板（el-select 的 popper 会被 teleport 到 body） */
html.dark .el-select__popper,
html.dark .el-select-dropdown {
  background: #1d1e1f !important;
  border: none !important;
  box-shadow: 0 0 0 1px #2c2c2d inset, 0 2px 8px rgba(0, 0, 0, 0.5);
}
html.dark .el-select__popper .el-select-dropdown__item,
html.dark .el-select-dropdown .el-select-dropdown__item {
  color: #cfd3dc !important;
  background: transparent;
}
html.dark .el-select__popper .el-select-dropdown__item:hover,
html.dark .el-select-dropdown .el-select-dropdown__item:hover {
  background: #252627 !important;
}
html.dark .el-select__popper .el-select-dropdown__item.selected,
html.dark .el-select-dropdown .el-select-dropdown__item.selected {
  background: rgba(64, 158, 255, 0.2) !important;
  color: var(--color-primary) !important;
}
html.dark .el-select__popper .popper__arrow::after,
html.dark .el-select-dropdown .popper__arrow::after {
  border-bottom-color: #1d1e1f !important;
}

/* 选择器多选标签 */
html.dark .el-select .el-select__tags .el-tag {
  background: #2c2c2d;
  border-color: #3a3a3b;
  color: #cfd3dc;
}

/* 标签 */
html.dark .el-tag {
  --el-tag-text-color: #cfd3dc;
}
html.dark .el-tag.el-tag--default {
  background: #2c2c2d;
  border-color: #3a3a3b;
  color: #cfd3dc;
}
html.dark .el-tag.el-tag--success {
  background: rgba(103, 194, 58, 0.15);
  border-color: rgba(103, 194, 58, 0.3);
  color: #85ce61;
}
html.dark .el-tag.el-tag--warning {
  background: rgba(230, 162, 60, 0.15);
  border-color: rgba(230, 162, 60, 0.3);
  color: #e6a23c;
}
html.dark .el-tag.el-tag--danger {
  background: rgba(245, 108, 108, 0.15);
  border-color: rgba(245, 108, 108, 0.3);
  color: #f78989;
}
html.dark .el-tag.el-tag--info {
  background: #2c2c2d;
  border-color: #3a3a3b;
  color: #a3a6ad;
}
html.dark .el-tag.el-tag--primary {
  background: rgba(64, 158, 255, 0.15);
  border-color: rgba(64, 158, 255, 0.3);
  color: #66b3ff;
}

/* 分割线 */
html.dark .el-divider {
  --el-divider-border-color: #2c2c2d;
}
html.dark .el-divider__text {
  background: #1d1e1f;
  color: #a3a6ad;
}

/* 消息框 */
html.dark .el-message-box {
  --el-messagebox-bg-color: #1d1e1f;
  --el-messagebox-border-color: #2c2c2d;
}

/* 警告条 */
html.dark .el-alert {
  --el-alert-bg-color: #1d1e1f;
}

/* 分页 */
html.dark .el-pagination {
  --el-pagination-bg-color: transparent;
  --el-pagination-button-bg-color: #2c2c2d;
  --el-pagination-hover-color: var(--color-primary);
  --el-pagination-button-color: #cfd3dc;
  --el-pagination-button-disabled-color: #6c6e72;
}
html.dark .el-pagination button {
  background: #2c2c2d;
  border: 1px solid #3a3a3b;
  color: #cfd3dc;
}
html.dark .el-pagination button:hover {
  color: var(--color-primary);
}
html.dark .el-pagination .btn-prev,
html.dark .el-pagination .btn-next {
  background: #2c2c2d;
}
html.dark .el-pager li {
  background: #2c2c2d;
  border: 1px solid #3a3a3b;
  color: #cfd3dc;
}
html.dark .el-pager li.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

/* 单选框按钮 */
html.dark .el-radio-button__inner {
  background: #1d1e1f;
  border-color: #3a3a3b;
  color: #cfd3dc;
}
html.dark .el-radio-button__original-radio:checked + .el-radio-button__inner {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

/* 表单标签 */
html.dark .el-form-item__label {
  color: #a3a6ad;
}

/* 开关 */
html.dark .el-switch {
  --el-switch-off-color: #3a3a3b;
}

/* 时间线 */
html.dark .el-timeline-item__timestamp {
  color: #a3a6ad;
}

/* 选项卡 */
html.dark .el-tabs__header {
  border-bottom: 1px solid #2c2c2d;
}
html.dark .el-tabs__item {
  color: #a3a6ad;
}
html.dark .el-tabs__item.is-active {
  color: var(--color-primary);
}
html.dark .el-tabs {
  --el-tabs-header-bg-color: transparent;
}

/* 复选框 */
html.dark .el-checkbox__label {
  color: #cfd3dc;
}
html.dark .el-checkbox__input.is-disabled .el-checkbox__inner {
  background: #2c2c2d;
  border-color: #3a3a3b;
}

/* skeleton 骨架屏 */
html.dark .el-skeleton {
  --el-skeleton-color: #2c2c2d;
  --el-skeleton-to-color: #3a3a3b;
}
</style>