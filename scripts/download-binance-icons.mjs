/**
 * 币安 USDT 永续合约图标下载（纯 CoinGecko，防 429）
 *
 * 步骤：
 * 1. fapi 获取永续合约列表
 * 2. CoinGecko /coins/list 获取 symbol→id
 * 3. 每批次 50 个 ID 获取 markets（含图片 URL），批次间停 3 秒防 429
 * 4. 每批次内 5 个并发下载图片
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import { setTimeout } from 'node:timers/promises'

const sleep = setTimeout

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.resolve(ROOT, 'public/assets/crypto-icons')

const FAPI = 'https://fapi.binance.com/fapi/v1/exchangeInfo'
const CG = 'https://api.coingecko.com/api/v3'

function httpGet(url, json = true) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 429) { reject(new Error('HTTP 429')); return }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location, json).then(resolve).catch(reject); return
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        resolve(json ? JSON.parse(buf.toString()) : buf)
      })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

async function httpGetWithRetry(url, json = true, maxRetry = 5) {
  for (let i = 0; i < maxRetry; i++) {
    try {
      return await httpGet(url, json)
    } catch (err) {
      if (err.message === 'HTTP 429') {
        const wait = (i + 1) * 3
        console.log(`\n  429 限流，等待 ${wait} 秒后重试...`)
        await sleep(wait * 1000)
        continue
      }
      throw err
    }
  }
  throw new Error(`Max retry exceeded for ${url}`)
}

async function main() {
  console.log('=== 币安 USDT 永续合约图标下载 ===\n')

  // 1. 期货合约列表
  console.log('1/4 获取合约列表...')
  const info = await httpGet(FAPI)
  const assets = []
  for (const s of (info.symbols || [])) {
    if ((s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL')
        && s.symbol.endsWith('USDT') && !s.symbol.endsWith('USDCUSDT')) {
      assets.push(s.baseAsset)
    }
  }
  const unique = [...new Set(assets)].sort()
  console.log(`  USDT 永续合约: ${unique.length} 个\n`)

  fs.mkdirSync(OUT, { recursive: true })

  // 2. CoinGecko symbol→id
  console.log('2/4 获取 CoinGecko 币种映射...')
  const allCoins = await httpGetWithRetry(`${CG}/coins/list`)
  const symToId = new Map()
  for (const c of allCoins) {
    const s = (c.symbol || '').toLowerCase()
    if (!symToId.has(s)) symToId.set(s, c.id)
  }
  console.log(`  CoinGecko 共 ${allCoins.length} 个币种`)

  // 匹配
  const assetToId = new Map()
  for (const a of unique) {
    const id = symToId.get(a.toLowerCase())
    if (id) assetToId.set(a, id)
  }
  console.log(`  匹配到 ${assetToId.size}/${unique.length}\n`)

  // 3. 批量获取 + 下载
  console.log('3/4 下载图标（每批停 8 秒防 429）...')
  const ids = [...assetToId.values()]
  let ok = 0
  let fail = 0
  const failList = []

  for (let i = 0; i < ids.length; i += 50) {
    const batchIds = ids.slice(i, i + 50)

    // 获取 markets 数据（带重试）
    let data = null
    for (let retry = 0; retry < 5; retry++) {
      try {
        data = await httpGet(
          `${CG}/coins/markets?vs_currency=usd&ids=${batchIds.join(',')}&order=market_cap_desc`
        )
        break
      } catch (err) {
        const wait = (retry + 1) * 5
        console.log(`\n  429 限流，等待 ${wait} 秒后重试...`)
        await sleep(wait * 1000)
      }
    }
    if (!data) {
      console.log(`\n  批次失败，跳过 ${batchIds.length} 个`)
      for (const id of batchIds) {
        for (const [asset, aid] of assetToId) {
          if (aid === id) { fail++; failList.push(asset); break }
        }
      }
      if (i + 50 < ids.length) await sleep(10000)
      continue
    }

    // symbol → 大图URL
    const urlMap = new Map()
    for (const c of data) {
      const sym = (c.symbol || '').toLowerCase()
      if (c.image) urlMap.set(sym, c.image.replace('/small/', '/large/'))
    }

    // 本批需下载的资产
    const batchAssets = []
    for (const [asset, id] of assetToId) {
      if (batchIds.includes(id)) batchAssets.push(asset)
    }

    // 慢速并发下载（5 个一组）
    for (let j = 0; j < batchAssets.length; j += 5) {
      const sub = batchAssets.slice(j, j + 5)
      const results = await Promise.all(sub.map(async (a) => {
        const l = a.toLowerCase()
        const p = path.join(OUT, `${l}.png`)
        const url = urlMap.get(l)
        if (!url) return false
        try {
          const buf = await httpGet(url, false)
          if (buf.length > 100 && buf[0] === 0x89 && buf[1] === 0x50) {
            fs.writeFileSync(p, buf)
            return true
          }
        } catch { /* 忽略 */ }
        return false
      }))
      for (let r = 0; r < results.length; r++) {
        if (results[r]) ok++
        else { fail++; failList.push(sub[r]) }
      }
    }
    process.stdout.write(`\r  进度: ${ok}/${assetToId.size}`)

    // 每批间隔 8 秒
    if (i + 50 < ids.length) await sleep(10000)
  }

  console.log(`\n  下载完成: 成功 ${ok}, 失败 ${fail}`)

  // 4. 统计
  const total = fs.readdirSync(OUT).filter(f => f.endsWith('.png')).length
  const missing = unique.filter(a => !fs.existsSync(path.join(OUT, `${a.toLowerCase()}.png`)))

  console.log('\n=== 结果 ===')
  console.log(`总合约: ${unique.length}`)
  console.log(`总文件: ${total}`)
  console.log(`缺失: ${missing.length}`)

  if (missing.length > 0) {
    console.log('\n缺失:')
    for (let i = 0; i < missing.length; i += 10) {
      console.log('  ' + missing.slice(i, i + 10).join(', '))
    }
  }
  console.log(`\n路径: ${OUT}`)
}

main()