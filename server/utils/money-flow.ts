// ==================== K线主动资金流计算 ====================
import type { OHLCV } from '../../types'

/** 将同一行情快照的主动资金流转为提示词，缺失值不能当作零流入。 */
export function formatMoneyFlowPrompt(flow: ReturnType<typeof calculateMoneyFlow>, timeframe: string): string {
  const signed = (value: number, unit: string) => `${value > 0 ? '+' : ''}${value.toFixed(2)}${unit}`
  const amount = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return '暂无数据'
    const absolute = Math.abs(value)
    return absolute >= 1e8 ? signed(value / 1e8, '亿 USDT')
      : absolute >= 1e4 ? signed(value / 1e4, '万 USDT') : signed(value, ' USDT')
  }
  const percent = (value: number | null) => value === null || !Number.isFinite(value) ? '暂无数据' : signed(value, '%')
  const match = timeframe.match(/^(\d+)([mhdw])$/)
  const units: Record<string, string> = { m: '分钟', h: '小时', d: '天', w: '周' }
  const label = match ? `${match[1]}${units[match[2]!]}` : timeframe
  return `主动资金流（${label}，${flow.includesUnclosed ? '含未收盘K线' : '仅含已收盘K线'}）：
本根净流入：${amount(flow.netInflow)}（${percent(flow.netInflowPercent)}）
近5根累计净流入：${amount(flow.cumulativeNetInflow)}（${percent(flow.cumulativeNetInflowPercent)}）
口径：主动买入额－主动卖出额；占比=净额/成交额。
分析提示：正值表示主动买盘占优，负值表示主动卖盘占优；结合价格、成交量和OI判断趋势进一步分析`
}

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
