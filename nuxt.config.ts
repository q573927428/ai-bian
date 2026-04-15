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
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    deepseekApiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
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

  // 路径别名配置
  alias: {
    '~': '.',
    '@': '.',
  },
})
