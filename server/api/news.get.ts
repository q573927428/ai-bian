// ==================== 重要快讯接口 ====================
import { getLatestNews } from '../utils/news'

export default defineEventHandler(() => getLatestNews())
