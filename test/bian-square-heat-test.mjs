const HASHTAG = 'BTCUSDT'

async function run() {
  const now = Math.floor(Date.now() / 1000)

  const url =
    `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag` +
    `?hashtag=${HASHTAG}` +
    `&pageNum=1&pageSize=100&sortBy=LATEST`

  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0'
    }
  })

  const json = await res.json()

  const allPosts = json?.data?.feedData || []

  // 过滤最近24小时
  const posts24h = allPosts.filter((post) => {
    const diff = now - post.date
    return diff <= 3600 * 24
  })

  // 最新10条
  const latest10 = posts24h
    .sort((a, b) => b.date - a.date)
    .slice(0, 10)

  let totalViews = 0

  console.log(`\n====== #${HASHTAG} 最近24小时最新10条帖子 ======\n`)

  latest10.forEach((post, index) => {
    totalViews += Number(post.viewCount || 0)

    // 标题
    const title =
      post.title ||
      post.content ||
      post.text ||
      post.desc ||
      '无标题'

    // 作者
    const author =
      post.displayName ||
      post.authorName ||
      post.publisher?.nickName ||
      '未知作者'

    // 时间
    const time = new Date(post.date * 1000).toLocaleString()

    console.log(`${index + 1}. ${title}`)
    console.log(`作者: ${author}`)
    console.log(`浏览: ${post.viewCount || 0}`)
    console.log(`时间: ${time}`)
    console.log('---------------------------')
  })

  console.log(`\n#${HASHTAG} 最近24小时帖子数: ${posts24h.length}`)
  console.log(`#${HASHTAG} 最新10条总浏览量: ${totalViews}`)
}

run()