export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const config = useRuntimeConfig()
    
    const { password } = body
    const configPassword = config.configEditPassword
    
    // 如果没有设置密码，则不需要验证
    if (!configPassword) {
      return {
        success: true,
        message: '密码验证成功',
        requiresPassword: false,
      }
    }
    
    // 验证密码
    if (password === configPassword) {
      return {
        success: true,
        message: '密码验证成功',
        requiresPassword: true,
      }
    } else {
      return {
        success: false,
        message: '密码错误',
        requiresPassword: true,
      }
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '密码验证失败',
    }
  }
})
