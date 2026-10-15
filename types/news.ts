// ==================== 统一新闻结构 ====================

/** 各新闻源统一输出的快讯，前端不依赖来源专属字段。 */
export interface NewsItem {
  id: string
  title: string
  /** RSS 正文转为纯文本，保留段落，供站内弹窗阅读。 */
  content: string
  url: string
  source: string
  publishedAt: string
  important: boolean
  /** 情绪判断预留字段；尚未分析时为 null（对应 Python 的 None）。 */
  sentiment: 'positive' | 'neutral' | 'negative' | null
  /** 关联资产代码；来源未提供时为空数组。 */
  assets: string[]
  /** 内容主题标签；来源未提供时为空数组。 */
  tags: string[]
}

/** 按来源返回更新状态，避免把旧缓存误显示成刚更新。 */
export interface NewsResponse {
  items: NewsItem[]
  sources: {
    name: string
    status: 'ok' | 'stale' | 'error'
    updatedAt: string | null
  }[]
}
