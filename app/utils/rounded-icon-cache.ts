// ==================== 热力图圆形图标的浏览器持久缓存 ====================

/** 缓存 80×80 圆形 PNG；源地址和裁剪版本共同确定缓存身份。 */
interface CachedIcon {
  url: string
  blob: Blob
  updatedAt: number
}

// 裁剪算法或尺寸变化时修改库名，避免复用旧格式。
const DATABASE_NAME = 'heatmap-rounded-icons-80-v1'
const STORE_NAME = 'icons'
const CACHE_TTL = 7 * 86400000
const memoryIcons: Record<string, string> = {}
const pendingWrites = new Map<string, CachedIcon>()
let database: IDBDatabase | undefined
let initialization: Promise<Record<string, string>> | undefined
let writeTimer: ReturnType<typeof setTimeout> | undefined

/** 同页重建图表直接复用 Blob URL，避免重复解码、裁剪和访问数据库。 */
export function getRoundedIconMemoryCache(): Record<string, string> {
  return { ...memoryIcons }
}

/** 首次一次性读取缓存；存储受限、升级阻塞或超时时退回普通图标加载。 */
export function loadRoundedIconCache(): Promise<Record<string, string>> {
  if (initialization) return initialization
  initialization = new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(getRoundedIconMemoryCache()); return }
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve(getRoundedIconMemoryCache())
    }
    // 缓存始终是可选加速，不能让浏览器存储问题延迟主图表。
    const timer = setTimeout(finish, 1500)
    try {
      const request = indexedDB.open(DATABASE_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'url' })
      }
      request.onerror = request.onblocked = finish
      request.onsuccess = () => {
        if (finished) { request.result.close(); return }
        database = request.result
        database.onversionchange = () => { database?.close(); database = undefined }
        try {
          const transaction = database.transaction(STORE_NAME, 'readwrite')
          const store = transaction.objectStore(STORE_NAME)
          const read = store.getAll()
          transaction.onerror = transaction.onabort = finish
          read.onerror = finish
          read.onsuccess = () => {
            if (finished) return
            for (const record of read.result as CachedIcon[]) {
              if (!record.url || !(record.blob instanceof Blob) || !Number.isFinite(record.updatedAt) || Date.now() - record.updatedAt >= CACHE_TTL) {
                if (record.url) store.delete(record.url)
                continue
              }
              memoryIcons[record.url] = URL.createObjectURL(record.blob)
            }
            finish()
          }
        } catch { finish() }
      }
    } catch { finish() }
  })
  return initialization
}

/** 合并同一批图标写入一个事务，减少首次加载数百张图标时的磁盘操作。 */
function flushIconWrites() {
  writeTimer = undefined
  if (!database || !pendingWrites.size) return
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    for (const record of pendingWrites.values()) store.put(record)
    pendingWrites.clear()
    transaction.onerror = transaction.onabort = () => {
      // 配额不足或隐私限制只禁用持久化；已经显示的图标保留在内存中。
      database?.close()
      database = undefined
    }
  } catch {
    pendingWrites.clear()
  }
}

/** 记录处理后的 PNG；Blob URL 保留至页面关闭，避免切换图表后图标失效。 */
export function saveRoundedIcon(url: string, blob: Blob): void {
  if (!memoryIcons[url]) memoryIcons[url] = URL.createObjectURL(blob)
  if (!database) return
  pendingWrites.set(url, { url, blob, updatedAt: Date.now() })
  if (writeTimer === undefined) writeTimer = setTimeout(flushIconWrites, 200)
}
