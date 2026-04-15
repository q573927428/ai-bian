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
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="请输入策略描述"
          />
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
            <el-option label="BNB/USDT" value="BNB/USDT" />
          </el-select>
        </el-form-item>
        <el-form-item label="K线周期">
          <el-checkbox-group v-model="form.marketData.timeframes">
            <el-checkbox label="15m">15分钟</el-checkbox>
            <el-checkbox label="1h">1小时</el-checkbox>
            <el-checkbox label="4h">4小时</el-checkbox>
            <el-checkbox label="1d">1天</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="K线数量">
          <el-input-number v-model="form.marketData.klineLimit" :min="100" :max="1000" :step="50" />
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

        <div v-for="(indicator, index) in form.indicators" :key="index" class="indicator-item">
          <el-row :gutter="10" align="middle">
            <el-col :span="2">
              <el-checkbox v-model="indicator.enabled" />
            </el-col>
            <el-col :span="4">
              <el-select v-model="indicator.type" placeholder="指标类型">
                <el-option label="EMA" value="EMA" />
                <el-option label="RSI" value="RSI" />
                <el-option label="ADX" value="ADX" />
                <el-option label="MACD" value="MACD" />
                <el-option label="ATR" value="ATR" />
              </el-select>
            </el-col>
            <el-col :span="12">
              <el-input
                v-if="indicator.type === 'EMA'"
                v-model="indicator.params.periods"
                placeholder="周期，如 14,60,120"
              />
              <el-input-number
                v-else
                v-model="indicator.params.period"
                :min="2"
                :max="200"
                placeholder="周期"
              />
            </el-col>
            <el-col :span="4">
              <el-select v-model="indicator.timeframes" multiple placeholder="周期">
                <el-option label="15m" value="15m" />
                <el-option label="1h" value="1h" />
                <el-option label="4h" value="4h" />
              </el-select>
            </el-col>
            <el-col :span="2">
              <el-button type="danger" size="small" @click="removeIndicator(index)">
                <el-icon><ElIconDelete /></el-icon>
              </el-button>
            </el-col>
          </el-row>
        </div>

        <el-button type="primary" plain @click="addIndicator">
          <el-icon><ElIconPlus /></el-icon>
          添加指标
        </el-button>
      </el-card>

      <!-- 统计数据配置 -->
      <el-card class="form-section">
        <template #header>
          <div class="section-header">
            <el-icon><ElIconataBoard /></el-icon>
            <span>3. 统计数据配置</span>
          </div>
        </template>
        <el-form-item label="OI 持仓量" v-if="form.statistics[0]">
          <el-switch v-model="form.statistics[0].enabled" />
          <span class="stat-label">趋势周期: </span>
          <el-input-number v-model="form.statistics[0].params.trendPeriod" :min="5" :max="50" />
          <span class="stat-label">变化周期: </span>
          <el-input-number v-model="form.statistics[0].params.changePeriod" :min="10" :max="100" />
        </el-form-item>
        <el-form-item label="成交量" v-if="form.statistics[1]">
          <el-switch v-model="form.statistics[1].enabled" />
          <span class="stat-label">比较周期: </span>
          <el-input-number v-model="form.statistics[1].params.comparePeriod" :min="10" :max="100" />
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
        <el-form-item label="系统提示词">
          <el-input
            v-model="form.aiPrompt.systemPrompt"
            type="textarea"
            :rows="4"
            placeholder="你是一个专业的交易分析师..."
          />
        </el-form-item>
        <el-form-item label="用户交易逻辑">
          <el-input
            v-model="form.aiPrompt.userPrompt"
            type="textarea"
            :rows="6"
            placeholder="当EMA金叉且RSI<30时，开多仓..."
          />
        </el-form-item>
        <el-row :gutter="20">
          <el-col :span="8">
            <el-form-item label="AI模型">
              <el-select v-model="form.aiPrompt.model">
                <el-option label="deepseek-chat" value="deepseek-chat" />
                <el-option label="deepseek-coder" value="deepseek-coder" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="温度">
              <el-slider v-model="form.aiPrompt.temperature" :min="0" :max="1" :step="0.1" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
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
              <el-input-number v-model="form.executionConfig.scanInterval" :min="30" :max="600" :step="30" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="杠杆">
              <el-select v-model="form.executionConfig.leverage">
                <el-option label="动态" value="dynamic" />
                <el-option label="5" :value="5" />
                <el-option label="10" :value="10" />
                <el-option label="20" :value="20" />
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
import { ref, reactive, watch } from 'vue'
import type { Strategy, CreateStrategyInput } from '../../types/strategy'

const props = defineProps<{
  strategy?: Strategy | null
}>()

const emit = defineEmits<{
  save: [data: any]
  cancel: []
}>()

const saving = ref(false)

// 初始化表单
const form = reactive<CreateStrategyInput>({
  name: '',
  description: '',
  marketData: {
    symbols: [],
    timeframes: ['1h'],
    klineLimit: 300
  },
  indicators: [
    { id: '1', type: 'EMA', params: { periods: [14, 60, 120] }, timeframes: ['15m','1h','4h'], enabled: true },
    { id: '2', type: 'RSI', params: { period: 14 }, timeframes: ['15m','1h','4h'], enabled: true },
    { id: '3', type: 'ATR', params: { period: 14 }, timeframes: ['15m','1h','4h'], enabled: true },
    { id: '4', type: 'ADX', params: { period: 14 }, timeframes: ['15m','1h','4h'], enabled: true }
  ],
  statistics: [
    { id: '5', type: 'OI', params: { trendPeriod: 12, changePeriod: 24 }, timeframes: ['1h'], enabled: true },
    { id: '6', type: 'Volume', params: { comparePeriod: 20 }, timeframes: ['1h'], enabled: true }
  ],
  aiPrompt: {
    systemPrompt: '你是一个专业的加密货币交易分析师。请根据提供的技术指标和市场数据，给出明确的交易信号。',
    userPrompt: '请分析当前市场趋势，当技术指标显示明确的方向时给出开仓建议。\n\n要求：\n1. 趋势明确时才给出信号\n2. 严格控制风险\n3. 返回JSON格式：{direction: "long/short", confidence: 0-100, reasoning: "理由"}',
    temperature: 0.7,
    maxTokens: 2000,
    model: 'deepseek-chat'
  },
  riskManagement: {
    maxRiskPercentage: 20,
    stopLossATRMultiplier: 2.5,
    takeProfitRatios: [2.5, 3.5],
    maxDailyTrades: 5,
    maxDailyLoss: 10,
    trailingStop: {
      enabled: true,
      activationRatio: 1,
      trailDistance: 1.2,
      minMoveDistance: 0.16
    }
  },
  executionConfig: {
    scanInterval: 180,
    leverage: 'dynamic',
    marginMode: 'cross',
    positionMode: 'one-way'
  }
})

// 如果有编辑的策略，加载数据
watch(() => props.strategy, (newVal) => {
  if (newVal) {
    Object.assign(form, {
      name: newVal.name,
      description: newVal.description,
      marketData: newVal.marketData,
      indicators: newVal.indicators,
      statistics: newVal.statistics,
      aiPrompt: newVal.aiPrompt,
      riskManagement: newVal.riskManagement,
      executionConfig: newVal.executionConfig
    })
  }
}, { immediate: true })

// 添加指标
const addIndicator = () => {
  form.indicators.push({
    id: Date.now().toString(),
    type: 'EMA',
    params: { periods: [14, 60, 120] },
    timeframes: ['1h'],
    enabled: true
  })
}

// 删除指标
const removeIndicator = (index: number) => {
  form.indicators.splice(index, 1)
}

// 保存
const handleSave = async () => {
  try {
    saving.value = true
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
</style>
