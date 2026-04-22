<!-- 策略编辑器组件 -->
<template>
  <div class="strategy-editor">
    <el-form :model="form" label-width="120px">
      <!-- 基础信息 -->
      <el-card class="form-section">
        <template #header>
          <div class="section-header">
            <el-icon><ElIconDocument /></el-icon>
            <span>基础信息</span>
          </div>
        </template>
        <el-form-item label="策略名称">
          <el-input v-model="form.name" placeholder="请输入策略名称" />
        </el-form-item>
      </el-card>

      <!-- 市场数据配置 -->
      <el-card class="form-section">
        <template #header>
          <div class="section-header">
            <el-icon><ElIconTrendCharts /></el-icon>
            <span>1. 市场数据配置</span>
          </div>
        </template>
        <el-form-item label="交易对">
          <el-select
            v-model="form.marketData.symbols"
            multiple
            filterable
            allow-create
            placeholder="选择或输入交易对"
            style="width: 100%"
          >
            <el-option label="BTC/USDT" value="BTC/USDT" />
            <el-option label="ETH/USDT" value="ETH/USDT" />
            <el-option label="SOL/USDT" value="SOL/USDT" />
            <el-option label="DOGE/USDT" value="DOGE/USDT" />
            <el-option label="HYPE/USDT" value="HYPE/USDT" />
            <el-option label="XAU/USDT" value="XAU/USDT" />
            <el-option label="XAG/USDT" value="XAG/USDT" />
            <el-option label="BNB/USDT" value="BNB/USDT" />
          </el-select>
        </el-form-item>
         <el-form-item label="K线周期">
           <el-checkbox-group 
             v-model="form.marketData.timeframes" 
             :min="1" 
             :max="3"
           >
             <el-checkbox label="5m">5分钟</el-checkbox>
             <el-checkbox label="15m">15分钟</el-checkbox>
             <el-checkbox label="1h">1小时</el-checkbox>
             <el-checkbox label="4h">4小时</el-checkbox>
             <el-checkbox label="1d">1天</el-checkbox>
           </el-checkbox-group>
         </el-form-item>
      </el-card>

      <!-- 技术指标配置 -->
      <el-card class="form-section">
        <template #header>
          <div class="section-header">
            <el-icon><ElIconDataLine /></el-icon>
            <span>2. 技术指标配置</span>
          </div>
        </template>

        <el-form-item label="选择指标">
          <el-checkbox-group v-model="selectedIndicators">
            <el-checkbox label="EMA" disabled>EMA</el-checkbox>
            <el-checkbox label="RSI">RSI (14)</el-checkbox>
            <el-checkbox label="ADX" disabled>ADX (14)</el-checkbox>
            <el-checkbox label="MACD">MACD (12,26,9)</el-checkbox>
            <el-checkbox label="ATR">ATR (14)</el-checkbox>
          </el-checkbox-group>
        </el-form-item>

        <el-form-item label="EMA 周期" v-if="selectedIndicators.includes('EMA')">
          <el-checkbox-group v-model="emaPeriods" :min="2" :max="3">
            <el-checkbox :label="7">7</el-checkbox>
            <el-checkbox :label="14">14</el-checkbox>
            <el-checkbox :label="20">20</el-checkbox>
            <el-checkbox :label="30">30</el-checkbox>
            <el-checkbox :label="50">50</el-checkbox>
            <el-checkbox :label="60">60</el-checkbox>
            <el-checkbox :label="120">120</el-checkbox>
            <el-checkbox :label="200">200</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-card>

      <!-- 统计数据配置 -->
      <el-card class="form-section">
        <template #header>
          <div class="section-header">
            <el-icon><ElIconDataBoard /></el-icon>
            <span>3. 统计数据配置</span>
          </div>
        </template>
        <el-form-item label="选择数据">
          <el-checkbox-group v-model="selectedStatistics">
            <el-checkbox label="OI">OI 持仓量</el-checkbox>
            <el-checkbox label="Volume">成交量</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-card>

      <!-- AI 交易逻辑提示词 -->
      <el-card class="form-section">
        <template #header>
          <div class="section-header">
            <el-icon><ElIconChatDotRound /></el-icon>
            <span>4. AI 交易逻辑提示词</span>
          </div>
        </template>
        <el-form-item label="用户交易逻辑">
          <el-input
            v-model="form.aiPrompt.userPrompt"
            type="textarea"
            :rows="12"
            placeholder="当EMA金叉且RSI<30时，开多仓..."
          />
        </el-form-item>
         <el-row :gutter="20">
           <el-col :span="6">
             <el-form-item label="AI提供商">
               <el-select v-model="form.aiPrompt.provider" @change="handleProviderChange">
                 <el-option 
                   v-for="provider in availableProviderOptions" 
                   :key="provider.value" 
                   :label="provider.label" 
                   :value="provider.value" 
                 />
               </el-select>
             </el-form-item>
           </el-col>
           <el-col :span="6">
             <el-form-item label="AI模型">
               <el-select v-model="form.aiPrompt.model">
                 <el-option v-for="model in availableModels" :key="model.value" :label="model.label" :value="model.value" />
               </el-select>
             </el-form-item>
           </el-col>
           <el-col :span="6">
             <el-form-item label="温度">
               <el-slider v-model="form.aiPrompt.temperature" :min="0" :max="1" :step="0.1" />
             </el-form-item>
           </el-col>
           <el-col :span="6">
             <el-form-item label="最大Token">
               <el-input-number v-model="form.aiPrompt.maxTokens" :min="500" :max="4000" :step="500" />
             </el-form-item>
           </el-col>
         </el-row>
      </el-card>

      <!-- 风险管理配置 -->
      <el-card class="form-section">
        <template #header>
          <div class="section-header">
            <el-icon><ElIconWarning /></el-icon>
            <span>5. 风险管理配置</span>
          </div>
        </template>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="单笔风险(%)">
              <el-input-number v-model="form.riskManagement.maxRiskPercentage" :min="1" :max="50" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="止损ATR倍数">
              <el-input-number v-model="form.riskManagement.stopLossATRMultiplier" :min="1" :max="5" :step="0.5" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="每日最大交易">
              <el-input-number v-model="form.riskManagement.maxDailyTrades" :min="1" :max="20" />
            </el-form-item>
          </el-col>
        </el-row>
        
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="TP1止盈">
              <el-input-number v-model="form.riskManagement.takeProfitRatios[0]" :min="1" :max="10" :step="0.5" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="TP2止盈">
              <el-input-number v-model="form.riskManagement.takeProfitRatios[1]" :min="1" :max="10" :step="0.5" />
            </el-form-item>
          </el-col>
        </el-row>
        
        <el-form-item label="移动止损">
          <el-switch v-model="form.riskManagement.trailingStop.enabled" />
          <span class="stat-label">激活: </span>
          <el-input-number v-model="form.riskManagement.trailingStop.activationRatio" :min="0.5" :max="3" :step="0.5" />
          <span class="stat-label">R, 距离: </span>
          <el-input-number v-model="form.riskManagement.trailingStop.trailDistance" :min="0.5" :max="3" :step="0.1" />
          <span class="stat-label">ATR</span>
        </el-form-item>
        
        <el-form-item label="持仓超时">
          <el-input-number v-model="form.riskManagement.maxHoldTimeMinutes" :min="60" :max="10080" :step="60" />
          <span class="stat-label">分钟 (默认1440分=24小时)</span>
        </el-form-item>
      </el-card>

      <!-- 执行配置 -->
      <el-card class="form-section">
        <template #header>
          <div class="section-header">
            <el-icon><ElIconSetting /></el-icon>
            <span>6. 执行配置</span>
          </div>
        </template>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="扫描间隔(秒)">
              <el-input-number v-model="form.executionConfig.scanInterval" :min="600" :max="6000" :step="60" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="杠杆">
              <el-select v-model="form.executionConfig.leverage">
                <el-option label="动态" value="dynamic" />
                <el-option label="2" :value="2" />
                <el-option label="3" :value="3" />
                <el-option label="5" :value="5" />
                <el-option label="10" :value="10" />
                <el-option label="20" :value="20" />
                <el-option label="50" :value="50" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="保证金模式">
              <el-select v-model="form.executionConfig.marginMode">
                <el-option label="全仓" value="cross" />
                <el-option label="逐仓" value="isolated" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-card>

      <!-- 操作按钮 -->
      <div class="form-actions">
        <el-button @click="$emit('cancel')">取消</el-button>
        <el-button type="primary" @click="handleSave" :loading="saving">
          保存策略
        </el-button>
      </div>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import type { Strategy, CreateStrategyInput } from '../../types/strategy'

const props = defineProps<{
  strategy?: Strategy | null
}>()

const emit = defineEmits<{
  save: [data: any]
  cancel: []
}>()

const saving = ref(false)

// 已配置的 AI 提供商列表
const configuredProviders = ref<Array<{ id: string; name: string; configured: boolean }>>([])

// AI 提供商模型配置
const providerModels: Record<string, Array<{ label: string; value: string }>> = {
  deepseek: [
    { label: 'deepseek-chat', value: 'deepseek-chat' },
    { label: 'deepseek-reasoner', value: 'deepseek-reasoner' }
  ],
  doubao: [
    { label: 'doubao-seed-2-0-pro', value: 'doubao-seed-2-0-pro' },
    { label: 'doubao-seed-2-0-lite', value: 'doubao-seed-2-0-lite' },
    { label: 'doubao-seed-2-0-code', value: 'doubao-seed-2-0-code' }
  ],
  qwen: [
    { label: 'qwen-plus', value: 'qwen-plus' },
    { label: 'qwen-turbo', value: 'qwen-turbo' },
    { label: 'qwen-max', value: 'qwen-max' }
  ],
  openai: [
    { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
    { label: 'gpt-4o', value: 'gpt-4o' },
    { label: 'gpt-3.5-turbo', value: 'gpt-3.5-turbo' }
  ]
}

// 已配置的提供商选项
const availableProviderOptions = computed(() => {
  return configuredProviders.value
    .filter(p => p.configured)
    .map(p => ({ label: p.name, value: p.id }))
})

// 当前可用模型
const availableModels = computed(() => {
  return providerModels[form.aiPrompt.provider] || []
})

// 处理提供商变更
const handleProviderChange = (provider: string) => {
  const models = providerModels[provider]
  if (models && models.length > 0 && models[0]) {
    form.aiPrompt.model = models[0].value
  }
}

// 获取已配置的 AI 提供商
const fetchConfiguredProviders = async () => {
  try {
    const response = await $fetch<{
      success: boolean
      data: Array<{ id: string; name: string; configured: boolean }>
    }>('/api/ai/providers')
    
    if (response.success) {
      configuredProviders.value = response.data
      
      // 确保当前选择的提供商是已配置的
      const currentProvider = configuredProviders.value.find(p => p.id === form.aiPrompt.provider)
      if (!currentProvider || !currentProvider.configured) {
        // 当前提供商未配置，选择第一个已配置的
        const firstConfigured = configuredProviders.value.find(p => p.configured)
        if (firstConfigured) {
          form.aiPrompt.provider = firstConfigured.id as any
          handleProviderChange(firstConfigured.id)
        }
      }
    }
  } catch (error) {
    console.error('获取 AI 提供商列表失败:', error)
  }
}

// 组件挂载时获取
fetchConfiguredProviders()

// 周期优先级（从短到长）
const timeframePriority: Record<string, number> = {
  '5m': 1,
  '15m': 2,
  '1h': 3,
  '4h': 4,
  '1d': 5
}

// 多选变量
const selectedIndicators = ref<string[]>(['EMA', 'RSI', 'ADX', 'ATR'])
const emaPeriods = ref<number[]>([14, 60, 120])
const selectedStatistics = ref<string[]>(['OI', 'Volume'])

// 初始化表单
const form = reactive<CreateStrategyInput>({
  name: '',
  marketData: {
    symbols: [],
    timeframes: ['1h']
  },
  indicators: [],
  statistics: [],
  aiPrompt: {
    userPrompt: '请分析当前市场趋势，当技术指标显示明确的方向时给出开仓建议。\n\n要求：\n1. 趋势明确时才给出信号\n2. 严格控制风险\n3. 返回JSON格式：{direction: "long/short", confidence: 0-100, reasoning: "理由"}',
    temperature: 0.3,
    maxTokens: 2000,
    model: 'deepseek-chat',
    provider: 'deepseek'
  },
  riskManagement: {
    maxRiskPercentage: 20,
    stopLossATRMultiplier: 2.5,
    takeProfitRatios: [2, 3],
    maxDailyTrades: 5,
    maxDailyLoss: 10,
    maxHoldTimeMinutes: 1440,
    trailingStop: {
      enabled: true,
      activationRatio: 1,
      trailDistance: 1.2,
      minMoveDistance: 0.16
    }
  },
  executionConfig: {
    scanInterval: 600,
    leverage: 'dynamic',
    marginMode: 'cross',
    positionMode: 'one-way'
  }
})

// 同步 indicators 数据 - 使用市场数据配置的最小周期
watch([selectedIndicators, emaPeriods, () => form.marketData.timeframes], () => {
  const newIndicators: any[] = []
  let id = 1

  // 获取最小周期
  const sortedTimeframes = [...form.marketData.timeframes].sort((a, b) => 
    (timeframePriority[a] || 99) - (timeframePriority[b] || 99)
  )
  const smallestTimeframe = sortedTimeframes[0] ? [sortedTimeframes[0]] : []

  if (selectedIndicators.value.includes('EMA')) {
    newIndicators.push({
      id: String(id++),
      type: 'EMA',
      params: { periods: [...emaPeriods.value].sort((a, b) => a - b) },
      timeframes: smallestTimeframe,
      enabled: true
    })
  }
  if (selectedIndicators.value.includes('RSI')) {
    newIndicators.push({
      id: String(id++),
      type: 'RSI',
      params: { period: 14 },
      timeframes: smallestTimeframe,
      enabled: true
    })
  }
  if (selectedIndicators.value.includes('ADX')) {
    newIndicators.push({
      id: String(id++),
      type: 'ADX',
      params: { period: 14 },
      timeframes: smallestTimeframe,
      enabled: true
    })
  }
  if (selectedIndicators.value.includes('MACD')) {
    newIndicators.push({
      id: String(id++),
      type: 'MACD',
      params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      timeframes: smallestTimeframe,
      enabled: true
    })
  }
  if (selectedIndicators.value.includes('ATR')) {
    newIndicators.push({
      id: String(id++),
      type: 'ATR',
      params: { period: 14 },
      timeframes: smallestTimeframe,
      enabled: true
    })
  }

  form.indicators = newIndicators
}, { immediate: true, deep: true })

// 同步 statistics 数据 - 使用市场数据配置的最小周期
watch([selectedStatistics, () => form.marketData.timeframes], () => {
  const newStatistics: any[] = []
  let id = 5

  // 获取最小周期
  const sortedTimeframes = [...form.marketData.timeframes].sort((a, b) => 
    (timeframePriority[a] || 99) - (timeframePriority[b] || 99)
  )
  const smallestTimeframe = sortedTimeframes[0] ? [sortedTimeframes[0]] : ['1h']

  if (selectedStatistics.value.includes('OI')) {
    newStatistics.push({
      id: String(id++),
      type: 'OI',
      params: { trendPeriod: 12, changePeriod: 24 },
      timeframes: smallestTimeframe,
      enabled: true
    })
  }
  if (selectedStatistics.value.includes('Volume')) {
    newStatistics.push({
      id: String(id++),
      type: 'Volume',
      params: { comparePeriod: 20 },
      timeframes: smallestTimeframe,
      enabled: true
    })
  }

  form.statistics = newStatistics
}, { immediate: true, deep: true })

// 如果有编辑的策略，加载数据
watch(() => props.strategy, (newVal) => {
  if (newVal) {
    Object.assign(form, {
      name: newVal.name,
      marketData: newVal.marketData,
      aiPrompt: newVal.aiPrompt,
      riskManagement: newVal.riskManagement,
      executionConfig: newVal.executionConfig
    })

    // 同步选中的指标
    selectedIndicators.value = newVal.indicators.filter(i => i.enabled).map(i => i.type)
    
    // 同步 EMA 周期
    const emaIndicator = newVal.indicators.find(i => i.type === 'EMA')
    if (emaIndicator && emaIndicator.params && emaIndicator.params.periods) {
      emaPeriods.value = [...emaIndicator.params.periods].sort((a, b) => a - b)
    }
    
    // 同步统计数据
    selectedStatistics.value = newVal.statistics.filter(s => s.enabled).map(s => s.type)
  }
}, { immediate: true })

// 保存
const handleSave = async () => {
  try {
    saving.value = true
    
    // 简单排序：保存时按从短到长排序周期
    form.marketData.timeframes.sort((a, b) => 
      (timeframePriority[a] || 99) - (timeframePriority[b] || 99)
    )
    
    emit('save', { ...form })
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.strategy-editor {
  padding: 10px;
}

.form-section {
  margin-bottom: 20px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: bold;
}

.indicator-item {
  margin-bottom: 10px;
  padding: 10px;
  background: #f5f7fa;
  border-radius: 4px;
}

.stat-label {
  margin: 0 10px;
  color: #606266;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
  padding: 20px 0;
  border-top: 1px solid #ebeef5;
}

.form-tip {
  margin-top: 5px;
  font-size: 12px;
  color: #909399;
}
</style>
