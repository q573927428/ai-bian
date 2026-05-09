import { callAIWithJSON, getProviderConfig } from '../../utils/ai-service'
import type { AIProvider } from '../../../types/strategy'

interface GenerateStructuredRulesBody {
  userPrompt: string
  provider?: AIProvider
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<GenerateStructuredRulesBody>(event)
    const userPrompt = (body.userPrompt || '').trim()
    const provider = body.provider || 'deepseek'

    if (!userPrompt) {
      throw createError({ statusCode: 400, message: 'userPrompt 不能为空' })
    }

    const runtimeConfig = useRuntimeConfig()
    const providerConfig = getProviderConfig(provider, runtimeConfig)

    const systemPrompt = `你是交易规则 DSL 生成器。请将用户自然语言交易提示词转换为直观可读的 DSL。

严格要求：
1) 仅输出 JSON，不要 markdown。
2) JSON 结构固定为：{"dsl":"..."}。
3) dsl 中必须包含 LONG: 与 SHORT: 两个段落。
4) 使用 AND / OR / () 组织条件，保持简洁直观。
5) 不确定时使用保守最小规则，但必须合法。`

    const userContent = `请将以下交易提示词转换为 DSL:\n\n${userPrompt}`

    const aiResult = await callAIWithJSON<any>(
      providerConfig,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      { temperature: 0.1, maxTokens: 1800, responseFormat: { type: 'json_object' } }
    )

    const { normalized, warnings } = normalizeDslRules(aiResult, userPrompt)

    return {
      success: true,
      data: {
        structuredRules: normalized,
        warnings
      }
    }
  } catch (error: any) {
    throw createError({
      statusCode: error?.statusCode || 500,
      message: `生成 DSL 规则失败: ${error?.message || '未知错误'}`
    })
  }
})

function normalizeDslRules(input: any, userPrompt: string): { normalized: any; warnings: string[] } {
  const warnings: string[] = []
  const safe = input && typeof input === 'object' ? input : {}
  const rawDsl = typeof safe.dsl === 'string' ? safe.dsl.trim() : ''
  let dsl = rawDsl

  if (!dsl) {
    warnings.push('AI 未返回 dsl，已回退为基础模板')
    dsl = `LONG:\n- 待补充\n\nSHORT:\n- 待补充`
  }

  if (!/LONG\s*:/i.test(dsl)) {
    warnings.push('dsl 缺少 LONG 段落，已补全占位')
    dsl = `LONG:\n- 待补充\n\n${dsl}`
  }
  if (!/SHORT\s*:/i.test(dsl)) {
    warnings.push('dsl 缺少 SHORT 段落，已补全占位')
    dsl = `${dsl}\n\nSHORT:\n- 待补充`
  }

  const normalized = { dsl }
  void userPrompt
  return { normalized, warnings }
}
