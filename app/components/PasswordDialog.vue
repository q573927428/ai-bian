<!-- 密码验证对话框 -->
<template>
  <el-dialog
    v-model="visible"
    title="请输入密码验证"
    width="400px"
    :close-on-click-modal="false"
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
import { ElMessage } from 'element-plus'

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
const checkingPassword = ref(false)
const passwordInput = ref()

// 检查是否需要密码
const checkRequiresPassword = async () => {
  try {
    checkingPassword.value = true
    const res = await $fetch<any>('/api/bot/check-password')
    if (res.success && !res.requiresPassword) {
      // 不需要密码，直接成功
      emit('success')
      visible.value = false
      return false
    }
    return true
  } catch (error: any) {
    ElMessage.error('检查密码配置失败: ' + (error.message || '未知错误'))
    return true
  } finally {
    checkingPassword.value = false
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
      visible.value = false
      emit('success')
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
}

watch(visible, async (newVal) => {
  if (newVal) {
    // 检查是否需要密码
    const requiresPassword = await checkRequiresPassword()
    if (requiresPassword) {
      nextTick(() => {
        passwordInput.value?.focus()
      })
    }
  }
})
</script>