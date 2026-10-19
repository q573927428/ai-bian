<!-- ==================== 最新重要快讯卡片 ==================== -->
<template>
  <el-card class="latest-news-card" shadow="hover">
    <template #header>
      <div class="news-header">
        <span>📢 重要快讯</span>
        <span v-if="updatedAt" class="news-updated-at">{{ failed || degraded ? '上次更新' : '更新于' }} {{ formatTime(updatedAt) }}</span>
        <el-button class="news-refresh" type="primary" text size="small" :loading="loading" @click="loadNews">
          <el-icon v-if="!loading"><ElIconRefresh /></el-icon>
          <span>刷新</span>
        </el-button>
      </div>
    </template>
    <div v-if="failed || degraded || (loading && !updatedAt)" class="news-status" role="status">
      <span v-if="failed">{{ news.items.length ? '更新失败，显示上次内容' : '快讯获取失败，请稍后重试' }}</span>
      <span v-else-if="degraded">部分来源更新失败，可能包含缓存内容</span>
      <span v-else-if="loading && !updatedAt">正在获取快讯…</span>
    </div>
    <div class="news-list" aria-label="重要快讯列表" :aria-busy="loading">
      <el-skeleton v-if="loading && !news.items.length" :rows="6" animated />
      <template v-else-if="news.items.length">
        <button v-for="item in news.items" :key="item.id" class="news-item" type="button"
          :title="item.title" aria-haspopup="dialog" @click="openNews(item)">
          <span class="news-title"><span class="source-tag">{{ item.source }}</span>{{ item.title }}</span>
          <span class="news-meta"><time :datetime="item.publishedAt">{{ formatTime(item.publishedAt) }}</time></span>
        </button>
      </template>
      <el-empty v-else :description="failed || degraded ? '暂时无法获取快讯' : '暂无重要快讯'" :image-size="64" />
    </div>
  </el-card>
  <el-dialog v-model="showNewsDialog" class="news-dialog" title="快讯详情"
    :style="{ width: '92%', maxWidth: '720px' }" append-to-body destroy-on-close>
    <article v-if="selectedNews" class="news-detail">
      <h2 class="news-detail-title">{{ selectedNews.title }}</h2>
      <div class="news-detail-meta"><span>{{ selectedNews.source }}</span><time :datetime="selectedNews.publishedAt">{{ formatTime(selectedNews.publishedAt) }}</time></div>
      <!-- RSS 内容作为纯文本插值展示，避免执行来源中的 HTML 或跳转链接。 -->
      <div class="news-detail-content">{{ selectedNews.content || '该订阅暂未提供正文内容。' }}</div>
    </article>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { NewsItem, NewsResponse } from '../../types/news'

const news = ref<NewsResponse>({ items: [], sources: [] })
const loading = ref(false)
const failed = ref(false)
const selectedNews = ref<NewsItem | null>(null)
const showNewsDialog = ref(false)
const degraded = computed(() => news.value.sources.some(source => source.status !== 'ok'))
const updatedAt = computed(() => news.value.sources.map(source => source.updatedAt).filter((time): time is string => !!time).sort().at(-1))
let timer: ReturnType<typeof setInterval> | undefined
let controller: AbortController | undefined

/** 保留点击时的新闻快照，后台刷新不会打断弹窗阅读。 */
function openNews(item: NewsItem) {
  selectedNews.value = item
  showNewsDialog.value = true
}

/** 刷新期间保留列表和滚动位置，网络失败不清空已有快讯。 */
async function loadNews() {
  if (loading.value) return
  loading.value = true
  controller = new AbortController()
  try {
    news.value = await $fetch<NewsResponse>('/api/news', { signal: controller.signal, timeout: 12000, retry: 0 })
    failed.value = news.value.sources.length > 0 && news.value.sources.every(source => source.status === 'error')
  } catch {
    if (!controller.signal.aborted) failed.value = true
  } finally {
    loading.value = false
  }
}

/** 使用浏览器本地时区展示绝对时间，旧快讯也能清楚识别日期。 */
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 隐藏页面停止轮询，恢复可见时立即检查更新。 */
function handleVisibility() {
  if (timer) clearInterval(timer)
  timer = undefined
  if (document.hidden) return
  void loadNews()
  timer = setInterval(() => void loadNews(), 5 * 60_000)
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibility)
  handleVisibility()
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibility)
  if (timer) clearInterval(timer)
  controller?.abort()
})
</script>

<style scoped>
.latest-news-card { margin-bottom: 20px; background: var(--bg-card); color: var(--text-regular); }
/* 正文与列表都允许收缩，刷新状态出现时也不会撑高卡片。 */
.latest-news-card { display: flex; flex-direction: column; min-height: 0; }
.latest-news-card :deep(.el-card__header) { flex-shrink: 0; }
.news-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: var(--text-primary);margin: -5px 0; }
.news-header { gap: 8px; flex-wrap: wrap; }
.news-updated-at { margin-left: auto; font-size: 11px; font-weight: 400; color: var(--text-secondary); }
.news-refresh { gap: 2px; padding: 0; font-size: 12px; }
.news-refresh :deep(> span) { gap: 2px; }
.latest-news-card :deep(.el-card__body) { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 12px 16px; }
.news-status { flex-shrink: 0; min-height: 18px; margin-bottom: 8px; font-size: 11px; color: var(--text-secondary); }
.news-list { flex: 1; min-height: 0; height: 210px; overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; }
.news-list::-webkit-scrollbar { display: none; }
.news-item { display: flex; width: 100%; align-items: center; gap: 8px; padding: 8px 0; background: transparent; border: none; font: inherit; text-align: left; cursor: pointer; color: var(--text-primary); border-bottom: 1px solid var(--el-border-color-lighter); }
.news-item:first-child { padding-top: 4px; }
.news-item:last-child { border-bottom: none; }
.news-item:hover .news-title, .news-item:focus-visible .news-title { color: var(--el-color-primary); }
.news-item:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.news-title { flex: 1; min-width: 0; font-size: 12px; line-height: 1.7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.source-tag { margin-right: 6px; padding: 1px 4px; border-radius: 3px; color: var(--el-color-warning); background: var(--el-color-warning-light-9); font-size: 11px; }
.news-meta { display: flex; flex-shrink: 0; align-items: center; gap: 8px; font-size: 11px; white-space: nowrap; color: var(--text-secondary); }
.news-meta time { margin-left: auto; }
.news-detail { color: var(--text-primary); }
.news-detail-title { margin: 0 0 12px; font-size: 19px; line-height: 1.6; overflow-wrap: anywhere; }
.news-detail-meta { display: flex; gap: 12px; margin-bottom: 20px; font-size: 12px; color: var(--text-secondary); }
.news-detail-content { max-height: 60vh; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.9; }
</style>
