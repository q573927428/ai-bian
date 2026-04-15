export default defineEventHandler(async () => {
  try {
    const config = useRuntimeConfig()
    const configPassword = config.configEditPassword
    
    // 检查是否需要密码保护
    return {
      success: true,
      requiresPassword: !!configPassword && configPassword.length > 0,
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '检查密码配置失败',
      requiresPassword: false,
    }
  }
})
