// ==================== AI 策略规则内容寻址存储 ====================
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** 规则正文按精确 UTF-8 内容寻址；不合并空格或换行，避免改写实际使用的规则。 */
export function hashAIRules(userPrompt: string): string {
  return createHash('sha256').update(userPrompt, 'utf8').digest('hex')
}

/** 独立规则文件；相同正文跨策略复用，策略关联由分析记录负责。 */
export interface AIRulesDocument {
  schemaVersion: 1
  rulesHash: string
  userPrompt: string
}

const defaultDirectory = join(process.cwd(), 'data', 'ai-rules')
const pending = new Map<string, Promise<string>>()

/** 验证文件名和内容哈希，损坏记录不能悄悄成为历史回测依据。 */
export async function readAIRules(rulesHash: string, directory = defaultDirectory): Promise<AIRulesDocument> {
  if (!/^[a-f0-9]{64}$/.test(rulesHash)) throw new Error('无效的规则哈希')
  const document = JSON.parse(await readFile(join(directory, `${rulesHash}.json`), 'utf8')) as AIRulesDocument
  if (document.schemaVersion !== 1 || document.rulesHash !== rulesHash || typeof document.userPrompt !== 'string' || hashAIRules(document.userPrompt) !== rulesHash) {
    throw new Error('规则文件内容校验失败')
  }
  return document
}

/** 规则原子落盘后才允许分析记录引用；并发相同规则只执行一次写入。 */
export async function saveAIRules(userPrompt: string, directory = defaultDirectory): Promise<string> {
  const rulesHash = hashAIRules(userPrompt)
  const key = join(directory, `${rulesHash}.json`)
  const running = pending.get(key)
  if (running) return running
  const task = (async () => {
    try {
      await readAIRules(rulesHash, directory)
      return rulesHash
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error
    }
    await mkdir(directory, { recursive: true })
    const temporary = `${key}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, rulesHash, userPrompt }) + '\n', { encoding: 'utf8', flag: 'wx' })
      await rename(temporary, key)
    } finally {
      await unlink(temporary).catch(() => {})
    }
    return rulesHash
  })()
  pending.set(key, task)
  try { return await task } finally { pending.delete(key) }
}
