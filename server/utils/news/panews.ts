// ==================== PANews 精选 RSS 快讯 ====================
import type { NewsItem } from '../../../types/news'

export const PANEWS_RSS_URL = 'https://www.panewslab.com/rss.xml?lang=zh&type=NEWS'

/** 解码 RSS/XML 与正文中常见的 HTML 实体，不解析外部实体。 */
function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? entity
    const number = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : entity
  })
}

/** 只输出文本，去掉图片和可执行内容；前端无需使用 v-html。 */
function toPlainText(value: string): string {
  return decodeEntities(value
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<br\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 解析当前 PANews RSS 2.0 的固定字段，CDATA 先隔离，避免正文标签干扰 item 边界。 */
export function parsePanewsRss(xml: string): NewsItem[] {
  // 当前订阅不使用 DTD；拒绝声明及残缺响应，避免把上游错误页当作成功空列表。
  if (xml.includes('\0') || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('PANews RSS 返回格式异常')
  const cdata: string[] = []
  const document = xml.replace(/<!\[CDATA\[([^]*?)\]\]>/g, (_, value: string) => {
    cdata.push(value)
    return `\0${cdata.length - 1}\0`
  }).replace(/<!--[^]*?-->/g, '')
  if (!/<rss\b[^>]*>\s*<channel\b[^>]*>/i.test(document)
    || !/<\/channel>\s*<\/rss>\s*$/i.test(document) || document.includes('<![CDATA[')) {
    throw new Error('PANews RSS 返回格式异常')
  }
  const blocks = [...document.matchAll(/<item\b[^>]*>([^]*?)<\/item\s*>/gi)]
  if (blocks.length !== (document.match(/<item\b/gi)?.length ?? 0)) throw new Error('PANews RSS 条目不完整')

  return blocks.flatMap(([, block]) => {
    /** 先解码 XML 层，再还原 CDATA，防止正文中的转义符被重复解码。 */
    const field = (name: string): string => {
      const value = block!.match(new RegExp(`<${name}\\b[^>]*>([^]*?)<\\/${name}\\s*>`, 'i'))?.[1] ?? ''
      return decodeEntities(value).replace(/\0(\d+)\0/g, (_, index: string) => cdata[Number(index)] ?? '').trim()
    }
    const title = toPlainText(field('title')).replace(/\s+/g, ' ')
    const url = field('link')
    const publishedAt = Date.parse(field('pubDate'))
    if (!title || !Number.isFinite(publishedAt)) return []
    try {
      if (!['http:', 'https:'].includes(new URL(url).protocol)) return []
    } catch { return [] }
    return [{
      id: `panews:${field('guid') || url}`,
      title,
      content: toPlainText(field('content:encoded')) || toPlainText(field('description')),
      url,
      source: 'PANews',
      publishedAt: new Date(publishedAt).toISOString(),
      // featured=true 已由来源筛选精选内容，不再套用旧接口的 isImportant 字段。
      important: false,
      sentiment: null,
      assets: [],
      tags: [],
    }]
  })
}

/** 读取用户指定的精选 RSS；HTTP 或格式错误交给聚合层保留旧缓存。 */
export async function fetchPanews(): Promise<NewsItem[]> {
  const response = await fetch(PANEWS_RSS_URL, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`PANews RSS HTTP ${response.status}`)
  return parsePanewsRss(await response.text())
}
