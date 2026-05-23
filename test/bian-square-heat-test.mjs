const HASHTAG = 'XAG'

async function run() {
  const now = Math.floor(Date.now() / 1000)

  const url =
    `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag` +
    `?hashtag=${HASHTAG}`
    + `&pageNum=1&pageSize=100&sortBy=LATEST`

  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0'
    }
  })

  const json = await res.json()

  const posts = json.data.feedData || []

  let count12h = 0

  for (const post of posts) {
    const diff = now - post.date

    if (diff <= 3600 * 12) {
      count12h++
    }
  }

//   console.log('\n====== 12H 热度 ======')

//   console.log('Hashtag:', HASHTAG)

//   console.log('第一页帖子数:', posts.length)

  console.log(`#${HASHTAG} 12小时帖子数:, ${count12h}`)
}

run()