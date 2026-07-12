import { existsSync } from 'fs'
import { join } from 'path'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const symbol = query.symbol as string
  if (!symbol) {
    return { success: false, exists: false }
  }
  
  const base = symbol.replace('USDT', '').toLowerCase()
  const filePath = join(process.cwd(), 'public', 'assets', 'crypto-icons', `${base}.png`)
  
  return {
    success: true,
    exists: existsSync(filePath)
  }
})