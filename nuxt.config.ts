// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },

  hooks: {
    'app:resolve'(app) {
      // Nuxt 4.5.0 无法识别该内置插件的组合导出语法并会将其忽略；提前移除以避免 NUXT_B2005 误报。
      app.plugins = app.plugins.filter(
        plugin => !plugin.src.replaceAll('\\', '/').endsWith('/pages/runtime/plugins/check-if-page-unused.js'),
      )
    },
  },
  
  modules: [
    '@element-plus/nuxt',
    '@pinia/nuxt',
    'nuxt-echarts',
  ],

  css: ['~/assets/css/common.css'],

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
    // 豆包 Agent Plan 配置（与普通豆包使用独立环境变量，避免相互覆盖）
    doubaoAgentApiKey: process.env.DOUBAO_AGENT_API_KEY || '',
    doubaoAgentApiUrl: process.env.DOUBAO_AGENT_API_URL || 'https://ark.cn-beijing.volces.com/api/plan/v3',
    doubaoAgentModel: process.env.DOUBAO_AGENT_MODEL || 'doubao-seed-2.0-lite',
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
    rollupConfig: {
      // node:sqlite 是 Node.js 内置模块，应由运行时提供，不能作为 npm 包参与打包解析。
      external: ['node:sqlite'],
    },
  },
  vite: {
    optimizeDeps: {
      include: [
        'dayjs', // CJS
        'dayjs/plugin/*.js',
        'lightweight-charts',
        'pinia',
      ]
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            // 把大第三方库单独拆包
            if (id.includes('node_modules/vue/')) {return 'vendor-vue'}
            if (id.includes('echarts') || id.includes('tradingview')) return 'vendor-chart'
            if (id.includes('element-plus')) return 'element-plus'
            if (id.includes('lightweight-charts')) return 'lightweight-charts'
            if (id.includes('technicalindicators')) return 'technicalindicators'
            if (id.includes('ccxt')) return 'ccxt'
            if (id.includes('vue-router')) return 'vue-router'
            if (id.includes('pinia')) return 'pinia'
          }
        }
      },
      chunkSizeWarningLimit: 1500,
    }
  },

  typescript: {
    strict: true,
    typeCheck: false,
    tsConfig: {
      compilerOptions: {
        libReplacement: false,
      },
    },
  },
  
})
