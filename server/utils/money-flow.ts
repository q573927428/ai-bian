// ==================== K线主动资金流计算 ====================
import type { OHLCV } from '../../types'

/** 校验上游成交额，缺失、非法数据不参与计算，避免伪造零流入。 */
function validAmounts(bar: OHLCV): boolean {
  const q = bar.quoteVolume
  const b = bar.takerBuyQuoteVolume
  return typeof q === 'number' && Number.isFinite(q) && q >= 0
    && typeof b === 'number' && Number.isFinite(b) && b >= 0 && b <= q
}

/** 使用末根实际成交数据及其前四根计算；窗口必须连续，禁止按进度放大净流入。 */
export function calculateMoneyFlow(klines: OHLCV[], intervalMs: number) {
  const latest = klines.at(-1)
  const currentValid = !!latest && validAmounts(latest)
  const netInflow = currentValid ? 2 * latest.takerBuyQuoteVolume! - latest.quoteVolume! : null
  const window = klines.slice(-5)
  const complete = window.length === 5 && window.every((bar, index) =>
    validAmounts(bar) && (index === 0 || bar.timestamp - window[index - 1]!.timestamp === intervalMs))
  const totalQuoteVolume = complete ? window.reduce((sum, bar) => sum + bar.quoteVolume!, 0) : null
  const cumulativeNetInflow = complete
    ? window.reduce((sum, bar) => sum + 2 * bar.takerBuyQuoteVolume! - bar.quoteVolume!, 0) : null
  return {
    quoteVolume: currentValid ? latest.quoteVolume! : null,
    takerBuyQuoteVolume: currentValid ? latest.takerBuyQuoteVolume! : null,
    netInflow,
    netInflowPercent: currentValid && latest.quoteVolume! > 0 ? netInflow! / latest.quoteVolume! * 100 : null,
    cumulativeNetInflow,
    cumulativeNetInflowPercent: totalQuoteVolume != null && totalQuoteVolume > 0
      ? cumulativeNetInflow! / totalQuoteVolume * 100 : null,
    totalQuoteVolume,
    complete,
    windowBars: 5,
    startTimestamp: window[0]?.timestamp ?? null,
    endTimestamp: latest?.timestamp ?? null,
    includesUnclosed: !!latest && latest.timestamp + intervalMs > Date.now()
  }
}
