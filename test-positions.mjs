import { readFile } from 'fs/promises'
import { join } from 'path'

const DATA_DIR = join(process.cwd(), 'data')
const ACTIVE_POSITIONS_FILE = join(DATA_DIR, 'active-positions.json')

console.log('测试读取 active-positions.json 文件')
console.log('文件路径:', ACTIVE_POSITIONS_FILE)

try {
  const data = await readFile(ACTIVE_POSITIONS_FILE, 'utf-8')
  console.log('文件内容:')
  console.log(data)
  
  const parsed = JSON.parse(data)
  console.log('解析结果:')
  console.log(parsed)
  console.log('类型:', Array.isArray(parsed) ? '数组' : '不是数组')
  console.log('长度:', parsed.length)
} catch (error) {
  console.error('读取失败:', error.message)
}