import { resolve, join } from 'path'

// 测试路径解析（和StrategyStore.ts里的层级一致）
const PROJECT_ROOT = resolve(new URL('../../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]):\//, '$1:/'))
const STRATEGIES_DIR = join(PROJECT_ROOT, 'data', 'strategies')

console.log('PROJECT_ROOT:', PROJECT_ROOT)
console.log('STRATEGIES_DIR:', STRATEGIES_DIR)