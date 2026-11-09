/**
 * A huge spike on the 平值 IV chart: the highest close in the last 5 sessions
 * is more than 15 points above the close just before that window.
 * On these series that is about the historical 99th percentile.
 */
export const INDEX_ATM_IV_SPIKE_POINTS = 15
export const INDEX_ATM_IV_SPIKE_DAYS = 5

export const INDEX_ATM_IV_SPIKE_HREF = "/ma/dashboard/realtime-quotes#section-iv"

export type AtmIvBar = { date: string; value: number }

export type AtmIvSpike = {
  product: string
  name: string
  peakDate: string
  peak: number
  baseDate: string
  base: number
}

export function atmIvSpikes(input: {
  product: string
  name: string
  bars: AtmIvBar[]
}): AtmIvSpike | null {
  const bars = input.bars.filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && Number.isFinite(bar.value))
  if (bars.length < INDEX_ATM_IV_SPIKE_DAYS + 1) return null
  const base = bars[bars.length - INDEX_ATM_IV_SPIKE_DAYS - 1]
  const window = bars.slice(-INDEX_ATM_IV_SPIKE_DAYS)
  const peak = window.reduce((best, bar) => (bar.value > best.value ? bar : best))
  if (!(peak.value - base.value > INDEX_ATM_IV_SPIKE_POINTS)) return null
  return {
    product: input.product,
    name: input.name,
    peakDate: peak.date,
    peak: peak.value,
    baseDate: base.date,
    base: base.value,
  }
}

export function atmIvSpikeMessage(spike: AtmIvSpike): { title: string; body: string; href: string; dedupeKey: string } {
  const rise = spike.peak - spike.base
  return {
    title: `${spike.peakDate} ${spike.name}平值隐含波动率尖峰`,
    body: `${spike.name}（${spike.product}）近 ${INDEX_ATM_IV_SPIKE_DAYS} 个交易日平值 IV 最高 ${spike.peak.toFixed(2)}%（${spike.peakDate}），比 ${spike.baseDate} 的 ${spike.base.toFixed(2)}% 高出 ${rise.toFixed(2)} 个点。`,
    href: INDEX_ATM_IV_SPIKE_HREF,
    dedupeKey: `index_atm_iv_spike:${spike.product}:${spike.peakDate}`,
  }
}
