<template>
  <el-drawer v-model="visible" class="logs-drawer" title="运行日志" direction="rtl" size="50%" destroy-on-close>
    <div class="logs-toolbar">
          <div class="header-title-group">
            <el-switch
              :model-value="desktopNotificationsEnabled"
              :disabled="!desktopNotificationsSupported || requestingPermission"
              active-text="桌面通知"
              @change="toggleDesktopNotifications"
            />
            <el-button
              size="small"
              text
              type="primary"
              :disabled="!hasDetailedLogs"
              @click="toggleAllDetailedLogs"
            >
              <el-icon>
                <ElIconArrowDown v-if="showDetailedLogs" />
                <ElIconArrowRight v-else />
              </el-icon>
              {{ showDetailedLogs ? '收起详细日志' : '展开详细日志' }}
            </el-button>
          </div>
          <div class="filter-group">
            <el-input
              v-model="logKeyword"
              placeholder="日志筛选"
              clearable
              class="filter-input"
            />
            <el-select v-model="selectedStrategy" placeholder="策略" clearable class="filter-select">
              <el-option label="全部" value="" />
              <el-option 
                v-for="strategy in strategies" 
                :key="strategy.id" 
                :label="strategy.name" 
                :value="strategy.id" 
              />
            </el-select>
            <el-select v-model="selectedSymbol" placeholder="交易对" clearable class="filter-select">
              <el-option label="全部" value="" />
              <el-option 
                v-for="symbol in symbols" 
                :key="symbol" 
                :label="symbol" 
                :value="symbol" 
              />
            </el-select>
          </div>
    </div>

    <div class="logs-container">
      <div
        v-for="(log, index) in filteredLogs"
        :key="`${log.timestamp}-${index}`"
        :class="['log-item', `log-${log.level.toLowerCase()}`]"
      >
        <span class="log-time">{{ formatTime(log.timestamp) }}</span>
        <div class="log-message">
          <template v-if="hasDetailedLog(log.message)">
            <div class="log-summary-line">
              <span><b>[{{ log.category }}]</b> {{ getLogSummary(log.message) }}</span>
            </div>
            <div v-if="showDetailedLogs" class="detailed-log">
              <!-- <div class="detailed-log-header">=== 详细AI日志 ===</div> -->
              <div class="detailed-log-content">{{ getDetailedLog(log.message) }}</div>
            </div>
          </template>
          <span v-else><b>[{{ log.category }}]</b> {{ log.message }}</span>
        </div>
      </div>
      <el-empty v-if="filteredLogs.length === 0" description="暂无日志" />
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import type { LogEntry } from '../../types'
import { useBotStore } from '../stores/bot'
import dayjs from 'dayjs'

/** 日志抽屉的显示状态。 */
interface Props {
  /** 控制日志抽屉的显示状态。 */
  modelValue: boolean
}

/** 向首页同步抽屉状态或请求切换交易对图表。 */
interface Emits {
  (event: 'update:modelValue', value: boolean): void
  (event: 'select-symbol', symbol: string, mainTimeframe?: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const botStore = useBotStore()

// 日志关键字，可自由匹配日志分类或正文内容
const logKeyword = ref<string>('')
// 当前选中的策略
const selectedStrategy = ref<string>('')
// 当前选中的交易对
const selectedSymbol = ref<string>('')
// 策略列表
const strategies = ref<Array<{ id: string; name: string; mainTimeframe?: string }>>([])
// 交易对列表
const symbols = ref<string[]>([])


// 倒序显示日志，最新的在最上面
const reversedLogs = computed(() => [...botStore.logs].reverse())

// 筛选后的日志
const filteredLogs = computed(() => {
  let logs = reversedLogs.value
  
  // 自由输入关键字筛选，分类和正文均支持不区分大小写的包含匹配。
  const keyword = logKeyword.value.trim().toLowerCase()
  if (keyword) {
    logs = logs.filter(log =>
      log.category.toLowerCase().includes(keyword) ||
      log.message.toLowerCase().includes(keyword)
    )
  }
  
  // 再按策略筛选
  if (selectedStrategy.value) {
    const strategyId = selectedStrategy.value
    logs = logs.filter(log => 
      log.message.includes(strategyId) || 
      log.category.includes(strategyId) ||
      (log.data?.strategyId === strategyId)
    )
  }
  
  // 再按交易对筛选
  if (selectedSymbol.value) {
    const symbol = selectedSymbol.value
    logs = logs.filter(log => 
      log.message.includes(symbol) || 
      log.category.includes(symbol) ||
      (log.data?.symbol === symbol)
    )
  }
  
  return logs

})

// 获取策略列表
async function fetchStrategies() {
  try {
    const response = await $fetch('/api/strategies')
    if (response.success && response.data) {
      strategies.value = response.data.map((s: any) => ({
        id: s.id,
        name: s.name,
        mainTimeframe: s.marketData?.timeframes?.[0]
      }))
    }
  } catch (error) {
    console.error('获取策略列表失败:', error)
  }
}

const DETAILED_LOG_SEPARATOR = '===详细AI日志==='
const DESKTOP_NOTIFICATION_KEY = 'scan-desktop-notifications'
const desktopNotificationsEnabled = ref(false)
const desktopNotificationsSupported = ref(false)
const requestingPermission = ref(false)
const desktopNotifications = new Set<Notification>()

/** 必须由开关点击申请授权，避免浏览器拦截非用户操作触发的权限请求。 */
async function toggleDesktopNotifications(value: string | number | boolean): Promise<void> {
  if (!desktopNotificationsSupported.value || requestingPermission.value) return
  if (value) {
    requestingPermission.value = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        ElMessage.warning(permission === 'denied'
          ? '桌面通知已被阻止，请在浏览器的网站设置中允许通知'
          : '未开启通知权限，桌面通知保持关闭')
        return
      }
    } catch {
      ElMessage.warning('无法申请桌面通知权限，请检查浏览器的网站设置')
      return
    } finally {
      requestingPermission.value = false
    }
  }
  desktopNotificationsEnabled.value = Boolean(value)
  if (!value) closeDesktopNotifications()
  try {
    localStorage.setItem(DESKTOP_NOTIFICATION_KEY, String(Boolean(value)))
  } catch {
    // 隐私模式或存储限制不影响本次会话使用通知。
  }
}

/** 仅后台页面的成功扫描发送静音通知；沿用近期日志去重，避免轮询重复提醒。 */
function showDesktopNotification(log: LogEntry): void {
  if (!desktopNotificationsEnabled.value || !desktopNotificationsSupported.value
    || Notification.permission !== 'granted' || !document.hidden || log.level !== 'SUCCESS') return
  const summary = getLogSummary(log.message)
  const symbol = log.data?.symbol || summary.match(/^\s*(\S+)\s+@/)?.[1]
  if (!symbol) return
  try {
    const notification = new Notification(`${symbol} · 扫描满足开仓条件`, {
      body: summary,
      tag: `scan-${symbol}-${log.data?.strategyId || log.category}`,
      silent: true
    })
    desktopNotifications.add(notification)
    notification.onclick = () => {
      window.focus()
      visible.value = false
      emit('select-symbol', symbol, getScanTimeframe(log))
      notification.close()
      desktopNotifications.delete(notification)
    }
    notification.onclose = () => desktopNotifications.delete(notification)
    notification.onerror = () => desktopNotifications.delete(notification)
  } catch {
    // 部分浏览器不支持通知构造器，失败时仍保留原有页面弹窗。
  }
}

/** 关闭开关或卸载时移除本组件创建的系统通知。 */
function closeDesktopNotifications(): void {
  for (const notification of desktopNotifications) notification.close()
  desktopNotifications.clear()
}

const seenLogs = new Map<string, number>()
const notifications = new Set<ReturnType<typeof ElNotification>>()
const pendingNotifications: LogEntry[] = []
let isCreatingNotifications = false
let notificationsMounted = false
let stopNotificationWatch: (() => void) | undefined

/** 优先使用扫描当时保存的周期；旧日志回退到对应策略的主周期，不猜测默认值。 */
function getScanTimeframe(log: LogEntry): string | undefined {
  const strategyId = log.data?.strategyId || getLogSummary(log.message).match(/\[([^\]]+)\]/)?.[1]
  return log.data?.mainTimeframe || strategies.value.find(strategy => strategy.id === strategyId)?.mainTimeframe
}

/** 只提醒未处理的近期 AI 结果；抽屉内看过的结果也标记，避免关闭后补弹。 */
function notifyRecentAnalysis(): void {
  const now = Date.now()
  for (const [key, timestamp] of seenLogs) {
    if (now - timestamp > 60_000) seenLogs.delete(key)
  }
  for (const log of botStore.logs) {
    const age = now - log.timestamp
    if (!hasDetailedLog(log.message) || age < 0 || age > 60_000) continue
    const key = JSON.stringify([log.timestamp, log.category, log.message])
    if (seenLogs.has(key)) continue
    seenLogs.set(key, log.timestamp)
    // 抽屉即使处于打开状态，后台页面也需要收到成功结果提醒。
    showDesktopNotification(log)
    if (!visible.value) pendingNotifications.push(log)
  }
  void flushAnalysisNotifications()
}

/** 等上一条通知完成 DOM 更新后再创建下一条，确保组件能测得真实高度并正确堆叠。 */
async function flushAnalysisNotifications(): Promise<void> {
  if (isCreatingNotifications) return
  isCreatingNotifications = true
  try {
    while (pendingNotifications.length > 0) {
      // ElNotification 初次挂载时隐藏，必须等待可见状态更新后才能计算下一条的偏移。
      await nextTick()
      if (!notificationsMounted || visible.value) {
        pendingNotifications.length = 0
        break
      }
      const log = pendingNotifications.shift()!
      if (Date.now() - log.timestamp <= 60_000) showAnalysisNotification(log)
    }
  } finally {
    isCreatingNotifications = false
  }
}

/** 兼容历史文本日志，新日志优先读取结构化分析字段，缺失值不猜测。 */
function showAnalysisNotification(log: LogEntry): void {
  const summary = getLogSummary(log.message)
  const data = log.data
  const symbol = data?.symbol || summary.match(/^\s*(\S+)\s+@/)?.[1]
  if (!symbol) return
  const strategyId = data?.strategyId || summary.match(/\[([^\]]+)\]/)?.[1] || '未知策略'
  const direction = data?.direction?.toUpperCase() || summary.match(/@\S+\s+(LONG|SHORT|IDLE)/)?.[1] || 'IDLE'
  const score = data?.score ?? summary.match(/评分[（(:：]\s*([\d.]+)/)?.[1] ?? '--'
  const confidence = data?.confidence ?? log.message.match(/置信度[（(:：]\s*([\d.]+)/)?.[1] ?? '--'
  // 扫描引擎只在满足开仓条件时记录 SUCCESS，通知状态直接沿用日志级别。
  const type = log.level === 'SUCCESS' ? 'success' : 'warning'
  // 背景表达开仓方向，与是否通过开仓检查的日志状态独立。
  const directionClass = direction === 'LONG' ? 'ai-analysis-long' : direction === 'SHORT' ? 'ai-analysis-short' : ''
  const notification = ElNotification({
    title: `${symbol} · ${direction}`,
    type,
    duration: 8000,
    customClass: `ai-analysis-notification ${directionClass}`.trim(),
    message: `评分 ${score} · 置信度 ${confidence} · ${strategyId}`,
    position: 'bottom-right',
    // 在固定行情栏上方保留 16px 间距，实际高度包含移动端底部安全区。
    offset: Math.ceil(document.querySelector('.market-ticker')?.getBoundingClientRect().height ?? 0) + 16,
    onClick: () => {
      emit('select-symbol', symbol, getScanTimeframe(log))
      notification.close()
    },
    onClose: () => {
      notifications.delete(notification)
    }
  })
  notifications.add(notification)
}

/** 打开日志时撤下通知，避免与抽屉重复展示。 */
function closeAnalysisNotifications(): void {
  pendingNotifications.length = 0
  for (const notification of notifications) notification.close()
  notifications.clear()
}

// 详细 AI 日志默认收起，并由标题栏按钮统一控制全部日志。
const showDetailedLogs = ref(false)

// 当前筛选结果中是否存在详细 AI 日志，用于控制全局切换按钮状态。
const hasDetailedLogs = computed(() =>
  filteredLogs.value.some(log => hasDetailedLog(log.message))
)

function formatTime(timestamp: number): string {
  return dayjs(timestamp).format('HH:mm:ss')
}

function hasDetailedLog(message: string): boolean {
  return message.includes(DETAILED_LOG_SEPARATOR)
}

function getLogSummary(message: string): string {
  const index = message.indexOf(DETAILED_LOG_SEPARATOR)
  return index > 0 ? message.substring(0, index).trim() : message
}

function getDetailedLog(message: string): string {
  const index = message.indexOf(DETAILED_LOG_SEPARATOR)
  return index > 0 ? message.substring(index + DETAILED_LOG_SEPARATOR.length).trim() : ''
}

/**
 * 统一展开或收起当前日志列表中的全部详细 AI 日志。
 */
function toggleAllDetailedLogs(): void {
  showDetailedLogs.value = !showDetailedLogs.value
}

// 获取交易对列表
function fetchSymbols() {
  if (botStore.botConfig?.symbols && Array.isArray(botStore.botConfig.symbols)) {
    symbols.value = botStore.botConfig.symbols
  }
}

// 组件加载时获取日志并订阅共享轮询
onMounted(async () => {
  desktopNotificationsSupported.value = window.isSecureContext && 'Notification' in window
  try {
    desktopNotificationsEnabled.value = desktopNotificationsSupported.value
      && Notification.permission === 'granted'
      && localStorage.getItem(DESKTOP_NOTIFICATION_KEY) === 'true'
  } catch {
    // 无法读取偏好时默认关闭，不主动请求权限。
  }
  notificationsMounted = true
  stopNotificationWatch = watch([() => botStore.logs, visible], () => {
    if (visible.value) closeAnalysisNotifications()
    notifyRecentAnalysis()
  }, { immediate: true, deep: true })
  botStore.subscribeToPolling('system-logs')
  // 获取策略列表
  await fetchStrategies()
  // 获取交易对列表
  fetchSymbols()
})


// 组件卸载时取消订阅共享轮询
onUnmounted(() => {
  notificationsMounted = false
  stopNotificationWatch?.()
  closeAnalysisNotifications()
  closeDesktopNotifications()
  botStore.unsubscribeFromPolling('system-logs')
})
</script>

<style scoped>
.logs-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  gap: 16px;
  padding-bottom: 10px;
}

.filter-group {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.filter-select {
  width: 100px;
}

.filter-input {
  width: 100px;
}

.card-header span {

  font-weight: 600;
  font-size: 15px;
}

.header-title {
  font-weight: 600;
  font-size: 15px;
  white-space: nowrap;
}

.header-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.logs-container {
  /* 抽屉正文扣除标题和筛选栏后占满可视高度，日志过多时仅列表内部滚动。 */
  height: calc(100vh - 170px);
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  background: var(--bg-log);
  border-radius: 4px;
}

.logs-container::-webkit-scrollbar {
  width: 6px;
}

.logs-container::-webkit-scrollbar-track {
  background: var(--bg-main);
  border-radius: 3px;
}

.logs-container::-webkit-scrollbar-thumb {
  background: var(--text-placeholder);
  border-radius: 3px;
}

.logs-container::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

.log-item {
  padding: 6px 10px;
  margin-bottom: 4px;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.log-info {
  background: var(--log-info-bg);
}

.log-success {
  background: var(--log-success-bg);
  color: var(--color-success);
}

.log-warn {
  background: var(--log-warn-bg);
  color: var(--color-warning);
}

.log-error {
  background: var(--log-error-bg);
  color: var(--color-danger);
}

.log-time {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.log-category {
  font-weight: 600;
  flex-shrink: 0;
}

.log-message {
  flex: 1;
  flex-basis: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

@media (max-width: 768px) {
  .logs-toolbar {
    flex-wrap: wrap;
    gap: 8px;
  }

  .filter-group {
    width: 100%;
    flex-wrap: wrap;
  }

  .filter-select,
  .filter-input {
    flex: 1;
    min-width: 0;
  }

  .log-item {
    flex-direction: column;
    gap: 4px;
  }

  .log-time,
  .log-category {
    font-size: 12px;
  }

  .log-message {
    flex-basis: auto;
    margin-top: 2px;
  }

  .logs-container {
    height: calc(100vh - 210px);
  }
}

@media (max-width: 768px) {
  :global(.logs-drawer) { width: 100% !important; }
}


@media (min-width: 769px) {
  .log-message {
    flex-basis: 0;
  }
}

.log-summary-line {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
}

.log-summary-line > span {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.detailed-log {
  margin-top: 8px;
  padding: 10px;
  background: var(--bg-code-block);
  border-radius: 4px;
  border-left: 3px solid var(--color-primary);
  width: 100%;
}

.detailed-log-header {
  font-weight: 600;
  color: var(--color-primary);
  margin-bottom: 6px;
  font-size: 12px;
}

.detailed-log-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-regular);
}
</style>

<style>
/* 通知挂载到 body，使用全局样式；只让背景透明，保持文字与图标清晰。 */
.ai-analysis-notification {
  width: 350px;
  max-width: calc(100vw - 32px);
  background: color-mix(in srgb, var(--el-bg-color-overlay) 65%, transparent);
  backdrop-filter: blur(8px);
  cursor: pointer;
}
/* 混合主题底色保持深浅主题文字可读，方向只影响背景和边框。 */
.ai-analysis-notification.ai-analysis-long {
  background: color-mix(in srgb, var(--el-color-success) 25%, var(--el-bg-color-overlay) 75%);
  border-color: var(--el-color-success);
}
.ai-analysis-notification.ai-analysis-short {
  background: color-mix(in srgb, var(--el-color-danger) 25%, var(--el-bg-color-overlay) 75%);
  border-color: var(--el-color-danger);
}
.ai-analysis-notification .el-notification__group {
  flex: 1;
  min-width: 0;
}
.ai-analysis-notification .el-notification__title {
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.ai-analysis-notification .el-notification__content {
  font-size: 12px;
  text-align: left;
}
</style>
