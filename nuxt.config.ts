// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-04-03',
  devtools: { enabled: true },
  
  modules: [
    '@element-plus/nuxt',
    '@pinia/nuxt',
    'nuxt-echarts',
  ],

  runtimeConfig: {
    // 私有配置（仅服务端可用）
    binanceApiKey: process.env.BINANCE_API_KEY || '',
    binanceSecret: process.env.BINANCE_SECRET || '',
    // AI 提供商配置
    aiProvider: process.env.AI_PROVIDER || 'deepseek',
    // DeepSeek 配置
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    deepseekApiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    // 豆包 (Doubao) 配置
    doubaoApiKey: process.env.DOUBAO_API_KEY || '',
    doubaoApiUrl: process.env.DOUBAO_API_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    doubaoModel: process.env.DOUBAO_MODEL || 'doubao-seed-2-0-pro',
    // 阿里千问 (Qwen) 配置
    qwenApiKey: process.env.QWEN_API_KEY || '',
    qwenApiUrl: process.env.QWEN_API_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    qwenModel: process.env.QWEN_MODEL || 'qwen-plus',
    // OpenAI 兼容配置
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiApiUrl: process.env.OPENAI_API_URL || 'https://api.openai.com/v1',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    // 其他配置
    configEditPassword: process.env.CONFIG_EDIT_PASSWORD || '',
    
    // 公开配置（客户端和服务端都可用）
    public: {
      apiBase: '/api',
    },
  },

  nitro: {
    esbuild: {
      options: {
        target: 'esnext',
      },
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },
  
})
