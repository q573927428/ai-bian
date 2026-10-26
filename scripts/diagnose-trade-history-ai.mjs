// ==================== 历史交易 AI 完整链路诊断 ====================
// 用法：node scripts/diagnose-trade-history-ai.mjs [--model=deepseek-flash] [--thinking=disabled] [--max-tokens=8000] [--at=1791482709613]
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import dotenv from 'dotenv'
import { listTradeHistoryFiles, readTradeHistoryFiles } from '../server/utils/trade-history-files.ts'
const root = resolve(import.meta.dirname, '..')
dotenv.config({ path: join(root, '.env'), quiet: true })
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const index = arg.indexOf('=')
  if (!arg.startsWith('--') || index < 0) throw new Error('参数必须使用 --name=value')
  return [arg.slice(2, index), arg.slice(index + 1)]
}))
const at = options.at ? Number(options.at) : Date.now()
const maxTokens = options['max-tokens'] ? Number(options['max-tokens']) : null
if (!Number.isFinite(at) || (maxTokens !== null && (!Number.isInteger(maxTokens) || maxTokens <= 0))) throw new Error('时间戳或 max-tokens 无效')
const report = { startedAt: new Date().toISOString(), analysisAt: at, errors: [], responses: [] }
const historyPath = join(root, 'data/trade-history-analysis.json')
const original = await readFile(historyPath, 'utf8')
const trades = readTradeHistoryFiles(listTradeHistoryFiles(join(root, 'data')))
// 重放只使用指定时刻之前已平仓的现存记录；不能还原已删除或修改的历史数据。
const inputTrades = options.at ? trades.filter(trade => trade.closeTime <= at) : trades
report.inputTrades = inputTrades.length
const require = createRequire(import.meta.url)
const config = {
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  deepseekApiUrl: process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
}
if (!config.deepseekApiKey) throw new Error('DEEPSEEK_API_KEY 未配置')

/** 记录请求参数和完整响应，区分网络错误、HTTP 错误、截断和解析失败。 */
async function diagnosticFetch(url, init) {
  const body = JSON.parse(init.body)
  if (options.model) body.model = options.model
  if (maxTokens !== null) body.max_tokens = maxTokens
  if (options.thinking) body.thinking = { type: options.thinking }
  const entry = { requestedModel: body.model, maxTokens: body.max_tokens, thinking: body.thinking || 'API默认', promptChars: body.messages.map(m => m.content).join('').length }
  report.responses.push(entry)
  console.log('请求参数:', JSON.stringify(entry))
  const start = Date.now()
  try {
    // 原分析器没有超时；诊断加上 120 秒上限，避免测试无限挂起。
    const response = await fetch(url, { ...init, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
    entry.elapsedMs = Date.now() - start
    entry.status = response.status
    const raw = await response.clone().text()
    try {
      const parsed = JSON.parse(raw)
      entry.returnedModel = parsed.model
      entry.finishReason = parsed.choices?.[0]?.finish_reason
      entry.usage = parsed.usage
      entry.content = parsed.choices?.[0]?.message?.content
      entry.reasoningContent = parsed.choices?.[0]?.message?.reasoning_content
      entry.apiError = parsed.error
    } catch { entry.rawResponse = raw }
    console.log('响应摘要:', JSON.stringify({ ...entry, content: undefined, reasoningContent: undefined }))
    return response
  } catch (error) {
    entry.elapsedMs = Date.now() - start
    entry.networkError = { message: error.message, cause: error.cause?.message, code: error.cause?.code }
    throw error
  }
}

// 编译并执行真实源码，保留原提示词、数据处理和 JSON 校验，避免测试副本偏离生产逻辑。
const source = await readFile(join(root, 'server/utils/trade-history-analyzer.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
const sandbox = {
  module, exports: module.exports,
  require(name) {
    // 捕获生产错误日志，诊断运行仍仅写独立报告。
    if (name === './logger') return { logger: { error: (category, message, data) => {
      report.errors.push('[' + category + '] ' + message)
      console.error(message, data)
    } } }
    if (name === 'fs/promises') return {
      readFile: async path => readFile(path, 'utf8'),
      // 拦截分析结果写入，避免测试追加或覆盖正式历史分析文件。
      writeFile: async (_path, data) => { report.result = JSON.parse(data).at(-1) },
    }
    if (name === './trade-history-files') return { readTradeHistoryFiles: () => inputTrades }
    return require(name)
  },
  process: { cwd: () => root }, useRuntimeConfig: () => config, fetch: diagnosticFetch,
  Date: class extends Date { static now() { return at } },
  console: {
    ...console,
    error: (...args) => { report.errors.push(args.map(String).join(' ')); console.error(...args) },
    warn: (...args) => { report.errors.push(args.map(String).join(' ')); console.warn(...args) },
  },
  setTimeout, clearTimeout, AbortSignal,
}
try {
  vm.runInNewContext(compiled, sandbox, { filename: 'trade-history-analyzer.cjs' })
  const result = await module.exports.performTradeHistoryAnalysis()
  report.result = result
  report.success = !result.summary.includes('AI深度分析暂不可用') && report.responses.length > 0
} catch (error) {
  report.success = false
  report.errors.push(error.stack || error.message)
} finally {
  report.historyUnchanged = original === await readFile(historyPath, 'utf8')
  const directory = join(root, 'logs/diagnostics')
  await mkdir(directory, { recursive: true })
  const output = join(directory, `trade-history-ai-${Date.now()}.json`)
  // 不保存请求头、密钥或完整交易数据；报告保存 AI 响应和失败证据。
  await writeFile(output, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ success: report.success, errors: report.errors, historyUnchanged: report.historyUnchanged, output }, null, 2))
  if (!report.success) process.exitCode = 1
}
