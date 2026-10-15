// ==================== 新闻抓取与缓存回归测试 ====================
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fetchPanews, parsePanewsRss, PANEWS_RSS_URL } from '../server/utils/news/panews.ts'

/** 生成订阅样本，覆盖 CDATA 正文及 RSS 常见字段。 */
function article(id, publishedAt, { title = `新闻 ${id}`, content = '<p>完整正文</p>', description = '摘要', url = `https://www.panewslab.com/zh/articles/${id}` } = {}) {
  return `<item><guid>${id}</guid><title><![CDATA[${title}]]></title><link>${url}</link><pubDate>${publishedAt}</pubDate><description><![CDATA[${description}]]></description><content:encoded><![CDATA[${content}]]></content:encoded></item>`
}

/** 空订阅也是合法 RSS，不能与解析失败混为一谈。 */
function feed(items) {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>${items.join('')}</channel></rss>`
}

// Node 直接运行 TypeScript 时补全这一处 Nuxt 支持的无扩展名导入。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './panews' && context.parentURL?.endsWith('/server/utils/news/index.ts')) {
      return nextResolve('./panews.ts', context)
    }
    return nextResolve(specifier, context)
  },
})

test('新闻标准化、并发缓存、失败保留旧数据与恢复', async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = originalNow()
  let calls = 0
  let failing = false
  let rows = [
    article('older', '2026-10-15T01:00:00Z'),
    article('newer', '2026-10-15T02:00:00Z'),
    article('newer', '2026-10-15T02:00:00Z'),
    article('invalid-time', 'bad'),
    article('empty-title', '2026-10-15T03:00:00Z', { title: '' }),
    article('unsafe-url', '2026-10-15T03:00:00Z', { url: 'javascript:alert(1)' }),
  ]
  Date.now = () => now
  globalThis.fetch = async (url) => {
    assert.equal(url, PANEWS_RSS_URL)
    calls++
    if (failing) throw new Error('模拟上游故障')
    await Promise.resolve()
    return new Response(feed(rows), { status: 200 })
  }
  try {
    const normalized = await fetchPanews()
    assert.equal(normalized.length, 3)
    assert.deepEqual(normalized[0].assets, [])
    assert.deepEqual(normalized[0].tags, [])
    assert.equal(normalized[0].sentiment, null)
    assert.equal(normalized[0].content, '完整正文')
    calls = 0
    const { getLatestNews } = await import('../server/utils/news/index.ts')
    const [first, concurrent] = await Promise.all([getLatestNews(), getLatestNews()])
    assert.equal(calls, 1)
    assert.deepEqual(first, concurrent)
    assert.deepEqual(first.items.map(item => item.id), ['panews:newer', 'panews:older'])
    assert.equal(first.sources[0].status, 'ok')
    await getLatestNews()
    assert.equal(calls, 1)

    now += 60_001
    await getLatestNews()
    assert.equal(calls, 1, '一分钟后仍使用缓存，不重新拉取 RSS')
    now += 4 * 60_000
    failing = true
    const stale = await getLatestNews()
    assert.equal(stale.sources[0].status, 'stale')
    assert.equal(stale.sources[0].updatedAt, first.sources[0].updatedAt)
    assert.deepEqual(stale.items, first.items)
    await getLatestNews()
    assert.equal(calls, 2, '故障期间同样遵守缓存间隔')

    now += 5 * 60_000 + 1
    failing = false
    rows = []
    const recovered = await getLatestNews()
    assert.equal(recovered.sources[0].status, 'ok')
    assert.deepEqual(recovered.items, [], '正常空结果应替换旧缓存')
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
})

test('来源 HTTP 错误及异常响应不会被当成正常空列表', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('{}', { status: 503 })
    await assert.rejects(fetchPanews(), /HTTP 503/)
    globalThis.fetch = async () => new Response('{}', { status: 200 })
    await assert.rejects(fetchPanews(), /返回格式异常/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('RSS 正文优先于摘要，保留段落并去掉图片、脚本和链接标签', () => {
  const [item] = parsePanewsRss(feed([article('body', 'Thu, 15 Oct 2026 07:37:00 GMT', {
    title: 'BTC &amp; ETH &#x1F4E2;',
    content: '<img src="https://example.com/a.png"><p>第一段&nbsp;&amp;内容</p><p>第二段<br/>下一行 <a href="https://example.com">来源</a></p><script>alert(1)</script><style>body{}</style>',
  })]))
  assert.equal(item.title, 'BTC & ETH 📢')
  assert.equal(item.content, '第一段 &内容\n\n第二段\n下一行 来源')
  assert.equal(item.publishedAt, '2026-10-15T07:37:00.000Z')
  assert.equal(item.sentiment, null)
  assert.equal(item.important, false)
})

test('缺少完整正文时使用摘要，缺少 guid 时使用链接作为 ID', () => {
  const xml = feed([article('fallback', '2026-10-15T01:00:00Z', { content: '', description: '备用摘要' })]).replace('<guid>fallback</guid>', '')
  const [item] = parsePanewsRss(xml)
  assert.equal(item.content, '备用摘要')
  assert.equal(item.id, `panews:${item.url}`)
})

test('CDATA 内的 item 字符串不影响条目边界，XML 实体正常解码', () => {
  const xml = feed([article('cdata', '2026-10-15T01:00:00Z', { content: '<p>正文包含 &lt;item&gt; 示例</p>' })])
  assert.equal(parsePanewsRss(xml).length, 1)
  assert.equal(parsePanewsRss(xml)[0].content, '正文包含 <item> 示例')
  const escaped = feed(['<item><title>BTC &amp; ETH</title><link>https://example.com/?a=1&amp;b=2</link><pubDate>2026-10-15T01:00:00Z</pubDate><description>正文</description></item>'])
  assert.equal(parsePanewsRss(escaped)[0].url, 'https://example.com/?a=1&b=2')
  assert.deepEqual(parsePanewsRss(feed([])), [])
})

test('错误页、残缺 RSS 和 DTD 声明应报错', () => {
  for (const xml of ['<html>错误页</html>', feed([]).replace('</rss>', ''), '<!DOCTYPE rss><rss><channel></channel></rss>', '<rss><channel><item></channel></rss>']) {
    assert.throws(() => parsePanewsRss(xml), /格式异常|条目不完整/)
  }
})
