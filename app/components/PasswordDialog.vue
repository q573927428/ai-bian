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
import { ref, watch, nextTick, computed, onBeforeUnmount } from 'vue'

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

// 防止组件卸载后执行异步回调
let isUnmounted = false
onBeforeUnmount(() => {
  isUnmounted = true
})

// 检查是否需要密码
const checkRequiresPassword = async (): Promise<boolean> => {
  try {
    checkingPassword.value = true
    const res = await $fetch<any>('/api/bot/check-password')
    if (isUnmounted) return false
    if (res.success && !res.requiresPassword) {
      // 不需要密码，由 watch 的调用方处理关闭和事件
      return false
    }
    return true
  } catch (error: any) {
    if (isUnmounted) return false
    ElMessage.error('检查密码配置失败: ' + (error.message || '未知错误'))
    return true
  } finally {
    if (!isUnmounted) {
      checkingPassword.value = false
    }
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

    if (!isUnmounted && res.success) {
      ElMessage.success('验证成功')
      visible.value = false
      emit('success')
    } else {
      if (!isUnmounted) {
        ElMessage.error(res.message || '密码错误')
      }
    }
  } catch (error: any) {
    if (!isUnmounted) {
      ElMessage.error('验证失败: ' + (error.message || '未知错误'))
    }
  } finally {
    if (!isUnmounted) {
      loading.value = false
    }
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
    if (isUnmounted) return
    if (!requiresPassword) {
      // 不需要密码，直接关闭对话框并触发成功事件
      visible.value = false
      emit('success')
      return
    }
    nextTick(() => {
      if (!isUnmounted) {
        passwordInput.value?.focus()
      }
    })
  }
})
</script>



