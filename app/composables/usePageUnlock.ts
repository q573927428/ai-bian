// ==================== 首页解锁状态与验证后操作恢复 ====================
import { onMounted, ref } from 'vue'
import type { HomeProtectedPanel } from '../../types/home'

/** 由页面提供面板打开及锁定清理行为，避免解锁模块依赖具体组件。 */
interface PageUnlockOptions {
  onOpen: (panel: HomeProtectedPanel) => void
  onLock: () => void
}

const PASSWORD_STORAGE_KEY = 'page_password_verified'
const VERIFICATION_MAX_AGE = 24 * 60 * 60 * 1000

/** 管理本页解锁有效期，并在验证成功后恢复用户选择的受保护入口。 */
export function usePageUnlock(options: PageUnlockOptions) {
  const passwordVerified = ref(false)
  const showPasswordDialog = ref(false)
  const hasPassword = ref(false)
  const pendingPanel = ref<HomeProtectedPanel | null>(null)

  /** 独立解锁不恢复之前取消验证时留下的面板请求。 */
  function handleUnlock() {
    pendingPanel.value = null
    showPasswordDialog.value = true
  }

  /** 所有受保护入口统一经过此门禁，验证成功后无需再次点击。 */
  function handleOpenProtectedPanel(panel: HomeProtectedPanel) {
    if (!passwordVerified.value) {
      pendingPanel.value = panel
      showPasswordDialog.value = true
      return
    }
    options.onOpen(panel)
  }

  /** 保存验证时间并消费本次待办，避免后续解锁重复打开旧面板。 */
  function handlePasswordSuccess() {
    passwordVerified.value = true
    hasPassword.value = true
    localStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify({ verified: true, timestamp: Date.now() }))
    const panel = pendingPanel.value
    pendingPanel.value = null
    if (panel) options.onOpen(panel)
  }

  /** 锁定时同时关闭受保护面板，防止已打开的内容继续展示。 */
  function clearPassword() {
    passwordVerified.value = false
    hasPassword.value = false
    pendingPanel.value = null
    localStorage.removeItem(PASSWORD_STORAGE_KEY)
    options.onLock()
  }

  // 仅在浏览器挂载后访问存储，保持服务端渲染时的默认锁定状态。
  onMounted(() => {
    const stored = localStorage.getItem(PASSWORD_STORAGE_KEY)
    if (!stored) return
    try {
      const data = JSON.parse(stored)
      if (Date.now() - data.timestamp < VERIFICATION_MAX_AGE) {
        passwordVerified.value = true
        hasPassword.value = true
      } else {
        localStorage.removeItem(PASSWORD_STORAGE_KEY)
      }
    } catch {
      localStorage.removeItem(PASSWORD_STORAGE_KEY)
    }
  })

  return { passwordVerified, showPasswordDialog, hasPassword, handleUnlock, handleOpenProtectedPanel, handlePasswordSuccess, clearPassword }
}
