const HASHTAG = 'bnb'

async function run() {
  const now = Math.floor(Date.now() / 1000)

  const url =
    `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag` +
    `?hashtag=${HASHTAG}` +
    `&pageNum=1&pageSize=200`

  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0'
    }
  })

  const json = await res.json()

  const allPosts = json?.data?.feedData || []

  // 统计24h内看涨+看跌的帖子数，判断是否需要扩展窗口
  let bullishBearish24h = 0
  for (const post of allPosts) {
    const diff = now - post.date
    if (diff <= 3600 * 24) {
      const tendency = Number(post.tendency)
      if (tendency === 1 || tendency === 2) {
        bullishBearish24h++
      }
    }
  }

  // 如果24h内看涨+看跌帖子数 < 10，扩展到48h获取更多样本
  const use48h = bullishBearish24h < 10
  const sentimentWindow = use48h ? 3600 * 48 : 3600 * 24
  const windowLabel = use48h ? '48小时' : '24小时'

  // 按时间窗口统计总帖子数、看涨、看跌、中性
  let postCount = 0
  let bullish = 0 // 1 看涨
  let bearish = 0 // 2 看跌
  let neutral = 0 // 0 未表明方向

  for (const post of allPosts) {
    const diff = now - post.date
    if (diff <= sentimentWindow) {
      postCount++
      const tendency = Number(post.tendency)
      switch (tendency) {
        case 1:
          bullish++
          break
        case 2:
          bearish++
          break
        case 0:
          neutral++
          break
      }
    }
  }

  // 只统计看涨+看跌
  const trendTotal = bullish + bearish

  const bullishRate =
    trendTotal > 0
      ? ((bullish / trendTotal) * 100).toFixed(2)
      : '0'

  const bearishRate =
    trendTotal > 0
      ? ((bearish / trendTotal) * 100).toFixed(2)
      : '0'

  // 情绪图标
  const sentimentIcon = bullish > bearish ? '🐂' : bullish < bearish ? '🐻' : '⚖️'

  console.log(`\n====== #${HASHTAG} 情绪统计 ======\n`)

  console.log(`总帖子数: ${postCount}`)
  console.log(`情绪统计窗口: ${windowLabel}${use48h ? ' (24h帖子<10，自动扩展)' : ''}`)

  console.log(`看涨(1): ${bullish} (${bullishRate}%)`)
  console.log(`看跌(2): ${bearish} (${bearishRate}%)`)
  console.log(`中性(0): ${neutral}`)
  console.log(`情绪倾向: ${sentimentIcon} 看涨${bullishRate}% / 看空${bearishRate}%`)
}

run()