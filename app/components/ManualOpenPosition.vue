<template>
  <el-card class="card" shadow="hover">
    <template #header>
      <div class="card-header">
        <span>🎮 手动开仓</span>
      </div>
    </template>

    <div class="manual-open-form">
      <div v-if="isCheckingPasswordRequirement" class="password-checking">
        <el-skeleton :rows="4" animated />
      </div>

      <div v-else-if="requiresPassword && !isPasswordVerified" class="password-gate">

        <el-input
          v-model="passwordInput"
          type="password"
          placeholder="请输入密码"
          show-password
          @keyup.enter="handlePasswordVerify"
        />

        <el-button
          type="primary"
          :loading="isVerifyingPassword"
          @click="handlePasswordVerify"
          style="width: 100%"
        >
          验证并显示表单
        </el-button>
      </div>

      <template v-else>
        <!-- 交易对选择 -->
        <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
        <el-form-item label="交易对" prop="symbol">
          <el-select
            v-model="form.symbol"
            placeholder="选择交易对"
            style="width: 100%"
            :disabled="!botStore.config?.symbols?.length"
          >
            <el-option
              v-for="symbol in botStore.config?.symbols || []"
              :key="symbol"
              :label="symbol"
              :value="symbol"
            />
          </el-select>
          <div v-if="!botStore.config?.symbols?.length" class="form-hint">
            请在系统配置中设置交易对
          </div>
        </el-form-item>

        <!-- 方向选择 -->
        <el-form-item label="方向" prop="direction">
          <el-radio-group v-model="form.direction">
            <el-radio-button label="做多" value="LONG" />
            <el-radio-button label="做空" value="SHORT" />
          </el-radio-group>
        </el-form-item>

        <!-- 订单类型 -->
        <!-- <el-form-item label="订单类型" prop="orderType">
          <el-radio-group v-model="form.orderType" @change="handleOrderTypeChange">
            <el-radio-button label="市价" value="MARKET" />
            <el-radio-button label="限价" value="LIMIT" />
          </el-radio-group>
        </el-form-item> -->

        <!-- 限价价格输入 -->
        <el-form-item v-if="form.orderType === 'LIMIT'" label="限价价格" prop="price">
          <el-input
            v-model="form.price"
            placeholder="请输入限价价格"
            type="number"
            :min="0.00001"
            :step="0.00001"
          >
            <template #append>USDT</template>
          </el-input>
        </el-form-item>

        <!-- 金额类型 -->
        <el-form-item label="金额类型" prop="amountType">
          <el-radio-group v-model="form.amountType" @change="handleAmountTypeChange">
            <el-radio-button label="仓位百分比" value="PERCENTAGE" />
            <el-radio-button label="USDT金额" value="USDT" />
          </el-radio-group>
        </el-form-item>

        <!-- 金额输入 -->
        <el-form-item :label="amountLabel" prop="amount">
          <el-input
            v-model="form.amount"
            placeholder="请输入金额"
            type="number"
            :min="0.01"
            :step="0.01"
          >
            <template #append>{{ amountUnit }}</template>
          </el-input>
          <div class="form-hint" v-if="form.amountType === 'PERCENTAGE'">
            基于可用余额计算：{{ calculatedAmount.toFixed(2) }} USDT
          </div>
        </el-form-item>

        <!-- 杠杆 -->
        <el-form-item label="杠杆" prop="leverage">
          <el-input
            v-model="form.leverage"
            placeholder="请输入杠杆倍数"
            type="number"
            :min="1"
            :max="125"
            :step="1"
          >
            <template #append>X</template>
          </el-input>
        </el-form-item>

        <el-form-item v-if="requiresPassword" label="密码验证">
          <el-input
            v-model="submitPasswordInput"
            type="password"
            placeholder="开仓前请再次输入密码"
            show-password
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <!-- 开仓按钮 -->
        <el-form-item>
          <el-button
            type="primary"
            :loading="isSubmitting"
            :disabled="!canSubmit"
            @click="handleSubmit"
            style="width: 100%"
          >
            <el-icon style="margin-right: 8px"><ElIconVideoPlay /></el-icon>
            手动开仓
          </el-button>
        </el-form-item>
        </el-form>

        <!-- 当前价格显示 -->
        <div v-if="currentPrice" class="current-price-info">
          <div class="price-label">当前价格：</div>
          <div class="price-value">{{ currentPrice.toFixed(5) }} USDT</div>
          <el-button
            text
            type="primary"
            size="small"
            @click="refreshPrice"
            :loading="isRefreshingPrice"
          >
            <el-icon><ElIconRefresh /></el-icon>
          </el-button>
        </div>
      </template>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useBotStore } from '../stores/bot'

const botStore = useBotStore()

// 表单状态
const formRef = ref()
const isSubmitting = ref(false)
const isRefreshingPrice = ref(false)
const currentPrice = ref<number | null>(null)
const requiresPassword = ref(false)
const isCheckingPasswordRequirement = ref(true)
const isPasswordVerified = ref(false)
const isVerifyingPassword = ref(false)
const passwordInput = ref('')
const verifiedPassword = ref('')
const submitPasswordInput = ref('')

// 表单数据
interface ManualOpenForm {
  symbol: string
  direction: 'LONG' | 'SHORT'
  orderType: 'MARKET' | 'LIMIT'
  price: string
  amountType:  'PERCENTAGE' | 'USDT'
  amount: string
  leverage: string
}

const form = ref<ManualOpenForm>({
  symbol: '',
  direction: 'LONG',
  orderType: 'MARKET',
  price: '',
  amountType: 'PERCENTAGE',
  amount: '20',
  leverage: '10'
})

  // 表单验证规则
  const rules = {
    symbol: [
      { required: true, message: '请选择交易对', trigger: 'change' }
    ],
    direction: [
      { required: true, message: '请选择方向', trigger: 'change' }
    ],
    orderType: [
      { required: true, message: '请选择订单类型', trigger: 'change' }
    ],
    price: [
      { 
        required: true, 
        message: '请输入限价价格', 
        trigger: 'blur',
        validator: (rule: any, value: string, callback: any) => {
          if (form.value.orderType === 'LIMIT' && !value) {
            callback(new Error('限价订单需要输入价格'))
          } else if (form.value.orderType === 'LIMIT' && Number(value) <= 0) {
            callback(new Error('价格必须大于0'))
          } else {
            callback()
          }
        }
      }
    ],
    amount: [
      { required: true, message: '请输入金额', trigger: 'blur' },
      { 
        validator: (rule: any, value: string, callback: any) => {
          const numValue = Number(value)
          if (isNaN(numValue) || numValue <= 0) {
            callback(new Error('金额必须大于0'))
          } else if (form.value.amountType === 'PERCENTAGE' && (numValue < 1 || numValue > 100)) {
            callback(new Error('百分比必须在1-100之间'))
          } else {
            // 检查最小金额限制
            if (form.value.amountType === 'USDT') {
              if (numValue < 20) {
                callback(new Error('开仓金额必须大于等于20 USDT'))
              } else {
                callback()
              }
            } else {
              // 对于百分比，检查计算出的金额是否大于20 USDT
              const usdtBalance = botStore.cryptoBalances.find(b => b.asset === 'USDT')
              const availableBalance = usdtBalance?.free || 0
              const calculatedAmount = availableBalance * (numValue / 100)
              if (calculatedAmount < 20) {
                callback(new Error(`仓位百分比计算出的金额(${calculatedAmount.toFixed(2)} USDT)必须大于等于20 USDT`))
              } else {
                callback()
              }
            }
          }
        },
        trigger: 'blur'
      }
    ],
    leverage: [
      { required: true, message: '请输入杠杆', trigger: 'blur' },
      { 
        validator: (rule: any, value: string, callback: any) => {
          const numValue = Number(value)
          if (isNaN(numValue) || numValue < 1 || numValue > 125) {
            callback(new Error('杠杆必须在1-125之间'))
          } else {
            callback()
          }
        },
        trigger: 'blur'
      }
    ]
  }

// 计算属性
const amountLabel = computed(() => {
  return form.value.amountType === 'USDT' ? '金额' : '百分比'
})

const amountUnit = computed(() => {
  return form.value.amountType === 'USDT' ? 'USDT' : '%'
})

const calculatedAmount = computed(() => {
  if (form.value.amountType !== 'PERCENTAGE' || !form.value.amount) {
    return 0
  }
  
  const usdtBalance = botStore.cryptoBalances.find(b => b.asset === 'USDT')
  const availableBalance = usdtBalance?.free || 0
  const percentage = Number(form.value.amount) / 100
  
  return availableBalance * percentage
})

const canSubmit = computed(() => {
  if (isCheckingPasswordRequirement.value) {
    return false
  }

  if (requiresPassword.value && !isPasswordVerified.value) {
    return false
  }

  if (requiresPassword.value && !submitPasswordInput.value) {
    return false
  }

  if (!form.value.symbol || !form.value.amount || !form.value.leverage) {
    return false
  }
  
  if (form.value.orderType === 'LIMIT' && !form.value.price) {
    return false
  }

  return true
})

// 方法
async function handlePasswordVerify() {
  if (!passwordInput.value) {
    ElMessage.warning('请输入密码')
    return
  }

  try {
    isVerifyingPassword.value = true
    const response = await $fetch<{ success: boolean; message?: string; requiresPassword?: boolean }>(
      '/api/bot/verify-password',
      {
        method: 'POST',
        body: { password: passwordInput.value }
      }
    )

    if (response.success) {
      isPasswordVerified.value = true
      verifiedPassword.value = passwordInput.value
      ElMessage.success(response.message || '密码验证成功')

      if (form.value.symbol) {
        await refreshPrice()
      }
    } else {
      isPasswordVerified.value = false
      verifiedPassword.value = ''
      ElMessage.error(response.message || '密码验证失败')
    }
  } catch (error: any) {
    ElMessage.error('密码验证失败: ' + (error.message || String(error)))
  } finally {
    isVerifyingPassword.value = false
  }
}

function handleOrderTypeChange() {
  if (form.value.orderType === 'MARKET') {
    form.value.price = ''
  }
}

function handleAmountTypeChange() {
  // 重置金额输入
  form.value.amount = ''
}

async function refreshPrice() {
  const symbol = form.value.symbol
  if (!symbol) {
    ElMessage.warning('请先选择交易对')
    return
  }
  
  try {
    isRefreshingPrice.value = true
    const response = await $fetch<{ success: boolean; price?: number }>(`/api/websocket/prices?symbol=${symbol}`)
    
    if (response.success && response.price) {
      currentPrice.value = response.price
      
      // 如果是市价订单，更新价格提示
      if (form.value.orderType === 'MARKET') {
        ElMessage.info(`当前价格: ${response.price.toFixed(5)} USDT`)
      }
    }
  } catch (error) {
    console.error('获取价格失败:', error)
    ElMessage.error('获取价格失败')
  } finally {
    isRefreshingPrice.value = false
  }
}

async function checkPasswordRequirement() {
  try {
    const response = await $fetch<{ success: boolean; requiresPassword: boolean }>('/api/bot/check-password')
    if (response.success) {
      requiresPassword.value = response.requiresPassword
      return response.requiresPassword
    }
  } catch (error) {
    console.error('检查密码配置失败:', error)
  }
  return false
}

async function handleSubmit() {
  try {
    // 验证表单
    await formRef.value.validate()

    // 二次密码确认（内嵌输入）
    if (requiresPassword.value) {
      const passed = await verifyPasswordForSubmit()
      if (!passed) {
        return
      }
    }
    
    await executeManualOpenPositionWithPassword()
  } catch (error) {
    console.error('表单验证失败:', error)
  }
}

async function verifyPasswordForSubmit(): Promise<boolean> {
  try {
    if (!submitPasswordInput.value) {
      ElMessage.warning('请输入二次密码验证')
      return false
    }

    const response = await $fetch<{ success: boolean; message?: string }>(
      '/api/bot/verify-password',
      {
        method: 'POST',
        body: { password: submitPasswordInput.value }
      }
    )

    if (!response.success) {
      ElMessage.error(response.message || '密码验证失败')
      return false
    }

    verifiedPassword.value = submitPasswordInput.value
    return true
  } catch (error: any) {
    ElMessage.error('二次密码验证失败: ' + (error.message || String(error)))
    return false
  }
}

async function executeManualOpenPositionWithPassword() {
  isSubmitting.value = true
  
  try {
    const symbol = form.value.symbol
    if (!symbol) {
      ElMessage.error('请选择交易对')
      return
    }
    
    const payload = {
      symbol: symbol,
      direction: form.value.direction,
      orderType: form.value.orderType,
      price: form.value.orderType === 'LIMIT' ? Number(form.value.price) : undefined,
      amountType: form.value.amountType,
      amount: Number(form.value.amount),
      leverage: Number(form.value.leverage),
      password: requiresPassword.value ? verifiedPassword.value : undefined
    }
    
    const response = await $fetch<{
      success: boolean
      message?: string
      state?: any
      requiresPassword?: boolean
    }>('/api/bot/manual-open-position', {
      method: 'POST',
      body: payload
    })
    
    if (response.success) {
      ElMessage.success(response.message || '手动开仓成功')
      
      // 重置表单
      resetForm()
      
      // 刷新状态
      await botStore.fetchStatus()
    } else {
      if (response.requiresPassword) {
        // 需要密码验证，更新状态
        requiresPassword.value = true
        isPasswordVerified.value = false
        verifiedPassword.value = ''
        passwordInput.value = ''
        submitPasswordInput.value = ''
        ElMessage.warning('需要先完成密码验证')
      } else {
        ElMessage.error(response.message || '手动开仓失败')
      }
    }
  } catch (error: any) {
    ElMessage.error('手动开仓失败: ' + (error.message || String(error)))
  } finally {
    isSubmitting.value = false
  }
}

function resetForm() {
  form.value.symbol = ''
  form.value.direction = 'LONG'
  form.value.orderType = 'MARKET'
  form.value.price = ''
  form.value.amountType = 'USDT'
  form.value.amount = ''
  form.value.leverage = '10'
  submitPasswordInput.value = ''
  
  if (formRef.value) {
    formRef.value.resetFields()
  }
}

// 初始化
onMounted(async () => {
  // 检查是否需要密码
  try {
    const needPassword = await checkPasswordRequirement()
    isPasswordVerified.value = !needPassword
  } finally {
    isCheckingPasswordRequirement.value = false
  }
  
  // 如果有配置，设置默认交易对
  const symbols = botStore.config?.symbols
  if (symbols && symbols.length > 0 && symbols[0]) {
    form.value.symbol = symbols[0]
  }
})
</script>

<style scoped>
.card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.password-gate {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.password-checking {
  padding: 8px 0;
}

.form-hint {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.current-price-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding: 10px;
  background: #f5f7fa;
  border-radius: 4px;
}

.price-label {
  font-size: 14px;
  color: #606266;
}

.price-value {
  font-size: 16px;
  font-weight: 600;
  color: #409eff;
  flex: 1;
}

.risk-warning {
  margin-top: 20px;
}

@media (max-width: 768px) {
  .current-price-info {
    flex-wrap: wrap;
  }
}
</style>