<!-- 策略编辑器组件 -->
<template>
  <div class="strategy-editor">
    <el-form :model="form" label-width="90px" class="strategy-form">
      <!-- 两列布局容器 -->
      <div class="form-grid">
        <!-- 左列 -->
        <div class="form-column form-column-left">
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
                <el-option
                  v-for="symbol in symbolOptions"
                  :key="symbol"
                  :label="symbol"
                  :value="symbol"
                />
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

            <!-- OI参数配置 -->
            <div v-if="selectedStatistics.includes('OI')" class="params-section">
              <el-divider content-position="left">OI 参数配置</el-divider>
              <el-row :gutter="12">
                <el-col :xs="24" :span="12">
                  <el-form-item label="回看周期数">
                    <el-input-number
                      v-model="oiParams.changePeriod"
                      :min="1"
                      :max="60"
                      :step="1"
                    />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :span="12">
                  <el-form-item label="判定阈值">
                    <el-input-number
                      v-model="oiParams.trendThresholdPercent"
                      :min="0.001"
                      :max="1.0"
                      :step="0.001"
                      :precision="3"
                    /> <small class="unitf">%</small>
                  </el-form-item>
                </el-col>
              </el-row>
            </div>
          </el-card>

          <!-- 执行配置 -->
          <el-card class="form-section">
            <template #header>
              <div class="section-header">
                <el-icon><ElIconSetting /></el-icon>
                <span>4. 执行配置</span>
              </div>
            </template>
            <el-form-item label="扫描间隔">
              <el-input-number v-model="form.executionConfig.scanInterval" :min="5" :max="120" :step="5" /> <small class="unitf">分钟</small>
            </el-form-item>
            <el-form-item label="杠杆">
              <el-select v-model="form.executionConfig.leverage" style="width: 100%">
                <el-option label="动态" value="dynamic" />
                <el-option label="2" :value="2" />
                <el-option label="3" :value="3" />
                <el-option label="5" :value="5" />
                <el-option label="10" :value="10" />
                <el-option label="20" :value="20" />
                <el-option label="50" :value="50" />
              </el-select>
            </el-form-item>
            <el-form-item label="保证金模式">
              <el-select v-model="form.executionConfig.marginMode" style="width: 100%">
                <el-option label="全仓" value="cross" />
                <el-option label="逐仓" value="isolated" />
              </el-select>
            </el-form-item>
          </el-card>
        </div>

        <!-- 右列 -->
        <div class="form-column form-column-right">
          <!-- AI 交易逻辑提示词 -->
          <el-card class="form-section">
            <template #header>
              <div class="section-header">
                <el-icon><ElIconChatDotRound /></el-icon>
                <span>5. AI 交易逻辑提示词</span>
              </div>
            </template>
            <el-form-item label="交易逻辑">
              <el-input
                v-model="form.aiPrompt.userPrompt"
                type="textarea"
                :rows="22"
                placeholder="当EMA金叉且RSI<30时，开多仓..."
              />
            </el-form-item>
            <el-row :gutter="12">
              <el-col :xs="24" :span="12">
                <el-form-item label="AI提供商">
                  <el-select v-model="form.aiPrompt.provider" @change="handleProviderChange" style="width: 100%">
                    <el-option
                      v-for="provider in availableProviderOptions"
                      :key="provider.value"
                      :label="provider.label"
                      :value="provider.value"
                    />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :span="12">
                <el-form-item label="AI模型">
                  <el-select
                    v-model="form.aiPrompt.model"
                    filterable
                    allow-create
                    placeholder="选择或输入模型名称"
                    style="width: 100%"
                  >
                    <el-option v-for="model in availableModels" :key="model.value" :label="model.label" :value="model.value" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <!-- OpenAI 兼容自定义配置 -->
            <template v-if="form.aiPrompt.provider === 'openai'">
              <el-divider content-position="left">OpenAI 兼容自定义配置</el-divider>
              <el-form-item label="API URL">
                <el-input v-model="form.aiPrompt.apiUrl" placeholder="https://api.openai.com/v1" />
              </el-form-item>
              <el-form-item label="API Key">
                <el-input v-model="form.aiPrompt.apiKey" type="password" show-password placeholder="sk-..." />
              </el-form-item>
            </template>
            <!-- <el-row :gutter="12">
              <el-col :xs="24" :span="12">
                <el-form-item label="温度">
                  <el-slider v-model="form.aiPrompt.temperature" :min="0" :max="1" :step="0.1" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :span="12">
                <el-form-item label="最大Token">
                  <el-input-number v-model="form.aiPrompt.maxTokens" :min="500" :max="4000" :step="500" style="width: 100%" />
                </el-form-item>
              </el-col>
            </el-row> -->
          </el-card>

          <!-- 规则 DSL（简易编辑） -->
          <!-- <el-card class="form-section">
            <template #header>
              <div class="section-header">
                <el-icon><ElIconEditPen /></el-icon>
                <span>5.1 规则 DSL</span>
              </div>
            </template>
            <el-form-item label="规则DSL">
              <el-input
                v-model="structuredRulesDsl"
                type="textarea"
                :rows="10"
                placeholder="可选：填写 DSL；留空则由 AI 自动生成。示例：LONG:\nEMA50 > EMA200\nAND OI_CHANGE > 0\n\nSHORT:\nEMA50 < EMA200"
              />
              <div v-if="structuredRulesDslError" class="json-error">
                {{ structuredRulesDslError }}
              </div>
            </el-form-item>
          </el-card> -->

          <!-- 风险管理配置 -->
          <el-card class="form-section">
            <template #header>
              <div class="section-header">
                <el-icon><ElIconWarning /></el-icon>
                <span>6. 风险管理配置</span>
              </div>
            </template>
            <el-row :gutter="12">
              <el-col :xs="24" :span="12">
                <el-form-item label="单笔风险">
                  <el-input-number v-model="form.riskManagement.maxRiskPercentage" :min="1" :max="50" /> <small class="unitf">%</small>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :span="12">
                <el-form-item label="止损ATR倍">
                  <el-input-number v-model="form.riskManagement.stopLossATRMultiplier" :min="1" :max="5" :step="0.1" /> <small class="unitf">R</small>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :span="12">
                <el-form-item label="TP1止盈">
                  <el-input-number v-model="form.riskManagement.takeProfitRatios[0]" :min="1" :max="10" :step="0.1" /> <small class="unitf">R</small>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :span="12">
                <el-form-item label="TP2止盈">
                  <el-input-number v-model="form.riskManagement.takeProfitRatios[1]" :min="1" :max="10" :step="0.1" /> <small class="unitf">R</small>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :span="12">
                <el-form-item label="多头RSI阈值">
                  <el-input-number v-model="form.riskManagement.rsiExtreme!.long" :min="5" :max="95" :step="1" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :span="12">
                <el-form-item label="空头RSI阈值">
                  <el-input-number v-model="form.riskManagement.rsiExtreme!.short" :min="5" :max="95" :step="1" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :span="12">
                <el-form-item label="每日交易">
                  <el-input-number v-model="form.riskManagement.maxDailyTrades" :min="1" :max="20" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :span="12">
                <el-form-item label="持仓超时">
                  <el-input-number v-model="form.riskManagement.maxHoldTimeMinutes" :min="60" :max="10080" :step="60" /> <small class="unitf">分钟</small>
                </el-form-item>
              </el-col>
            </el-row>

            <el-form-item label="移动止损">
              <div class="trailing-stop-row">
                <span class="trailing-stop-group">
                  <el-switch v-model="form.riskManagement.trailingStop.enabled" />
                  <span class="stat-label">激活: </span>
                  <el-input-number v-model="form.riskManagement.trailingStop.activationRatio" :min="0.5" :max="3" :step="0.1" />
                </span>
                <span class="trailing-stop-group">
                  <span class="stat-label">距离: </span>
                  <el-input-number v-model="form.riskManagement.trailingStop.trailDistance" :min="0.5" :max="3" :step="0.1" />
                </span>
              </div>
            </el-form-item>
            
          </el-card>
        </div>
      </div>

      <!-- 操作按钮 -->
      <div class="form-actions">
        <div class="button-group">
          <el-button @click="$emit('cancel')">取消</el-button>
          <el-button type="primary" @click="handleSave" :loading="saving">
            保存策略
          </el-button>
        </div>
        <div v-if="structuredRulesDslError" class="json-error">
          {{ structuredRulesDslError }}
        </div>
      </div>

      <el-dialog v-model="generatedRulesDialogVisible" title="确认自动生成 DSL" width="720px">
        <div class="form-tip" style="margin-bottom: 8px;">
          已根据 AI 交易逻辑提示词生成候选 DSL，请确认后应用并保存。
        </div>
        <el-input :model-value="generatedStructuredRulesPreview" type="textarea" :rows="18" readonly />
        <template #footer>
          <el-button @click="cancelGeneratedRules">取消</el-button>
          <el-button type="primary" @click="confirmGeneratedRulesAndSave">确认应用并保存</el-button>
        </template>
      </el-dialog>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import type { Strategy, CreateStrategyInput } from '../../types/strategy'
import { useBotStore } from '../stores/bot'

const props = defineProps<{
  strategy?: Strategy | null
}>()

const emit = defineEmits<{
  save: [data: any]
  cancel: []
}>()

const saving = ref(false)
const structuredRulesDsl = ref('')
const structuredRulesDslError = ref('')
const generatedRulesDialogVisible = ref(false)
const generatedStructuredRulesPreview = ref('')
const generatedStructuredRulesObject = ref<{ dsl: string } | null>(null)
const pendingSavePayload = ref<any>(null)

// 已配置的 AI 提供商列表
const configuredProviders = ref<Array<{ id: string; name: string; configured: boolean }>>([])

// AI 提供商模型配置
const providerModels: Record<string, Array<{ label: string; value: string }>> = {
  deepseek: [
    { label: 'deepseek-v4-flash', value: 'deepseek-v4-flash' },
    { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro' }
  ],
  doubao: [
    { label: 'doubao-seed-2-0-pro-260215', value: 'doubao-seed-2-0-pro-260215' },
    { label: 'doubao-seed-2-0-lite-260215', value: 'doubao-seed-2-0-lite-260215' },
    { label: 'doubao-seed-2-0-mini-260215', value: 'doubao-seed-2-0-mini-260215' }
  ],
  qwen: [
    { label: 'qwen3.6-plus', value: 'qwen3.6-plus' },
    { label: 'qwen3.6-flash', value: 'qwen3.6-flash' },
    { label: 'qwen3.6-max-preview', value: 'qwen3.6-max-preview' }
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

// 从 bot store 读取交易对列表
const botStore = useBotStore()
const symbolOptions = computed(() => botStore.botConfig?.symbols || [])

// 多选变量
const selectedIndicators = ref<string[]>(['EMA', 'RSI', 'ADX', 'ATR'])
const emaPeriods = ref<number[]>([14, 60, 120])
const selectedStatistics = ref<string[]>(['OI', 'Volume'])

// OI参数
const oiParams = reactive({
  changePeriod: 12,
  trendThresholdPercent: 0.05
})

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
    model: 'deepseek-v4-flash',
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
    },
    rsiExtreme: {
      long: 80,
      short: 20
    }
  },
  executionConfig: {
    scanInterval: 5,
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
watch([selectedStatistics, () => form.marketData.timeframes, () => oiParams.changePeriod, () => oiParams.trendThresholdPercent], () => {
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
      params: {
        changePeriod: oiParams.changePeriod,
        trendThresholdPercent: oiParams.trendThresholdPercent
      },
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
      executionConfig: newVal.executionConfig,
      indicators: newVal.indicators,
      statistics: newVal.statistics,
      structuredRules: (newVal as any).structuredRules
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

    // 同步 OI 参数
    const oiStat = newVal.statistics.find(s => s.type === 'OI' && s.enabled)
    if (oiStat && oiStat.params) {
      oiParams.changePeriod = oiStat.params.changePeriod ?? 12
      oiParams.trendThresholdPercent = oiStat.params.trendThresholdPercent ?? 0.05
    }

    const sr = (newVal as any).structuredRules
    structuredRulesDsl.value = (sr && typeof sr.dsl === 'string') ? sr.dsl : ''
    if (sr) {
      ;(form as any).structuredRules = sr
    }
  } else {
    structuredRulesDsl.value = ''
  }
}, { immediate: true })

// 保存
const handleSave = async () => {
  try {
    saving.value = true
    structuredRulesDslError.value = ''
    const raw = structuredRulesDsl.value.trim()
    if (raw) {
      ;(form as any).structuredRules = { dsl: raw }
    } else {
      delete (form as any).structuredRules
    }

    // 简单排序：保存时按从短到长排序周期
    form.marketData.timeframes.sort((a, b) =>
      (timeframePriority[a] || 99) - (timeframePriority[b] || 99)
    )

    const payload = { ...form }

    // // 若 structuredRules 为空，则走后端 AI 自动生成并弹窗确认
    // const hasStructuredRules = !!structuredRulesDsl.value.trim()
    // if (!hasStructuredRules) {
    //   const resp = await $fetch<{ success: boolean; data?: { structuredRules: { dsl: string } } }>('/api/ai/generate-structured-rules', {
    //     method: 'POST',
    //     body: {
    //       userPrompt: payload.aiPrompt?.userPrompt || '',
    //       provider: payload.aiPrompt?.provider || 'deepseek'
    //     }
    //   })

    //   const generated = resp?.data?.structuredRules
    //   if (generated) {
    //     generatedStructuredRulesObject.value = generated
    //     generatedStructuredRulesPreview.value = generated.dsl || ''
    //     pendingSavePayload.value = payload
    //     generatedRulesDialogVisible.value = true
    //     return
    //   }
    // }

    emit('save', payload)
  } finally {
    saving.value = false
  }
}

const confirmGeneratedRulesAndSave = () => {
  if (!pendingSavePayload.value || !generatedStructuredRulesObject.value) {
    generatedRulesDialogVisible.value = false
    return
  }

  const generated = generatedStructuredRulesObject.value
  structuredRulesDsl.value = generated.dsl || ''
  ;(pendingSavePayload.value as any).structuredRules = generated
  emit('save', pendingSavePayload.value)

  generatedRulesDialogVisible.value = false
  pendingSavePayload.value = null
  generatedStructuredRulesObject.value = null
}

const cancelGeneratedRules = () => {
  generatedRulesDialogVisible.value = false
  pendingSavePayload.value = null
  generatedStructuredRulesObject.value = null
}

</script>

<style scoped>
.strategy-editor {
  padding: 10px;
}

/* 两列网格布局 */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}

.form-column {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-section {
  margin-bottom: 0;
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
  margin: 0 6px;
  color: #606266;
  white-space: nowrap;
  font-size: 13px;
}

.form-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  margin-top: 20px;
  padding: 20px 0;
  border-top: 1px solid #ebeef5;
}

.button-group {
  display: flex;
  gap: 10px;
}

.form-tip {
  display: block;
  font-size: 12px;
  color: #909399;
}

.json-error {
  display: block;
  color: #f56c6c;
  font-size: 12px;
}

.json-actions {
  display: block;
}

.unitf{
  margin-left: 8px;
}
.trailing-stop-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}


.hold-time-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

/* 手机端适配 */
@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .strategy-editor {
    padding: 6px;
  }

  .form-column {
    gap: 16px;
  }

  .form-section {
    margin-bottom: 0;
  }

  .stat-label {
    font-size: 12px;
  }

  .trailing-stop-row,
  .hold-time-row {
    flex-wrap: wrap;
    gap: 6px;
  }
}
</style>
