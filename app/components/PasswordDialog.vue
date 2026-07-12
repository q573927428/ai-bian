<!-- 密码验证对话框 -->
<template>
  <el-dialog
    v-model="visible"
    title="请输入密码验证"
    :close-on-click-modal="false"
    :style="{ width: '90%', maxWidth: '400px' }"
    @closed="handleClosed"
  >
    <el-form :model="form" label-width="0">
      <el-form-item>
        <el-input
          v-model="form.password"
          type="password"
          placeholder="请输入操作密码"
          show-password
          @keyup.enter="handleConfirm"
          ref="passwordInput"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="handleCancel">取消</el-button>
      <el-button type="primary" @click="handleConfirm" :loading="loading">确认</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'

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

const form = ref({
  password: ''
})
const loading = ref(false)
const passwordInput = ref()

// 待关闭后触发的成功回调
let pendingSuccess = false

// 检查是否需要密码
const checkRequiresPassword = async (): Promise<boolean> => {
  try {
    const res = await $fetch<any>('/api/bot/check-password')
    if (res.success && !res.requiresPassword) {
      return false
    }
    return true
  } catch (error: any) {
    ElMessage.error('检查密码配置失败: ' + (error.message || '未知错误'))
    return true
  }
}

const handleConfirm = async () => {
  if (!form.value.password.trim()) {
    ElMessage.warning('请输入密码')
    return
  }

  loading.value = true
  try {
    const res = await $fetch<any>('/api/bot/check-password', {
      method: 'POST',
      body: { password: form.value.password }
    })

    if (res.success) {
      ElMessage.success('验证成功')
      // 先关闭对话框，emit('success') 延迟到 @closed 中执行
      pendingSuccess = true
      visible.value = false
    } else {
      ElMessage.error(res.message || '密码错误')
    }
  } catch (error: any) {
    ElMessage.error('验证失败: ' + (error.message || '未知错误'))
  } finally {
    loading.value = false
  }
}

const handleCancel = () => {
  visible.value = false
}

const handleClosed = () => {
  form.value.password = ''
  // 对话框完全关闭后，再触发 success 事件
  if (pendingSuccess) {
    pendingSuccess = false
    emit('success')
  }
}

watch(visible, async (newVal) => {
  if (newVal) {
    const requiresPassword = await checkRequiresPassword()
    if (!requiresPassword) {
      // 不需要密码，直接关闭，成功事件会在 @closed 中触发
      pendingSuccess = true
      visible.value = false
      return
    }
    nextTick(() => {
      passwordInput.value?.focus()
    })
  }
})
</script>



