// ==================== AI 服务工具 ====================

import type { AIProvider } from '../../types/strategy'
import { logger } from './logger'

/**
 * AI 提供商配置
 */
export interface AIProviderConfig {
  apiKey: string
  apiUrl: string
  model: string
}

/**
 * AI 聊天消息
 */
export interface AIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * AI 调用选项
 */
export interface AICallOptions {
  temperature?: number
  maxTokens?: number
  thinkingEnabled?: boolean
  thinkingProvider?: AIProvider
  responseFormat?: { type: 'json_object' | 'text' }
  timeoutMs?: number
}

/**
 * 获取 AI 提供商配置
 * @param overrides 可选的自定义配置（来自策略的 aiPrompt），可覆盖默认值
 */
export function getProviderConfig(provider: AIProvider, runtimeConfig: any, overrides?: { apiKey?: string; apiUrl?: string; model?: string }): AIProviderConfig {
  const baseConfig = (() => {
    switch (provider) {
      case 'deepseek':
        return {
          apiKey: runtimeConfig.deepseekApiKey,
          apiUrl: runtimeConfig.deepseekApiUrl,
          model: runtimeConfig.deepseekModel
        }
      case 'doubao':
        return {
          apiKey: runtimeConfig.doubaoApiKey,
          apiUrl: runtimeConfig.doubaoApiUrl,
          model: runtimeConfig.doubaoModel
        }
      case 'doubao-agent':
        return {
          apiKey: runtimeConfig.doubaoAgentApiKey,
          apiUrl: runtimeConfig.doubaoAgentApiUrl,
          model: runtimeConfig.doubaoAgentModel
        }
      case 'qwen':
        return {
          apiKey: runtimeConfig.qwenApiKey,
          apiUrl: runtimeConfig.qwenApiUrl,
          model: runtimeConfig.qwenModel
        }
      case 'openai':
        return {
          apiKey: runtimeConfig.openaiApiKey,
          apiUrl: runtimeConfig.openaiApiUrl,
          model: runtimeConfig.openaiModel
        }
      default:
        throw new Error(`不支持的 AI 提供商: ${provider}`)
    }
  })()

  // 如果有自定义覆盖配置，则合并（优先使用自定义值）
  if (overrides) {
    // 对于内置已知提供商，忽略策略级别的 apiUrl/apiKey 覆盖，防止策略绕过服务端配置。
    // 仅当 provider 为 'openai'（开放兼容适配）时，允许自定义 apiUrl/apiKey
    const isKnownProvider = ['deepseek', 'doubao', 'doubao-agent', 'qwen'].includes(provider)
    return {
      apiKey: !isKnownProvider && overrides.apiKey ? overrides.apiKey : baseConfig.apiKey,
      apiUrl: !isKnownProvider && overrides.apiUrl ? overrides.apiUrl : baseConfig.apiUrl,
      model: overrides.model || baseConfig.model
    }
  }

  return baseConfig
}

/**
 * 调用 AI API（OpenAI 兼容格式）
 */
export async function callAIAPI(
  providerConfig: AIProviderConfig,
  messages: AIChatMessage[],
  options: AICallOptions = {}
): Promise<string> {
  const {
    temperature = 0.5,
    maxTokens = 3000,
    responseFormat = { type: 'json_object' },
    timeoutMs = 45000
  } = options

  // 检查 API Key 是否配置
  if (!providerConfig.apiKey) {
    throw new Error('API Key 未配置')
  }

  // 构建请求体 - 火山引擎方舟平台不支持 response_format 参数
  const requestBody: Record<string, any> = {
    model: providerConfig.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  }

  const isOpenAIReasoningModel = options.thinkingProvider === 'openai' && /^(gpt-5|o[1345])/.test(providerConfig.model.toLowerCase())
  // OpenAI 推理模型不接受 temperature；普通模型仍保持原有请求参数。
  if (isOpenAIReasoningModel) {
    delete requestBody.temperature
  }

  // 不同厂商的思考参数不一致，且普通模型不应接收推理参数，因此只对已知思考模型透传。
  if (typeof options.thinkingEnabled === 'boolean' && options.thinkingProvider) {
    const provider = options.thinkingProvider
    const model = providerConfig.model.toLowerCase()
    if (provider === 'deepseek' && /(v4|reasoner)/i.test(model)) {
      requestBody.thinking = { type: options.thinkingEnabled ? 'enabled' : 'disabled' }
    } else if ((provider === 'doubao' || provider === 'doubao-agent') && /(seed-2|thinking|reasoning)/i.test(model)) {
      requestBody.thinking = { type: options.thinkingEnabled ? 'enabled' : 'disabled' }
    } else if (provider === 'qwen' && /(qwen3|thinking|reasoning)/i.test(model)) {
      requestBody.enable_thinking = options.thinkingEnabled
    } else if (provider === 'openai' && /^(gpt-5|o[1345])/.test(model)) {
      requestBody.reasoning_effort = options.thinkingEnabled ? 'low' : 'none'
    }
  }

  // 仅当 responseFormat 为 json_object 且提供商不是 doubao 时才添加
  // 火山引擎方舟平台不支持 response_format 参数
  if (responseFormat && responseFormat.type === 'json_object' && providerConfig.apiUrl.indexOf('volces.com') === -1) {
    requestBody.response_format = responseFormat
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`${providerConfig.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${providerConfig.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`API请求失败: ${response.statusText}`)
  }

  const result = await response.json()
  const content = (result.choices?.[0]?.message?.content as string) || '{}'

  return content
}

/**
 * 提取 JSON 内容（可能包含 markdown 代码块）
 */
export function extractJSONContent(content: string): string {
  try {
    // 首先尝试直接解析
    JSON.parse(content)
    return content
  } catch {
    // 继续处理
  }

  // 尝试提取代码块
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/```\s*([\s\S]*?)\s*```/)
  if (jsonMatch && jsonMatch[1]) {
    try {
      JSON.parse(jsonMatch[1])
      return jsonMatch[1]
    } catch {
      // 继续处理
    }
  }

  // 尝试提取第一个 {} 之间的内容
  const firstBrace = content.indexOf('{')
  const lastBrace = content.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const extracted = content.slice(firstBrace, lastBrace + 1)
    try {
      JSON.parse(extracted)
      return extracted
    } catch {
      // 继续处理
    }
  }

  // 尝试修复常见的 JSON 错误
  let cleaned = content
    // 移除所有控制字符（U+0000-U+001F），这些字符在 JSON 字符串中必须转义，否则 JSON.parse 失败
    .replace(/[\x00-\x1F]/g, '')
    .replace(/,\s*}/g, '}') // 移除多余的逗号
    .replace(/,\s*]/g, ']') // 移除多余的逗号
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // 给未加引号的键名添加引号
    .replace(/:\s*'([^']*)'/g, ':"$1"') // 将单引号字符串改为双引号

  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    // 如果都失败，返回原始内容
    return content
  }
}

/**
 * 调用 AI 并解析 JSON 结果（便捷方法）
 */
export async function callAIWithJSON<T = any>(
  providerConfig: AIProviderConfig,
  messages: AIChatMessage[],
  options: AICallOptions = {}
): Promise<T> {
  const content = await callAIAPI(providerConfig, messages, options)
  const jsonContent = extractJSONContent(content)
  return JSON.parse(jsonContent)
}
