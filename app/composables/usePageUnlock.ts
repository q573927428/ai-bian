// ==================== 服务端解锁状态与敏感面板生命周期 ====================
import { inject, onMounted, onUnmounted, ref, watch } from 'vue'
import type { InjectionKey, Ref } from 'vue'
import type { HomeProtectedPanel } from '../../types/home'

/** 面板打开与锁定清理回调，授权结果始终来自后端。 */
interface PageUnlockOptions {
  onOpen: (panel: HomeProtectedPanel) => void
  onLock: () => void
}

/** 全局共享服务端验证状态；pending 合并同一次挂载产生的并发检查。 */
export interface SharedPageUnlock {
  passwordVerified: Ref<boolean>
  hasPassword: Ref<boolean>
  expiresAt: Ref<number | null>
  pending?: Promise<void>
  generation?: number
}
export const PAGE_UNLOCK_KEY: InjectionKey<SharedPageUnlock> = Symbol('page-unlock')

/** 输入一次后复用 HttpOnly Cookie；刷新、到期和锁定均与服务端状态一致。 */
export function usePageUnlock(options: PageUnlockOptions) {
  const state = inject(PAGE_UNLOCK_KEY, null) ?? {
    passwordVerified: ref(false), hasPassword: ref(false), expiresAt: ref<number | null>(null),
  } as SharedPageUnlock
  const { passwordVerified, hasPassword, expiresAt } = state
  const showPasswordDialog = ref(false)
  const pendingPanel = ref<HomeProtectedPanel | null>(null)
  let expiryTimer: ReturnType<typeof setTimeout> | undefined

  /** 本地锁定只清理展示；实际操作仍必须通过服务端 Cookie 校验。 */
  function resetState() {
    state.generation = (state.generation || 0) + 1
    passwordVerified.value = false
    expiresAt.value = null
    pendingPanel.value = null
    showPasswordDialog.value = false
  }

  /** 查询真实 Cookie 状态，丢弃锁定前已发出的迟到响应。 */
  async function refreshStatus() {
    if (state.pending) return state.pending
    const generation = state.generation || 0
    state.pending = (async () => {
      try {
        const status = await $fetch<{ success: boolean; configured: boolean; verified: boolean; expiresAt: number | null }>('/api/bot/check-password')
        if ((state.generation || 0) !== generation) return
        hasPassword.value = status.configured
        expiresAt.value = status.expiresAt
        passwordVerified.value = status.success && status.verified && Number(status.expiresAt) > Date.now()
      } catch {
        if ((state.generation || 0) === generation) resetState()
      }
    })().finally(() => { state.pending = undefined })
    return state.pending
  }

  watch(passwordVerified, verified => {
    if (!verified) {
      pendingPanel.value = null
      showPasswordDialog.value = false
      options.onLock()
    }
  }, { flush: 'sync' })

  watch(expiresAt, expires => {
    if (expiryTimer) clearTimeout(expiryTimer)
    if (expires) expiryTimer = setTimeout(resetState, Math.max(0, expires - Date.now()))
  })

  function handleUnlock() {
    pendingPanel.value = null
    showPasswordDialog.value = true
  }

  function handleOpenProtectedPanel(panel: HomeProtectedPanel) {
    if (!passwordVerified.value) {
      pendingPanel.value = panel
      showPasswordDialog.value = true
    } else options.onOpen(panel)
  }

  /** 弹窗成功后再读取服务端状态，不接受页面自行设置的授权标记。 */
  async function handlePasswordSuccess() {
    // 登录前发出的状态查询可能尚未完成；先等待再读取新 Cookie，避免误判未解锁。
    if (state.pending) await state.pending
    await refreshStatus()
    if (!passwordVerified.value) return
    const panel = pendingPanel.value
    pendingPanel.value = null
    if (panel) options.onOpen(panel)
  }

  /** 先通知服务端清除 Cookie；失败时保留解锁状态，避免误以为已退出。 */
  async function clearPassword() {
    await $fetch('/api/bot/lock', { method: 'POST', body: {} })
    const wasVerified = passwordVerified.value
    resetState()
    if (!wasVerified) options.onLock()
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('operation-auth-locked'))
  }

  function onFocus() { void refreshStatus() }
  onMounted(() => {
    // 清理旧版本的本地标记，但绝不用于恢复权限。
    try { localStorage.removeItem('page_password_verified') } catch { /* 禁用存储不影响 Cookie 验证。 */ }
    void refreshStatus()
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus)
      window.addEventListener('operation-auth-expired', resetState)
      window.addEventListener('operation-auth-locked', resetState)
    }
  })
  onUnmounted(() => {
    if (expiryTimer) clearTimeout(expiryTimer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('operation-auth-expired', resetState)
      window.removeEventListener('operation-auth-locked', resetState)
    }
  })

  return { passwordVerified, showPasswordDialog, hasPassword, handleUnlock, handleOpenProtectedPanel, handlePasswordSuccess, clearPassword }
}
