<!-- 机器人配置对话框 -->
<template>
  <div>
    <!-- 密码验证对话框 -->
    <PasswordDialog v-model="showPasswordDialog" @success="handlePasswordSuccess" />
    
    <!-- 配置编辑对话框 -->
    <el-dialog
      v-model="showConfigDialog"
      title="⚙️ 机器人配置"
      width="80%"
      :fullscreen="isMobile"
      :close-on-click-modal="false"
      @closed="handleClosed"
    >
      <div v-loading="loading" class="config-container">
        <el-form v-if="form" :model="form" :label-width="isMobile ? '150px' : '180px'">
          <!-- 交易对配置 -->
          <el-divider content-position="left">交易对配置</el-divider>
          <el-form-item label="交易对列表">
            <el-select
              v-model="form.symbols"
              multiple
              filterable
              allow-create
              placeholder="选择或输入交易对"
              style="width: 180px"
            >
              <el-option
                v-for="symbol in availableSymbols"
                :key="symbol"
                :label="symbol"
                :value="symbol"
              />
            </el-select>
          </el-form-item>

          <!-- 指标配置 -->
          <el-divider content-position="left">指标配置</el-divider>
          <el-form-item label="所需K线数量">
            <el-input-number v-model="form.indicatorsConfig.requiredCandles" :min="100" :max="5000" />
          </el-form-item>
          <el-form-item label="ADX斜率周期">
            <el-input-number v-model="form.indicatorsConfig.adxSlopePeriod" :min="1" :max="20" />
          </el-form-item>
          <el-form-item label="EMA斜率周期">
            <el-input-number v-model="form.indicatorsConfig.emaSlopePeriod" :min="1" :max="20" />
          </el-form-item>

          <!-- EMA配置 -->
          <el-divider content-position="left">EMA配置</el-divider>
          <el-form-item label="快速EMA周期">
            <el-input-number v-model="form.emaPeriods[0]" :min="1" :max="100" />
          </el-form-item>
          <el-form-item label="慢速EMA周期">
            <el-input-number v-model="form.emaPeriods[1]" :min="1" :max="500" />
          </el-form-item>
          <el-form-item label="成交量EMA周期">
            <el-input-number v-model="form.volumeEmaPeriod" :min="1" :max="30" />
          </el-form-item>

          <!-- AI分析配置 -->
          <el-divider content-position="left">AI分析日志配置</el-divider>
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
          <el-form-item label="启用历史分析经验">
            <el-switch v-model="form.aiAnalysisConfig.enableHistorySection" />
            <span style="margin-left: 8px; font-size: 12px; color: #909399;">在系统提示词中包含历史分析经验</span>
          </el-form-item>

          <el-divider content-position="left">交易规则配置</el-divider>
          <el-form-item label="默认K线周期">
            <el-select v-model="form.defaultTimeframe" style="width: 180px">
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
          <el-form-item label="手续费率">
            <el-input-number v-model="form.commissionRate" :min="0" :max="0.1" :step="0.0001" />
          </el-form-item>
          <el-form-item label="持仓监控间隔(秒)">
            <el-input-number v-model="form.monitorInterval" :min="1" :max="600" :step="1" />
          </el-form-item>

          <!-- 图表标记控制配置 -->
          <el-divider content-position="left">图表标记控制</el-divider>
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

          <!-- 并发池配置 -->
          <el-divider content-position="left">并发池配置</el-divider>
          <template v-if="form.concurrencyPool">
            <el-form-item label="指标计算并发数">
              <el-input-number v-model="form.concurrencyPool.indicator.maxConcurrency" :min="1" :max="64" :step="1" />
            </el-form-item>
            <el-form-item label="AI分析并发数">
              <el-input-number v-model="form.concurrencyPool.ai.maxConcurrency" :min="1" :max="32" :step="1" />
            </el-form-item>
            <el-form-item label="交易API并发数">
              <el-input-number v-model="form.concurrencyPool.tradeApi.maxConcurrency" :min="1" :max="16" :step="1" />
            </el-form-item>
          </template>
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
const loading = ref(false)
const saving = ref(false)
const authenticated = ref(false)
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)

const isMobile = computed(() => windowWidth.value < 768)

const form = ref<BotConfig | null>(null)

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
  
  saving.value = true
  try {
    const res = await $fetch<any>('/api/bot/config', {
      method: 'POST',
      body: { config: form.value }
    })
    
    if (res.success) {
      emit('success')
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
  max-height: 60vh;
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

@media (max-width: 768px) {
  .config-container {
    max-height: 70vh;
    padding-right: 5px;
  }
}
</style>
