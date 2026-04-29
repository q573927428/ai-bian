import fs from 'fs'
import path from 'path'

const REST_BASE = 'https://fapi.binance.com'

async function testExchangeInfo() {
  console.log('正在获取币安合约exchangeInfo数据...\n')
  
  try {
    const response = await fetch(`${REST_BASE}/fapi/v1/exchangeInfo`)
    const data = await response.json()

    console.log('=== 顶层数据结构 ===')
    console.log(Object.keys(data))
    console.log('\n=== 时间戳 ===', data.timezone, data.serverTime)
    console.log('\n=== 交易对总数 ===', data.symbols?.length || 0)

    if (data.symbols && data.symbols.length > 0) {
      console.log('\n=== 第一个交易对的完整结构 ===')
      console.log(JSON.stringify(data.symbols[0], null, 2))

      console.log('\n=== 所有可用字段 ===')
      console.log(Object.keys(data.symbols[0]))

      // 统计一些有用的信息
      const contractTypes = new Set()
      const quoteAssets = new Set()
      const statuses = new Set()
      
      data.symbols.forEach((s) => {
        contractTypes.add(s.contractType)
        quoteAssets.add(s.quoteAsset)
        statuses.add(s.status)
      })

      console.log('\n=== 合约类型统计 ===', Array.from(contractTypes))
      console.log('=== 计价资产统计 ===', Array.from(quoteAssets))
      console.log('=== 状态统计 ===', Array.from(statuses))

      // 保存完整数据到文件供分析
      const outputFile = path.resolve(process.cwd(), 'data', 'exchange-info-full.json')
      const dir = path.dirname(outputFile)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(outputFile, JSON.stringify(data, null, 2))
      console.log(`\n完整数据已保存到: ${outputFile}`)
    }
  } catch (error) {
    console.error('获取exchangeInfo失败:', error)
  }
}

testExchangeInfo()