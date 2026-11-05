<template>
  <Teleport to="body">
    <div
      ref="notificationContainer"
      class="ai-analysis-notification-list"
      :style="{ '--notification-bottom': `${notificationBottom}px` }"
      role="region"
      aria-label="AI 分析通知，可上下滚动"
      tabindex="0"
      @mouseenter="syncAnalysisNotificationTimers"
      @mouseleave="syncAnalysisNotificationTimers"
    />
  </Teleport>
  <el-drawer v-if="passwordVerified" v-model="visible" class="logs-drawer" title="运行日志" direction="rtl" size="50%" destroy-on-close>
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
              <el-button size="small" text type="primary" @click="openAnalysisDetail(log)">AI 详情</el-button>
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
  <el-dialog
    v-if="passwordVerified"
    v-model="analysisDetailVisible"
    title="AI 分析详情"
    width="min(860px, calc(100vw - 32px))"
    append-to-body
  >
    <template v-if="selectedAnalysis">
      <div class="analysis-detail-meta">
        {{ dayjs(selectedAnalysis.timestamp).format('YYYY-MM-DD HH:mm:ss') }} · {{ selectedAnalysis.category }}
      </div>
      <p class="analysis-detail-summary">{{ getLogSummary(selectedAnalysis.message) }}</p>
      <div class="analysis-detail-body detailed-log-content">{{ getDetailedLog(selectedAnalysis.message) }}</div>
    </template>
    <template #footer>
      <el-button @click="analysisDetailVisible = false">关闭</el-button>
      <el-button
        v-if="selectedPromptUrl"
        tag="a"
        :href="selectedPromptUrl"
        target="_blank"
        rel="noopener noreferrer"
        title="查看该策略和交易对最近一次缓存的用户提示词"
      >
        查看提示词
      </el-button>
      <el-button type="primary" :disabled="!selectedAnalysis || !getScanSymbol(selectedAnalysis)" @click="selectedAnalysis && viewAnalysisChart(selectedAnalysis)">
        查看 K 线
      </el-button>
    </template>
  </el-dialog>
  <PasswordDialog v-model="showPasswordDialog" @success="handleDetailPasswordSuccess" />
</template>

<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import type { LogEntry } from '../../types'
import { useBotStore } from '../stores/bot'
import { usePageUnlock } from '../composables/usePageUnlock'
import PasswordDialog from './PasswordDialog.vue'
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
const analysisDetailVisible = ref(false)
// 保存点击时的结果快照，避免轮询清理日志后弹窗内容丢失。
const selectedAnalysis = ref<LogEntry | null>(null)
const selectedPromptUrl = ref<string>()
const pendingAnalysis = ref<LogEntry | null>(null)
const { passwordVerified, showPasswordDialog, handleUnlock, handlePasswordSuccess } = usePageUnlock({
  // 本组件只恢复 AI 详情，日志入口的待办仍由首页管理。
  onOpen: () => {},
  onLock: () => {
    visible.value = false
    analysisDetailVisible.value = false
    selectedAnalysis.value = null
    selectedPromptUrl.value = undefined
    pendingAnalysis.value = null
    showPasswordDialog.value = false
  }
})

// 只查询缓存目录；关闭或切换详情后丢弃旧响应，避免显示上一条日志的入口。
watch([analysisDetailVisible, selectedAnalysis], async ([isOpen, log], _previous, onCleanup) => {
  selectedPromptUrl.value = undefined
  let cancelled = false
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    cancelled = true
    if (expiryTimer !== undefined) clearTimeout(expiryTimer)
  })
  if (!isOpen || !log) return
  const promptUrl = getUserPromptUrl(log)
  if (!promptUrl) return
  const query = new URLSearchParams(promptUrl.split('?')[1])
  const startedAt = Date.now()
  try {
    const response = await $fetch('/api/ai/prompts')
    if (cancelled || !response.success) return
    const normalizeSymbol = (value: string) => value.replace('/', '').toUpperCase()
    const cached = response.data.find(entry => entry.strategyId === query.get('strategyId')
      && normalizeSymbol(entry.symbol) === normalizeSymbol(query.get('symbol')!))
    if (!cached) return
    // 使用服务端剩余有效期并扣除请求耗时，避免客户端时钟偏差导致过期入口残留。
    const remainingMs = cached.expiresAt - response.serverTime - (Date.now() - startedAt)
    if (remainingMs <= 0) return
    // 锁定目录中实际命中的请求，点击时不会跳到后来产生的另一份提示词。
    query.set('timestamp', String(cached.timestamp))
    selectedPromptUrl.value = `/api/ai/prompt?${query.toString()}`
    expiryTimer = setTimeout(() => { selectedPromptUrl.value = undefined }, remainingMs)
  } catch {
    // 缓存查询不可用时隐藏入口，分析详情仍正常展示。
  }
})

/** 新日志使用结构化交易对，历史日志从摘要回退读取。 */
function getScanSymbol(log: LogEntry): string | undefined {
  return log.data?.symbol || getLogSummary(log.message).match(/^\s*(\S+)\s+@/)?.[1]
}

/** 查询该策略和交易对最近一次实际请求；日志时间不等于分析时间，不能作为精确查询时间戳。 */
function getUserPromptUrl(log: LogEntry): string | undefined {
  const strategyId = log.data?.strategyId || getLogSummary(log.message).match(/\[([^\]]+)\]/)?.[1]
  const symbol = getScanSymbol(log)
  if (!strategyId || !symbol) return undefined
  const query = new URLSearchParams({ strategyId, symbol, format: 'text' })
  return `/api/ai/prompt?${query.toString()}`
}

/** 通知持续公开展示，完整 AI 结果必须先完成页面密码验证。 */
function openAnalysisDetail(log: LogEntry): void {
  if (!passwordVerified.value) {
    pendingAnalysis.value = { ...log }
    handleUnlock()
    return
  }
  selectedPromptUrl.value = undefined
  selectedAnalysis.value = { ...log }
  analysisDetailVisible.value = true
}

/** 验证后恢复点击时的结果快照，避免通知过期或轮询替换导致详情丢失。 */
function handleDetailPasswordSuccess(): void {
  handlePasswordSuccess()
  const log = pendingAnalysis.value
  pendingAnalysis.value = null
  if (log) openAnalysisDetail(log)
}

/** 从详情或通知切换到扫描对应的交易对及周期。 */
function viewAnalysisChart(log: LogEntry): void {
  const symbol = getScanSymbol(log)
  if (!symbol) return
  analysisDetailVisible.value = false
  visible.value = false
  emit('select-symbol', symbol, getScanTimeframe(log))
}

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
const ANALYSIS_NOTIFICATION_DURATION = 8000
/** 每条通知独立记录剩余展示时间，悬停通知区域或打开 AI 详情时暂停。 */
interface AnalysisNotificationTimer {
  remaining: number
  startedAt: number
  timeout?: ReturnType<typeof setTimeout>
  /** 由同一份剩余时间驱动，避免视觉进度与自动关闭时间出现偏差。 */
  progressAnimation?: Animation
}
const notificationTimers = new Map<ReturnType<typeof ElNotification>, AnalysisNotificationTimer>()
let notificationTimersPaused = false
const notificationContainer = ref<HTMLElement | null>(null)
const notificationBottom = ref(16)
let tickerResizeObserver: ResizeObserver | undefined
/** 同一次日志更新发现的新通知构成一批，序号和总数固定，不随关闭通知而变化。 */
interface PendingAnalysisNotification {
  log: LogEntry
  index: number
  total: number
}
const pendingNotifications: PendingAnalysisNotification[] = []
let isCreatingNotifications = false
let notificationsMounted = false
let stopNotificationWatch: (() => void) | undefined

// 详情打开时立即暂停，关闭后还需判断鼠标是否仍悬停在通知区域。
watch([analysisDetailVisible, showPasswordDialog], syncAnalysisNotificationTimers, { flush: 'sync' })

/** 从剩余时间开始计时；禁用组件内置计时器后，统一控制整个通知区域。 */
function startAnalysisNotificationTimer(notification: ReturnType<typeof ElNotification>): void {
  const timer = notificationTimers.get(notification)
  if (!timer || notificationTimersPaused || timer.timeout !== undefined) return
  timer.startedAt = performance.now()
  if (timer.progressAnimation) {
    timer.progressAnimation.currentTime = ANALYSIS_NOTIFICATION_DURATION - timer.remaining
    timer.progressAnimation.play()
  }
  timer.timeout = setTimeout(() => {
    timer.timeout = undefined
    notification.close()
  }, timer.remaining)
}

/** 悬停通知区域或查看 AI 详情时暂停全部通知及对应进度条。 */
function pauseAnalysisNotificationTimers(): void {
  notificationTimersPaused = true
  const now = performance.now()
  for (const timer of notificationTimers.values()) {
    if (timer.timeout === undefined) continue
    clearTimeout(timer.timeout)
    timer.timeout = undefined
    timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt))
    if (timer.progressAnimation) {
      timer.progressAnimation.pause()
      timer.progressAnimation.currentTime = ANALYSIS_NOTIFICATION_DURATION - timer.remaining
    }
  }
}

/** 暂停条件全部解除后继续剩余倒计时，不重置为完整展示时长。 */
function resumeAnalysisNotificationTimers(): void {
  notificationTimersPaused = false
  for (const notification of notificationTimers.keys()) startAnalysisNotificationTimer(notification)
}

/** 仅在当前页面可见且有焦点时允许暂停；切走后即使详情仍打开也继续倒计时。 */
function syncAnalysisNotificationTimers(): void {
  const isPageActive = !document.hidden && document.hasFocus()
  const isHovering = notificationContainer.value?.matches(':hover')
  if (isPageActive && (analysisDetailVisible.value || showPasswordDialog.value || isHovering)) {
    pauseAnalysisNotificationTimers()
  } else {
    resumeAnalysisNotificationTimers()
  }
}

/** 手动关闭、自动关闭和卸载均清理计时器，防止已关闭通知被重复处理。 */
function clearAnalysisNotificationTimer(notification: ReturnType<typeof ElNotification>): void {
  const timer = notificationTimers.get(notification)
  if (timer?.timeout !== undefined) clearTimeout(timer.timeout)
  timer?.progressAnimation?.cancel()
  notificationTimers.delete(notification)
}

/** 优先使用扫描当时保存的周期；旧日志回退到对应策略的主周期，不猜测默认值。 */
function getScanTimeframe(log: LogEntry): string | undefined {
  const strategyId = log.data?.strategyId || getLogSummary(log.message).match(/\[([^\]]+)\]/)?.[1]
  return log.data?.mainTimeframe || strategies.value.find(strategy => strategy.id === strategyId)?.mainTimeframe
}

/** 只提醒未处理的近期 AI 结果；抽屉内看过的结果也标记，避免关闭后补弹。 */
function notifyRecentAnalysis(): void {
  const now = Date.now()
  const batch: LogEntry[] = []
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
    if (!visible.value && getScanSymbol(log)) batch.push(log)
  }
  // 先统计本次新增通知总数再入队，首条通知也能显示完整批次数量。
  pendingNotifications.push(...batch.map((log, index) => ({ log, index: index + 1, total: batch.length })))
  void flushAnalysisNotifications()
}

/** 顺序挂载通知，确保插入新卡片后能按实际高度保持阅读位置。 */
async function flushAnalysisNotifications(): Promise<void> {
  if (isCreatingNotifications) return
  isCreatingNotifications = true
  try {
    while (pendingNotifications.length > 0) {
      // 等待 Teleport 容器和通知的可见状态完成更新。
      await nextTick()
      if (!notificationsMounted || visible.value) {
        pendingNotifications.length = 0
        break
      }
      const notification = pendingNotifications.shift()!
      if (Date.now() - notification.log.timestamp <= 60_000) {
        await showAnalysisNotification(notification)
      }
    }
  } finally {
    isCreatingNotifications = false
  }
}

/** 兼容历史文本日志，新日志优先读取结构化分析字段，缺失值不猜测。 */
async function showAnalysisNotification({ log, index, total }: PendingAnalysisNotification): Promise<void> {
  const container = notificationContainer.value
  if (!container) return
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
  // 普通通知只给方向文字着色，只有满足开仓条件的 SUCCESS 通知才使用方向背景。
  const directionClass = direction === 'LONG' ? 'ai-analysis-long' : direction === 'SHORT' ? 'ai-analysis-short' : ''
  const successClass = log.level === 'SUCCESS' ? 'ai-analysis-success' : ''
  const previousScrollTop = container.scrollTop
  const previousHeight = container.scrollHeight
  const notification = ElNotification({
    appendTo: container,
    type,
    // 内置悬停仅暂停单张卡片且离开后重置时间，改由列表统一维护剩余时长。
    duration: 0,
    customClass: ['ai-analysis-notification', directionClass, successClass].filter(Boolean).join(' '),
    message: h('div', [
      // 方向单独渲染，避免标题整体变色；使用 VNode 保持日志文本安全转义。
      h('div', { class: 'ai-analysis-heading' }, [
        `${symbol} · `,
        h('span', { class: 'ai-analysis-direction' }, direction),
        h('span', {
          class: 'ai-analysis-sequence',
          title: `本批第 ${index} 条，共 ${total} 条`
        }, `${index}/${total}`)
      ]),
      h('div', { class: 'ai-analysis-metrics' }, [
        '评分 ', h('strong', { class: 'ai-analysis-value' }, String(score)),
        ' · 置信度 ', h('strong', { class: 'ai-analysis-value' }, String(confidence)),
        ` · ${strategyId}`
      ]),
      h('div', { class: 'ai-analysis-actions' }, [
        h('button', {
          type: 'button',
          class: 'ai-analysis-action',
          onClick: (event: MouseEvent) => {
            // 详情按钮阻止冒泡，避免同时触发通知主体的 K 线跳转。
            event.stopPropagation()
            openAnalysisDetail(log)
          }
        }, 'AI 详情'),
        h('button', {
          type: 'button',
          class: 'ai-analysis-action',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            viewAnalysisChart(log)
          }
        }, '查看 K 线')
      ]),
      h('div', { class: 'ai-analysis-progress-track', 'aria-hidden': 'true' }, [
        h('div', { class: 'ai-analysis-progress-bar' })
      ])
    ]),
    position: 'bottom-right',
    onClick: () => {
      // 查看图表后保留通知，仍可返回查看详情，关闭交由倒计时和关闭按钮处理。
      viewAnalysisChart(log)
    },
    onClose: () => {
      clearAnalysisNotificationTimer(notification)
      notifications.delete(notification)
    }
  })
  notifications.add(notification)
  const progressBar = container.lastElementChild?.querySelector<HTMLElement>('.ai-analysis-progress-bar')
  const timer: AnalysisNotificationTimer = { remaining: ANALYSIS_NOTIFICATION_DURATION, startedAt: 0 }
  notificationTimers.set(notification, timer)
  // 最新通知排在顶部；用户已向下阅读时，补偿新增卡片占用的高度，避免内容跳动。
  if (container.lastElementChild) container.prepend(container.lastElementChild)
  await nextTick()
  // 动画先停在满格，真正开始、暂停和恢复均由通知倒计时统一控制。
  if (progressBar && notificationTimers.has(notification)) {
    timer.progressAnimation = progressBar.animate(
      [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
      { duration: ANALYSIS_NOTIFICATION_DURATION, easing: 'linear', fill: 'forwards' }
    )
    timer.progressAnimation.pause()
    timer.progressAnimation.currentTime = 0
  }
  container.scrollTop = previousScrollTop > 0
    ? previousScrollTop + container.scrollHeight - previousHeight
    : 0
  syncAnalysisNotificationTimers()
}

/** 通知区域避开底部行情栏，行情栏换行或窗口尺寸变化时同步调整。 */
function updateNotificationBottom(): void {
  notificationBottom.value = Math.ceil(document.querySelector('.market-ticker')?.getBoundingClientRect().height ?? 0) + 16
}

/** 打开日志时撤下通知，避免与抽屉重复展示。 */
function closeAnalysisNotifications(): void {
  pendingNotifications.length = 0
  for (const notification of notifications) {
    clearAnalysisNotificationTimer(notification)
    notification.close()
  }
  notifications.clear()
  notificationTimersPaused = false
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
  window.addEventListener('blur', syncAnalysisNotificationTimers)
  window.addEventListener('focus', syncAnalysisNotificationTimers)
  document.addEventListener('visibilitychange', syncAnalysisNotificationTimers)
  updateNotificationBottom()
  window.addEventListener('resize', updateNotificationBottom)
  const ticker = document.querySelector('.market-ticker')
  if (ticker) {
    tickerResizeObserver = new ResizeObserver(updateNotificationBottom)
    tickerResizeObserver.observe(ticker)
  }
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
  window.removeEventListener('blur', syncAnalysisNotificationTimers)
  window.removeEventListener('focus', syncAnalysisNotificationTimers)
  document.removeEventListener('visibilitychange', syncAnalysisNotificationTimers)
  window.removeEventListener('resize', updateNotificationBottom)
  tickerResizeObserver?.disconnect()
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

.analysis-detail-meta {
  color: var(--text-secondary);
  font-size: 12px;
}

.analysis-detail-summary {
  overflow-wrap: anywhere;
}

.analysis-detail-body {
  max-height: 55vh;
  overflow-y: auto;
  padding: 16px;
  border-radius: 6px;
  background: var(--bg-code-block);
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
/* 使用普通文档流排列卡片，让超出屏幕的通知始终能在容器内部滚动查看。 */
.ai-analysis-notification-list {
  position: fixed;
  right: 16px;
  bottom: var(--notification-bottom, 16px);
  z-index: 2000;
  width: 350px;
  max-width: calc(100vw - 32px);
  max-height: min(80vh, calc(100vh - var(--notification-bottom, 16px) - 16px));
  max-height: min(80dvh, calc(100dvh - var(--notification-bottom, 16px) - 16px));
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior-y: contain;
  overflow-anchor: none;
  /* 隐藏滚动条外观，保留滚轮、触控与键盘滚动能力。 */
  scrollbar-width: none;
}
.ai-analysis-notification-list::-webkit-scrollbar {
  display: none;
}
.ai-analysis-notification-list:empty {
  display: none;
}
.ai-analysis-notification-list > .ai-analysis-notification {
  /* 覆盖 Element Plus 为独立悬浮通知计算的偏移，统一交给滚动容器布局。 */
  position: relative;
  inset: auto !important;
  width: 100%;
  max-width: 100%;
}
.ai-analysis-notification-list > .ai-analysis-notification + .ai-analysis-notification {
  margin-top: 16px;
}
/* 通知挂载到 body，使用全局样式；只让背景透明，保持文字与图标清晰。 */
.ai-analysis-notification {
  /* 使用不透明主题色，让剩余进度与半透明通知背景明显区分。 */
  --ai-analysis-progress-color: var(--el-color-primary);
  width: 350px;
  max-width: calc(100vw - 32px);
  background: color-mix(in srgb, var(--el-bg-color-overlay) 65%, transparent);
  backdrop-filter: blur(8px);
  cursor: pointer;
}
/* 普通通知背景统一，方向颜色仅用于文字；成功通知再扩展到背景、边框和进度条。 */
.ai-analysis-notification.ai-analysis-long {
  --ai-analysis-direction-color: var(--el-color-success);
}
.ai-analysis-notification.ai-analysis-short {
  --ai-analysis-direction-color: var(--el-color-danger);
}
.ai-analysis-notification.ai-analysis-success.ai-analysis-long {
  --ai-analysis-progress-color: var(--el-color-success);
  background: color-mix(in srgb, var(--el-color-success) 25%, var(--el-bg-color-overlay) 75%);
  border-color: var(--el-color-success);
}
.ai-analysis-notification.ai-analysis-success.ai-analysis-short {
  --ai-analysis-progress-color: var(--el-color-danger);
  background: color-mix(in srgb, var(--el-color-danger) 25%, var(--el-bg-color-overlay) 75%);
  border-color: var(--el-color-danger);
}
.ai-analysis-notification .el-notification__group {
  flex: 1;
  min-width: 0;
}
.ai-analysis-heading {
  color: var(--el-text-color-primary);
  font-weight: 700;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.ai-analysis-direction {
  color: var(--ai-analysis-direction-color, var(--el-text-color-secondary));
}
.ai-analysis-sequence {
  display: inline-block;
  margin-left: 8px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ai-analysis-metrics {
  margin-top: 4px;
}
.ai-analysis-value {
  color: var(--el-color-primary);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.ai-analysis-notification .el-notification__content {
  margin-top: 0;
  font-size: 12px;
  text-align: left;
}
/* 贴在卡片底部，不占用正文空间，也不拦截原有操作按钮。 */
.ai-analysis-progress-track {
  position: absolute;
  inset: auto 0 0;
  height: 3px;
  background: color-mix(in srgb, var(--el-text-color-primary) 18%, var(--el-bg-color-overlay));
  pointer-events: none;
}
.ai-analysis-progress-bar {
  width: 100%;
  height: 100%;
  background: var(--ai-analysis-progress-color);
  transform-origin: left center;
}
.ai-analysis-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 8px;
}
.ai-analysis-action {
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  font: inherit;
  cursor: pointer;
  text-decoration: none;
}
.ai-analysis-action:hover {
  text-decoration: underline;
}
.ai-analysis-action:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
