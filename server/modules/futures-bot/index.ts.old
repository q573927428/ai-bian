// 导出重构后的 FuturesBot
export { FuturesBot } from './FuturesBot'

// 导出单例函数
import { FuturesBot } from './FuturesBot'

let botInstance: FuturesBot | null = null

export function getFuturesBot(): FuturesBot {
  if (!botInstance) {
    botInstance = new FuturesBot()
  }
  return botInstance
}
