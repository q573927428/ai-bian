<!-- 机器人配置对话框 -->
<template>
  <div>
    <!-- 密码验证对话框 -->
    <PasswordDialog v-model="showPasswordDialog" @success="handlePasswordSuccess" />
    
    <!-- 热门交易对对话框 -->
    <TopSymbolsTable v-model="showTopSymbolsDialog" @select="handleTopSymbolSelect" />
    
    <!-- 配置编辑对话框 -->
    <el-dialog
      v-model="showConfigDialog"
      title="⚙️ 机器人配置"
      width="70%"
      :fullscreen="isMobile"
      :close-on-click-modal="false"
      @closed="handleClosed"
    >
      <div v-loading="loading" class="config-container">
        <el-form v-if="form" :model="form" :label-width="isMobile ? '120px' : '130px'" label-position="left">
          <!-- ============ 交易对配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">1. 交易对配置</el-divider>
            <div class="config-grid">
              <el-form-item label="交易对列表" class="grid-full">
                <div class="symbol-select-wrap">
                  <el-select
                    v-model="form.symbols"
                    multiple
                    filterable
                    allow-create
                    placeholder="选择或输入交易对"
                    style="width: 100%"
                  >
                    <el-option
                      v-for="symbol in availableSymbols"
                      :key="symbol"
                      :label="symbol"
                      :value="symbol"
                    />
                  </el-select>
                  <el-button type="warning" size="small" @click="showTopSymbolsDialog = true" class="hot-btn">
                    🔥 添加
                  </el-button>
                </div>
              </el-form-item>
            </div>
          </div>

          <!-- ============ K线周期配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">2. K线周期配置</el-divider>
            <div class="config-grid">
              <el-form-item label="默认K线周期">
                <el-select v-model="form.defaultTimeframe" style="width: 140px">
                  <el-option label="5分钟" value="5m" />
                  <el-option label="15分钟" value="15m" />
                  <el-option label="1小时" value="1h" />
                  <el-option label="4小时" value="4h" />
                  <el-option label="1天" value="1d" />
                  <el-option label="1周" value="1w" />
                </el-select>
              </el-form-item>
              <el-form-item label="默认K线进度">
                <el-input-number v-model="form.defaultCandleProgress" :min="0" :max="1" :step="0.05" />
              </el-form-item>
            </div>
          </div>

          <!-- ============ 指标配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">3. 指标配置</el-divider>
            <div class="config-grid">
              <el-form-item label="所需K线数量">
                <el-input-number v-model="form.indicatorsConfig.requiredCandles" :min="100" :max="5000" />
              </el-form-item>
              <el-form-item label="ADX斜率周期">
                <el-input-number v-model="form.indicatorsConfig.adxSlopePeriod" :min="1" :max="20" />
              </el-form-item>
              <el-form-item label="EMA斜率周期">
                <el-input-number v-model="form.indicatorsConfig.emaSlopePeriod" :min="1" :max="20" />
              </el-form-item>
            </div>
          </div>

          <!-- ============ EMA配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">4. EMA配置</el-divider>
            <div class="config-grid">
              <el-form-item label="快速EMA周期">
                <el-input-number v-model="form.emaPeriods[0]" :min="1" :max="100" />
              </el-form-item>
              <el-form-item label="慢速EMA周期">
                <el-input-number v-model="form.emaPeriods[1]" :min="1" :max="500" />
              </el-form-item>
              <el-form-item label="成交量EMA周期">
                <el-input-number v-model="form.volumeEmaPeriod" :min="1" :max="30" />
              </el-form-item>
            </div>
          </div>

          <!-- ============ 交易规则配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">5. 交易规则配置</el-divider>
            <div class="config-grid">
              <el-form-item label="手续费率">
                <el-input-number v-model="form.commissionRate" :min="0" :max="0.1" :step="0.0001" />
              </el-form-item>
              <el-form-item label="持仓监控间隔(秒)">
                <el-input-number v-model="form.monitorInterval" :min="1" :max="600" :step="1" />
              </el-form-item>
              <el-form-item label="初始本金 (USDT)" class="hint-wrap">
                <el-input-number v-model="form.initialCapital" :min="0" :step="100" :precision="2" />
                <div class="hint-text">用于年化收益率计算</div>
              </el-form-item>
            </div>
          </div>

          <!-- ============ 策略调度器配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">6. 策略调度器配置</el-divider>
            <div class="config-grid">
              <template v-if="form.strategyScheduler">
                <el-form-item label="每批交易对数量">
                  <el-input-number v-model="form.strategyScheduler.symbolBatchSize" :min="1" :max="20" />
                </el-form-item>
                <el-form-item label="批次间延迟(ms)">
                  <el-input-number v-model="form.strategyScheduler.symbolBatchDelayMs" :min="1000" :max="30000" :step="500" />
                </el-form-item>
                <el-form-item label="循环最大耗时(ms)">
                  <el-input-number v-model="form.strategyScheduler.maxLoopDurationMs" :min="30000" :max="600000" :step="10000" />
                </el-form-item>
              </template>
            </div>
          </div>

          <!-- ============ 并发池配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">7. 并发池配置</el-divider>
            <div class="config-grid">
              <template v-if="form.concurrencyPool">
                <el-form-item label="指标计算并发数">
                  <el-input-number v-model="form.concurrencyPool.indicator.maxConcurrency" :min="1" :max="64" :step="1" />
                </el-form-item>
                <el-form-item label="交易API并发数">
                  <el-input-number v-model="form.concurrencyPool.tradeApi.maxConcurrency" :min="1" :max="16" :step="1" />
                </el-form-item>
              </template>
            </div>
          </div>

          <!-- ============ AI限流配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">8. AI限流配置</el-divider>
            <div class="config-grid">
              <template v-if="form.aiRateLimit">
                <el-form-item label="最大并发数">
                  <el-input-number v-model="form.aiRateLimit.maxConcurrent" :min="1" :max="16" />
                </el-form-item>
                <el-form-item label="每分钟最大请求数">
                  <el-input-number v-model="form.aiRateLimit.maxRequestsPerMinute" :min="1" :max="120" />
                </el-form-item>
                <el-form-item label="每次扫描最大请求数">
                  <el-input-number v-model="form.aiRateLimit.maxRequestsPerScan" :min="1" :max="200" />
                </el-form-item>
                <el-form-item label="请求超时(ms)">
                  <el-input-number v-model="form.aiRateLimit.timeoutMs" :min="5000" :max="120000" :step="5000" />
                </el-form-item>
                <el-form-item label="错误后冷却(ms)">
                  <el-input-number v-model="form.aiRateLimit.cooldownAfterErrorMs" :min="5000" :max="300000" :step="5000" />
                </el-form-item>
              </template>
            </div>
          </div>

          <!-- ============ 币安API限频配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">9. 币安API限频配置</el-divider>
            <div class="config-grid">
              <template v-if="form.binanceRateLimit">
                <el-form-item label="行情数据并发数">
                  <el-input-number v-model="form.binanceRateLimit.marketDataConcurrency" :min="1" :max="10" />
                </el-form-item>
                <el-form-item label="账户查询并发数">
                  <el-input-number v-model="form.binanceRateLimit.accountConcurrency" :min="1" :max="5" />
                </el-form-item>
                <el-form-item label="交易API并发数">
                  <el-input-number v-model="form.binanceRateLimit.tradeConcurrency" :min="1" :max="5" />
                </el-form-item>
                <el-form-item label="权重使用率上限">
                  <el-input-number v-model="form.binanceRateLimit.maxUsedWeight1mRatio" :min="0.1" :max="1" :step="0.05" />
                </el-form-item>
                <el-form-item label="重试基时(ms)">
                  <el-input-number v-model="form.binanceRateLimit.retryBaseMs" :min="100" :max="10000" :step="100" />
                </el-form-item>
                <el-form-item label="重试最大间隔(ms)">
                  <el-input-number v-model="form.binanceRateLimit.retryMaxMs" :min="1000" :max="300000" :step="1000" />
                </el-form-item>
              </template>
            </div>
          </div>

          <!-- ============ AI分析日志配置 ============ -->
          <div class="config-section">
            <el-divider content-position="left">10. AI分析日志配置</el-divider>
            <div class="config-grid">
              <el-form-item label="启用AI分析日志">
                <el-switch v-model="form.aiAnalysisConfig.enabled" />
              </el-form-item>
              <el-form-item label="AI缓存TTL(分钟)">
                <el-input-number v-model="form.aiCacheTtlMinutes" :min="1" :max="60" />
              </el-form-item>
              <el-form-item label="最大缓存记录数">
                <el-input-number v-model="form.aiAnalysisConfig.maxRecords" :min="100" :max="10000" />
              </el-form-item>
              <el-form-item label="保存空闲状态">
                <el-switch v-model="form.aiAnalysisConfig.saveIdle" />
              </el-form-item>
              <el-form-item label="最低置信度(AI)">
                <el-input-number v-model="form.aiAnalysisConfig.minConfidence" :min="0" :max="100" />
              </el-form-item>
              <el-form-item label="启用历史分析经验" class="grid-full">
                <el-switch v-model="form.aiAnalysisConfig.enableHistorySection" />
                <span style="margin-left: 8px; font-size: 12px; color: #909399;">在系统提示词中包含历史分析经验</span>
              </el-form-item>
            </div>
          </div>

          <!-- ============ 图表标记控制 ============ -->
          <div class="config-section">
            <el-divider content-position="left">11. 图表标记控制</el-divider>
            <div class="config-grid">
              <template v-if="form.chartMarkerConfig">
                <el-form-item label="显示EMA金叉死叉标记">
                  <el-switch v-model="form.chartMarkerConfig.showEMAMarkers" />
                </el-form-item>
                <el-form-item label="显示历史订单标记">
                  <el-switch v-model="form.chartMarkerConfig.showOrderMarkers" />
                </el-form-item>
                <el-form-item label="显示EMA快慢线">
                  <el-switch v-model="form.chartMarkerConfig.showEMALines" />
                </el-form-item>
              </template>
            </div>
          </div>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving" :disabled="!form">保存配置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { BotConfig } from '../../types'
import { useBotStore } from '../stores/bot'
import PasswordDialog from './PasswordDialog.vue'
import TopSymbolsTable from './TopSymbolsTable.vue'

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'success'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const showPasswordDialog = ref(false)
const showConfigDialog = ref(false)
const showTopSymbolsDialog = ref(false)
const loading = ref(false)
const saving = ref(false)
const authenticated = ref(false)
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

const isMobile = computed(() => windowWidth.value < 768)

const form = ref<BotConfig | null>(null)
const originalSymbols = ref<string[]>([]) // 记录打开配置前的 symbols，用于检测新增

const availableSymbols = computed(() => {
  if (!form.value) return []
  // 直接从配置文件中读取交易对列表
  return Array.from(new Set(form.value.symbols))
})

// 加载配置
const loadConfig = async () => {
  loading.value = true
  try {
    const res = await $fetch<any>('/api/bot/config')
    if (res.success && res.data) {
      const config = JSON.parse(JSON.stringify(res.data))
      
      // 确保 emaPeriods 存在且是数组
      if (!config.emaPeriods || !Array.isArray(config.emaPeriods)) {
        config.emaPeriods = [20, 200]
      }
      
      form.value = config
      originalSymbols.value = [...(config.symbols || [])]
    }
  } catch (error: any) {
    console.error('加载配置失败:', error)
  } finally {
    loading.value = false
  }
}

// 密码验证成功
const handlePasswordSuccess = async () => {
  authenticated.value = true
  await loadConfig()
  showConfigDialog.value = true
}

// 保存配置
const handleSave = async () => {
  if (!form.value) return
  
  // 确保 emaPeriods 是正确的格式
  if (!form.value.emaPeriods || !Array.isArray(form.value.emaPeriods)) {
    form.value.emaPeriods = [20, 200]
  }
  
  // AI并发同步：以 AI限流配置 的最大并发数为准，同步到并发池配置
  if (form.value.aiRateLimit && form.value.concurrencyPool?.ai) {
    form.value.concurrencyPool.ai.maxConcurrency = form.value.aiRateLimit.maxConcurrent
  }

  saving.value = true
  try {
    const res = await $fetch<any>('/api/bot/config', {
      method: 'POST',
      body: { config: form.value }
    })
    
    if (res.success) {
      emit('success')

      // 检测交易对变化，自动触发热重载（新增+删除）
      const currentSymbols: string[] = form.value.symbols || []
      const addedSymbols = currentSymbols.filter(
        (s: string) => !originalSymbols.value.includes(s)
      )
      const removedSymbols = originalSymbols.value.filter(
        (s: string) => !currentSymbols.includes(s)
      )

      if (addedSymbols.length > 0 || removedSymbols.length > 0) {
        try {
          // 配置已先保存，服务端再读取配置会拿到新列表；这里直接传递本次增删量。
          const reloadRes = await $fetch<any>('/api/bot/reload-symbols', {
            method: 'POST',
            body: {
              added: addedSymbols,
              removed: removedSymbols
            }
          })
          if (reloadRes.success) {
            const parts: string[] = []
            if (reloadRes.added?.length > 0) parts.push(`新增 ${reloadRes.added.length} 个`)
            if (reloadRes.removed?.length > 0) parts.push(`移除 ${reloadRes.removed.length} 个`)
            if (reloadRes.blockedByPosition?.length > 0) {
              parts.push(`因持仓阻止删除 ${reloadRes.blockedByPosition.length} 个: ${reloadRes.blockedByPosition.join(', ')}`)
            }
            
            const message = parts.length > 0
              ? `${parts.join('，')}，无需重启服务`
              : '配置已保存，交易对列表已是最新，无需重启服务'

            if (reloadRes.blockedByPosition?.length > 0) {
              ElMessage.warning(message)
            } else {
              ElMessage.success(message)
            }
          }
        } catch (e: any) {
          console.error('热重载交易对失败:', e)
        }
      }

      showConfigDialog.value = false
      visible.value = false
      // 刷新botStore中的配置，使图表等组件同步更新
      const botStore = useBotStore()
      await botStore.fetchBotConfig()
    } else {
      console.error('保存配置失败:', res.message)
    }
  } catch (error: any) {
    console.error('保存配置失败:', error)
  } finally {
    saving.value = false
  }
}

// 从热门交易对列表中选择交易对
const handleTopSymbolSelect = (symbol: string) => {
  // 统一格式：API 返回 ETHUSDT，转换为 EL 选择器兼容的格式
  const normalized = symbol.replace('USDT', '/USDT')
  if (form.value && !form.value.symbols.includes(normalized)) {
    form.value.symbols.push(normalized)
    ElMessage.success(`已添加 ${normalized}`)
  } else {
    ElMessage.info('该交易对已存在')
  }
}

const handleCancel = () => {
  showConfigDialog.value = false
}

const handleClosed = () => {
  authenticated.value = false
  showConfigDialog.value = false
  visible.value = false
}

watch(visible, (newVal) => {
  if (newVal) {
    if (!authenticated.value) {
      // 先显示密码对话框
      showPasswordDialog.value = true
    } else {
      loadConfig()
      showConfigDialog.value = true
    }
  }
})

watch(showPasswordDialog, (newVal) => {
  // 如果密码对话框关闭且未认证，则关闭配置对话框
  if (!newVal && !authenticated.value) {
    visible.value = false
  }
})

const handleResize = () => {
  if (typeof window !== 'undefined') {
    windowWidth.value = window.innerWidth
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleResize)
  }
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleResize)
  }
})
</script>

<style scoped>
.config-container {
  max-height: 65vh;
  overflow-y: auto;
  padding-right: 10px;
}

.config-container::-webkit-scrollbar {
  width: 6px;
}

.config-container::-webkit-scrollbar-thumb {
  background: var(--text-placeholder);
  border-radius: 3px;
}

.config-container::-webkit-scrollbar-track {
  background: var(--bg-main);
}

/* 配置区块容器 */
.config-section {
  margin-bottom: 8px;
}

/* 三列网格布局 */
.config-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0 12px;
}

/* 占满整行的表单项（如交易对选择器、带长说明的项） */
.config-grid .grid-full {
  grid-column: 1 / -1;
}

/* 交易对选择器 + 热门按钮横向排列 */
.symbol-select-wrap {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  width: 100%;
}

.symbol-select-wrap .el-select {
  flex: 1;
}

.hot-btn {
  flex-shrink: 0;
  margin-top: 2px;
}

/* 数字输入框自适应宽度，不拉伸 */
.config-grid :deep(.el-input-number) {
  width: auto;
}

/* hint文字换行显示 */
.config-grid .hint-wrap :deep(.el-form-item__content) {
  flex-wrap: wrap;
  gap: 2px;
}
.config-grid .hint-text {
  width: 100%;
  font-size: 11px;
  color: #909399;
  line-height: 1.3;
}

/* 移动端：单列 */
@media (max-width: 768px) {
  .config-container {
    max-height: 80vh;
    padding-right: 5px;
  }

  .config-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
