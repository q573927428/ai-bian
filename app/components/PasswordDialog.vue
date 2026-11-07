<!-- ==================== 管理员账号密码登录弹窗 ==================== -->
<template>
  <el-dialog
    v-model="visible"
    title="账号登录"
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    :show-close="!loading"
    :style="{ width: '90%', maxWidth: '400px' }"
    append-to-body
    @closed="handleClosed"
    draggable
  >
    <el-form :model="form" label-position="top" @submit.prevent="handleConfirm">
      <el-form-item label="账号">
        <el-input
          v-model="form.username"
          name="username"
          autocomplete="username"
          placeholder="请输入账号"
          size="large"
          :disabled="loading"
          ref="usernameInput"
        />
      </el-form-item>
      <el-form-item label="密码">
        <el-input
          v-model="form.password"
          name="password"
          autocomplete="current-password"
          type="password"
          placeholder="请输入密码"
          size="large"
          :disabled="loading"
          show-password
        />
      </el-form-item>
      <div class="login-actions">
        <el-button @click="handleCancel" :disabled="loading">取消</el-button>
        <el-button type="primary" native-type="submit" :loading="loading">登录</el-button>
      </div>
    </el-form>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'

/** 登录弹窗的外部控制参数，沿用现有入口与成功事件。 */
interface Props {
  modelValue: boolean
}

/** 服务端签发 Cookie 后仅通知验证完成，不向调用方传播明文密码。 */
interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'success'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// 先确认 Cookie 状态，再显示输入框，避免已解锁操作仍闪现密码弹窗。
const needsPassword = ref(false)
const visible = computed({
  get: () => props.modelValue && needsPassword.value,
  set: (val) => emit('update:modelValue', val)
})

const form = ref({
  username: '',
  password: ''
})
const loading = ref(false)
const usernameInput = ref()

// 待关闭后触发的成功回调
let pendingSuccess = false

// 检查是否需要密码
const checkRequiresPassword = async (): Promise<boolean> => {
  try {
    const res = await $fetch<any>('/api/bot/check-password')
    if (res.success && res.verified) {
      return false
    }
    return true
  } catch (error: any) {
    ElMessage.error('检查登录状态失败: ' + (error.message || '未知错误'))
    return true
  }
}

/** 账号去除首尾空格，密码保留原值，由服务端签发 HttpOnly 登录凭证。 */
const handleConfirm = async () => {
  if (loading.value) return
  if (!form.value.username.trim()) {
    ElMessage.warning('请输入账号')
    return
  }
  if (!form.value.password.trim()) {
    ElMessage.warning('请输入密码')
    return
  }

  loading.value = true
  try {
    const res = await $fetch<any>('/api/bot/check-password', {
      method: 'POST',
      body: { username: form.value.username.trim(), password: form.value.password }
    })

    if (res.success) {
      ElMessage.success('登录成功')
      // 先关闭对话框，emit('success') 延迟到 @closed 中执行
      form.value.password = ''
      pendingSuccess = true
      visible.value = false
    } else {
      ElMessage.error(res.message || '账号或密码错误')
    }
  } catch (error: any) {
    ElMessage.error(error.data?.data?.message || error.data?.message || error.data?.statusMessage || '登录失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

const handleCancel = () => {
  visible.value = false
}

const handleClosed = () => {
  form.value.username = ''
  form.value.password = ''
  // 对话框完全关闭后，再触发 success 事件
  if (pendingSuccess) {
    pendingSuccess = false
    emit('success')
  }
}

watch(() => props.modelValue, async (newVal, _previous, onCleanup) => {
  let cancelled = false
  onCleanup(() => { cancelled = true })
  needsPassword.value = false
  if (newVal) {
    const requiresPassword = await checkRequiresPassword()
    // 取消或锁定后丢弃迟到的查询结果，不能继续执行原先待办。
    if (cancelled || !props.modelValue) return
    if (!requiresPassword) {
      // 未展示对话框就没有 closed 事件，直接通知调用方继续操作。
      emit('update:modelValue', false)
      emit('success')
      return
    }
    needsPassword.value = true
    nextTick(() => {
      usernameInput.value?.focus()
    })
  }
}, { immediate: true })
</script>

<style scoped>
.login-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>



