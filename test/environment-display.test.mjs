// ==================== 环境详情趋势标签展示回归 ====================
import assert from 'node:assert/strict'
import test from 'node:test'
import { directionalRankPosition, periodTrendDisplay } from '../app/utils/environment-display.ts'

test('多空排名反向展示：43名切做空为1名，首名切做空为末名', () => {
  const last = { position: 43, sampleCount: 43, tiedCount: 1 }
  assert.equal(directionalRankPosition(last, 'long'), 43)
  assert.equal(directionalRankPosition(last, 'short'), 1)
  assert.equal(directionalRankPosition({ ...last, position: 1 }, 'short'), 43)
  assert.deepEqual(last, { position: 43, sampleCount: 43, tiedCount: 1 })
})

test('反向排名按整个并列组处理，全体同值时多空均为并列第1', () => {
  assert.equal(directionalRankPosition({ position: 41, sampleCount: 43, tiedCount: 3 }, 'short'), 1)
  assert.equal(directionalRankPosition({ position: 1, sampleCount: 43, tiedCount: 3 }, 'short'), 41)
  assert.equal(directionalRankPosition({ position: 2, sampleCount: 6, tiedCount: 2 }, 'short'), 4)
  for (const direction of ['long', 'short']) {
    assert.equal(directionalRankPosition({ position: 1, sampleCount: 43, tiedCount: 43 }, direction), 1)
  }
})

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
