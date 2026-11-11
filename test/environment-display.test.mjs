// ==================== 环境详情趋势标签展示回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { periodTrendDisplay } from '../app/utils/environment-display.ts'

test('多空方向的DI和MACD九种强弱组合均保留独立状态', () => {
  for (const direction of ['多头', '空头']) {
    for (const di of ['增强', '持平', '减弱']) {
      for (const macd of ['增强', '持平', '减弱']) {
        const label = di === macd ? `${direction}双${di}` : `${direction}DI${di}、MACD${macd}`
        assert.deepEqual(periodTrendDisplay(label), { direction, di, macd })
      }
    }
  }
})

test('中性、分歧与缺失不伪造成多空方向或指标明细', () => {
  assert.deepEqual(periodTrendDisplay('中性'), { direction: '中性' })
  assert.deepEqual(periodTrendDisplay('方向分歧'), { direction: '方向分歧' })
  assert.deepEqual(periodTrendDisplay('--'), { direction: '暂无数据' })
  assert.deepEqual(periodTrendDisplay(), { direction: '暂无数据' })
})

test('旧版合并标签不推断不存在的DI/MACD明细', () => {
  assert.deepEqual(periodTrendDisplay('多头增强'), { direction: '多头', fallback: '增强' })
  assert.deepEqual(periodTrendDisplay('空头减弱'), { direction: '空头', fallback: '减弱' })
})
