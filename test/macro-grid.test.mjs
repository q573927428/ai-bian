// ==================== 宏观看板动态数量与容器布局测试 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { macroGridLayout } from '../app/utils/macro-grid.ts'

test('桌面布局满足单图铺满、两图左右、三图横排和四图四宫格', () => {
  for (const [count, columns, rows] of [[1, 1, 1], [2, 2, 1], [3, 3, 1], [4, 2, 2], [6, 3, 2], [9, 3, 3], [12, 4, 3]]) {
    assert.deepEqual(macroGridLayout(count, 1900), { columns, rows })
  }
})

test('按容器宽度限制列数，所有图表始终有槽位', () => {
  assert.deepEqual(macroGridLayout(3, 950), { columns: 3, rows: 1 })
  assert.deepEqual(macroGridLayout(4, 800), { columns: 2, rows: 2 })
  assert.deepEqual(macroGridLayout(12, 400), { columns: 1, rows: 12 })
  for (const width of [0, 400, 800, 950, 1900]) {
    for (let count = 1; count <= 12; count++) {
      const { columns, rows } = macroGridLayout(count, width)
      assert.ok(columns * rows >= count)
      assert.ok(columns <= count)
      assert.ok((rows - 1) * columns < count)
    }
  }
})
