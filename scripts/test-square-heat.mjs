// 测试币安广场API数据格式
async function testSquareHeat() {
  try {
    const baseAsset = 'XAG'
    console.log(`正在测试 ${baseAsset} 的广场热度API...`)

    const url = `https://www.binance.com/bapi/composite/v4/friendly/pgc/content/queryByHashtag?hashtag=%23${baseAsset}&pageIndex=1&pageSize=1`

    console.log(`请求URL: ${url}\n`)

    const response = await fetch(url)
    const data = await response.json()

    console.log('📊 完整响应数据:')
    console.log(JSON.stringify(data, null, 2))

    console.log(`\n✅ 测试成功！`)

    // 分析数据结构
    console.log('\n🔍 数据结构分析:')
    console.log(`- data.total: ${data.data?.total}`)
    console.log(`- data.list.length: ${data.data?.list?.length}`)

    if (data.data?.list?.length > 0) {
      console.log(`\n- 第一条帖子信息:`)
      console.log(`  - id: ${data.data.list[0].id}`)
      console.log(`  - title: ${data.data.list[0].title}`)
      console.log(`  - viewCount: ${data.data.list[0].viewCount}`)
      console.log(`  - likeCount: ${data.data.list[0].likeCount}`)
    }

    return data
  } catch (error) {
    console.error('❌ 测试失败:', error)
    throw error
  }
}

testSquareHeat()