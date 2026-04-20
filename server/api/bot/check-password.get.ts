export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const { password } = query
    
    if (!password) {
      return {
        success: false,
        message: '密码不能为空'
      }
    }
    
    // 默认密码为202050，可根据需要修改
    const correctPassword = '202050'
    
    if (password === correctPassword) {
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
  } catch (error: any) {
    return {
      success: false,
      message: error.message || '验证失败'
    }
  }
})