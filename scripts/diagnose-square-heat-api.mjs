// ==================== 币安广场热度接口诊断脚本 ====================

/**
 * 直接检查币安广场 hashtag 接口的返回条数、分页元数据和时间窗口统计，
 * 用于定位 postCount 经常等于 100 是接口限制还是本地统计逻辑导致。
 */

const symbols = process.argv.slice(2).map(value => value.toUpperCase()).filter(Boolean)
const targets = symbols.length > 0 ? symbols : ['DOGE', 'BNB', 'ETH']
const pageSizes = [100]
const pageIndexes = [1, 2, 3, 4, 5]
const windows = [24]
const MIN_PAGE_WINDOW_POSTS = 90

function getHashtag(symbol) {
  return symbol.replace(/\/?USDT$/i, '')
}

function getUrl(symbol, pageIndex, pageSize) {
  const hashtag = encodeURIComponent(`#${getHashtag(symbol)}`)
  return `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag?hashtag=${hashtag}&pageIndex=${pageIndex}&pageSize=${pageSize}&orderBy=LATEST`
}

function getPaginationMeta(data) {
  if (!data || typeof data !== 'object') return {}
  const keys = ['total', 'totalCount', 'count', 'pageNum', 'pageSize', 'hasNext', 'hasMore', 'nextPage', 'totalPage', 'totalPages']
  return Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]]))
}

function summarizePosts(posts) {
  const now = Math.floor(Date.now() / 1000)
  const result = {}

  for (const hours of windows) {
    const cutoff = hours * 60 * 60
    const inWindow = posts.filter(post => Number.isFinite(Number(post.date)) && now - Number(post.date) >= 0 && now - Number(post.date) <= cutoff)
    const tendency = { bullish: 0, bearish: 0, neutral: 0, other: 0 }

    for (const post of inWindow) {
      const value = Number(post.tendency)
      if (value === 1) tendency.bullish++
      else if (value === 2) tendency.bearish++
      else if (value === 0) tendency.neutral++
      else tendency.other++
    }

    result[`${hours}h`] = {
      count: inWindow.length,
      tendency,
      oldestDate: inWindow.length > 0 ? new Date(Math.min(...inWindow.map(post => Number(post.date))) * 1000).toISOString() : null
    }
  }

  return result
}

async function inspect(symbol, pageIndex, pageSize) {
  const url = getUrl(symbol, pageIndex, pageSize)
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
  const body = await response.json()
  const data = body?.data
  const posts = Array.isArray(data?.feedData) ? data.feedData : []

  return {
    symbol,
    pageIndex,
    requestedPageSize: pageSize,
    httpStatus: response.status,
    responseKeys: body && typeof body === 'object' ? Object.keys(body) : [],
    dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
    feedDataLength: posts.length,
    pagination: getPaginationMeta(data),
    firstPostDate: posts[0]?.date ? new Date(Number(posts[0].date) * 1000).toISOString() : null,
    lastPostDate: posts.at(-1)?.date ? new Date(Number(posts.at(-1).date) * 1000).toISOString() : null,
    windows: summarizePosts(posts)
  }
}

for (const symbol of targets) {
  console.log(`\n===== ${symbol} =====`)
  for (const pageSize of pageSizes) {
    for (const pageIndex of pageIndexes) {
      try {
        const result = await inspect(symbol, pageIndex, pageSize)
        console.log(JSON.stringify(result, null, 2))

        // 当前页 24h 内样本不足时，后续页通常已超出窗口，停止后续分页
        if (result.feedDataLength === 0 || result.windows['24h']?.count < MIN_PAGE_WINDOW_POSTS) {
          break
        }
      } catch (error) {
        console.error(JSON.stringify({ symbol, pageIndex, pageSize, error: error instanceof Error ? error.message : String(error) }, null, 2))
      }
    }
  }
}
