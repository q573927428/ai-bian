// ==================== 交易决策档案独立存储 ====================
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TradeDecision } from '../../types/trade-decision'

const defaultDirectory = join(process.cwd(), 'data', 'trade-decisions')

/** 限定 ID 格式，防止查询参数逃逸档案目录。 */
export function isAnalysisId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
}

/** 月份也是路径的一部分，必须严格验证，禁止目录穿越。 */
export function isAnalysisMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

/** 固定按请求时间的北京时间归档，跨月缓存复用及平仓不会改变目录。 */
export function getAnalysisMonth(requestedAt: number): string {
  if (!Number.isFinite(requestedAt)) throw new Error('AI 请求时间无效')
  const month = new Date(requestedAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 7)
  if (!isAnalysisMonth(month)) throw new Error('AI 请求月份无效')
  return month
}

/** 读取原始输入输出，旧订单缺少档案时由调用方明确提示，不重新生成提示词。 */
export async function readTradeDecision(analysisId: string, directory = defaultDirectory, month?: string): Promise<TradeDecision> {
  if (!isAnalysisId(analysisId)) throw new Error('无效的 analysisId')
  if (month !== undefined && !isAnalysisMonth(month)) throw new Error('无效的归档月份')
  let raw: string
  try {
    raw = await readFile(join(directory, ...(month ? [month] : []), `${analysisId}.json`), 'utf8')
  } catch (error: any) {
    // 仅缺失时兼容旧根目录文件；损坏或权限错误必须报告，不能掩盖。
    if (!month || error.code !== 'ENOENT') throw error
    raw = await readFile(join(directory, `${analysisId}.json`), 'utf8')
  }
  const document = JSON.parse(raw) as TradeDecision
  if (document.schemaVersion !== 1 || document.analysisId !== analysisId || !Array.isArray(document.messages)
    || !document.messages.some(message => message.role === 'user' && typeof message.content === 'string')) {
    throw new Error('交易决策档案格式无效')
  }
  return document
}

/** 下单前原子落盘；同一缓存分析复用同一文件，正文不进入月度订单文件。 */
export async function saveTradeDecision(document: TradeDecision, directory = defaultDirectory): Promise<string> {
  if (!isAnalysisId(document.analysisId)) throw new Error('无效的 analysisId')
  const monthlyDirectory = join(directory, getAnalysisMonth(document.requestedAt))
  await mkdir(monthlyDirectory, { recursive: true })
  const target = join(monthlyDirectory, `${document.analysisId}.json`)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(document, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, target)
  } finally {
    await unlink(temporary).catch(() => {})
  }
  return document.analysisId
}
