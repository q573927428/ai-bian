export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const config = useRuntimeConfig()
    const { password } = body
    const configPassword = config.configEditPassword
    
    if (!password) {
      return {
        success: false,
        message: '密码不能为空'
      }
    }
    
    // 如果设置了密码，需要验证
    if (configPassword && configPassword.length > 0) {
      if (password === configPassword) {
        return {
          success: true,
          message: '密码验证通过'
        }
      } else {
        return {
          success: false,
          message: '密码错误'
        }
      }
    } else {
      // 没有设置密码，直接通过
      return {
        success: true,
        message: '密码验证通过（未设置密码）'
      }
    }
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '验证失败'
    }
  }
})