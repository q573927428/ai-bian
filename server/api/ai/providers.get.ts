// ==================== 获取已配置的 AI 提供商列表 ====================

export default defineEventHandler(async (event) => {
  try {
    const config = useRuntimeConfig()
    
    const providers = [
      {
        id: 'deepseek',
        name: 'DeepSeek',
        configured: !!(config.deepseekApiKey && config.deepseekApiKey !== '')
      },
      {
        id: 'doubao',
        name: '豆包 (Doubao)',
        configured: !!(config.doubaoApiKey && config.doubaoApiKey !== '')
      },
      {
        id: 'qwen',
        name: '阿里千问 (Qwen)',
        configured: !!(config.qwenApiKey && config.qwenApiKey !== '')
      },
      {
        id: 'openai',
        name: 'OpenAI 兼容',
        configured: !!(config.openaiApiKey && config.openaiApiKey !== '')
      }
    ]

    return {
      success: true,
      data: providers
    }
  } catch (error: any) {
    console.error('获取 AI 提供商列表失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
})