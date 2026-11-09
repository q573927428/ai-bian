// ==================== 圆形图标持久缓存回归测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

/** 模拟异步 IndexedDB 请求并保留磁盘记录，验证刷新后的恢复流程。 */
function cache(records = new Map(), blocked = false) {
  let opens = 0
  let urls = 0
  const writes = []
  const store = {
    getAll() {
      const request = { result: [...records.values()] }
      queueMicrotask(() => request.onsuccess())
      return request
    },
    put(record) { records.set(record.url, record); writes.push(record.url) },
    delete(url) { records.delete(url) },
  }
  const database = { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => store }), close() {} }
  const context = {
    exports: {}, Blob, setTimeout, clearTimeout,
    URL: { createObjectURL: () => `blob:test-${++urls}` },
    indexedDB: { open() {
      opens++
      if (blocked) throw new Error('storage disabled')
      const request = { result: database }
      queueMicrotask(() => request.onsuccess())
      return request
    } },
  }
  const source = fs.readFileSync(new URL('../app/utils/rounded-icon-cache.ts', import.meta.url), 'utf8')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), context)
  return { ...context.exports, writes, opens: () => opens }
}

test('合并首次读取，批量保存PNG Blob并在刷新后恢复', async () => {
  const records = new Map()
  const first = cache(records)
  assert.equal(first.loadRoundedIconCache(), first.loadRoundedIconCache())
  await first.loadRoundedIconCache()
  first.saveRoundedIcon('/BTC.png', new Blob(['png'], { type: 'image/png' }))
  first.saveRoundedIcon('/ETH.png', new Blob(['png2'], { type: 'image/png' }))
  assert.match(first.getRoundedIconMemoryCache()['/BTC.png'], /^blob:/)
  assert.equal(first.writes.length, 0)
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(first.writes.length, 2)
  const refreshed = cache(records)
  const restored = await refreshed.loadRoundedIconCache()
  assert.match(restored['/BTC.png'], /^blob:/)
  assert.match(restored['/ETH.png'], /^blob:/)
  assert.equal(first.opens(), 1)
  assert.equal(refreshed.writes.length, 0)
})

test('过期或损坏的记录被清理，有效缓存继续复用', async () => {
  const records = new Map([
    ['old', { url: 'old', blob: new Blob(['png']), updatedAt: Date.now() - 8 * 86400000 }],
    ['bad', { url: 'bad', blob: 'invalid', updatedAt: Date.now() }],
    ['good', { url: 'good', blob: new Blob(['png']), updatedAt: Date.now() }],
  ])
  const api = cache(records)
  const restored = await api.loadRoundedIconCache()
  assert.deepEqual(Object.keys(restored), ['good'])
  assert.deepEqual([...records.keys()], ['good'])
})

test('浏览器禁用存储时正常降级为内存缓存', async () => {
  const api = cache(new Map(), true)
  assert.deepEqual(Object.keys(await api.loadRoundedIconCache()), [])
  api.saveRoundedIcon('/BTC.png', new Blob(['png']))
  const original = api.getRoundedIconMemoryCache()['/BTC.png']
  api.saveRoundedIcon('/BTC.png', new Blob(['png']))
  assert.equal(api.getRoundedIconMemoryCache()['/BTC.png'], original)
  assert.equal(api.writes.length, 0)
})
