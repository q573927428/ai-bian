// ==================== 敏感请求失效通知与禁止自动重试交易 ====================
import { defineNuxtPlugin } from '#app'

export default defineNuxtPlugin(() => {
  globalThis.$fetch = globalThis.$fetch.create({
    // 所有请求显式关闭自动重试，避免开平仓在超时后重复提交。
    retry: 0,
    onResponseError({ request, response }) {
      const path = String(request).split('?')[0] || ''
      // 密码输错时保留当前弹窗和待办，允许重试；仅业务 API 的 401 清理已解锁状态。
      if (response.status === 401 && path.startsWith('/api/') && path !== '/api/bot/check-password') {
        window.dispatchEvent(new Event('operation-auth-expired'))
      }
    },
  })
})
