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
  responseFormat?: { type: 'json_object' | 'text' }
}

/**
 * 获取 AI 提供商配置
 */
export function getProviderConfig(provider: AIProvider, runtimeConfig: any): AIProviderConfig {
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
    maxTokens = 1000,
    responseFormat = { type: 'json_object' }
  } = options

  // 检查 API Key 是否配置
  if (!providerConfig.apiKey) {
    throw new Error('API Key 未配置')
  }

  const response = await fetch(`${providerConfig.apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: providerConfig.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: responseFormat
    }),
  })

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