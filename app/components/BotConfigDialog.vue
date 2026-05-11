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

          <!-- AI预筛配置 -->
          <el-divider content-position="left">AI预筛配置</el-divider>
          <template v-if="form.preScreenConfig">
            <el-form-item label="启用ADX筛选">
              <el-switch v-model="form.preScreenConfig.enableAdx" />
            </el-form-item>
            <el-form-item label="ADX最小阈值" v-if="form.preScreenConfig.enableAdx">
              <el-input-number v-model="form.preScreenConfig.minAdx" :min="0" :max="100" :step="1" />
            </el-form-item>
            <el-form-item label="ADX最大阈值" v-if="form.preScreenConfig.enableAdx">
              <el-input-number v-model="form.preScreenConfig.maxAdx" :min="0" :max="100" :step="1" />
            </el-form-item>
            <el-form-item label="启用ADX斜率筛选">
              <el-switch v-model="form.preScreenConfig.enableAdxSlope" />
            </el-form-item>
            <el-form-item label="ADX斜率最小阈值" v-if="form.preScreenConfig.enableAdxSlope">
              <el-input-number v-model="form.preScreenConfig.minAdxSlope" :min="-10" :max="10" :step="0.01" />
            </el-form-item>
            <el-form-item label="启用ATR筛选">
              <el-switch v-model="form.preScreenConfig.enableAtr" />
            </el-form-item>
            <el-form-item label="ATR最小波动率" v-if="form.preScreenConfig.enableAtr">
              <el-input-number v-model="form.preScreenConfig.minAtrPercent" :min="0" :max="0.1" :step="0.0001" />
            </el-form-item>
            <el-form-item label="ATR最大波动率" v-if="form.preScreenConfig.enableAtr">
              <el-input-number v-model="form.preScreenConfig.maxAtrPercent" :min="0" :max="0.5" :step="0.001" />
            </el-form-item>
            <el-form-item label="启用成交量筛选">
              <el-switch v-model="form.preScreenConfig.enableVolume" />
            </el-form-item>
            <el-form-item label="预估成交量比率" v-if="form.preScreenConfig.enableVolume">
              <el-input-number v-model="form.preScreenConfig.minEstimatedVolumeRatio" :min="0" :max="2" :step="0.05" />
            </el-form-item>
            <el-form-item label="K线进度阈值检查" v-if="form.preScreenConfig.enableVolume">
              <el-input-number v-model="form.preScreenConfig.minCandleProgressForVolume" :min="0" :max="1" :step="0.05" />
            </el-form-item>
          </template>

          <!-- 交易规则配置 -->
          <el-divider content-position="left">交易规则配置</el-divider>
          <el-form-item label="最低置信度">
            <el-input-number v-model="form.minConfidence" :min="0" :max="100" />
          </el-form-item>
          <el-form-item label="最低最终评分">
            <el-input-number v-model="form.minFinalScore" :min="0" :max="100" />
          </el-form-item>
          <el-form-item label="最大风险等级">
            <el-select v-model="form.maxRiskLevel" style="width: 180px">
              <el-option label="低" value="LOW" />
              <el-option label="中" value="MEDIUM" />
              <el-option label="高" value="HIGH" />
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
  const defaultSymbols = [
    'BTC/USDT',
    'ETH/USDT',
    'SOL/USDT',
    'DOGE/USDT',
    'HYPE/USDT',
    'XAU/USDT',
    'XAG/USDT',
    'BNB/USDT'
  ]
  if (!form.value) return defaultSymbols
  // 合并默认交易对和配置文件里的交易对，去重
  const allSymbols = new Set([...defaultSymbols, ...form.value.symbols])
  return Array.from(allSymbols)
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
  background: #d0d0d0;
  border-radius: 3px;
}

.config-container::-webkit-scrollbar-track {
  background: #f5f5f5;
}

@media (max-width: 768px) {
  .config-container {
    max-height: 70vh;
    padding-right: 5px;
  }
}
</style>
