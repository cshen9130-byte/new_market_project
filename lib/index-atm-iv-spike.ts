/**
 * A huge spike on the 平值 IV chart: the highest close in the last 5 sessions
 * is more than 15 points above the close just before that window.
 * On these series that is about the historical 99th percentile.
 */
export const INDEX_ATM_IV_SPIKE_POINTS = 15
export const INDEX_ATM_IV_SPIKE_DAYS = 5

/** Pro desk on the daily near-quarter contract, so the bottom-right IV panel is the daily QVIX line. */
export function atmIvSpikeHref(product: string): string {
  const code = product.trim().toUpperCase()
  return `/ma/dashboard/realtime-quotes?view=pro&product=${code}&desk=season`
}

/** Older alerts stored the four-chart link. The dedupe key still names the product. */
export function atmIvSpikeHrefForDedupe(dedupeKey: string): string | null {
  const match = /^index_atm_iv_spike:(IH|IF|IC|IM):/.exec(dedupeKey)
  return match ? atmIvSpikeHref(match[1]) : null
}

export function atmIvSpikeDesk(search: string): { product: "IH" | "IF" | "IC" | "IM" } | null {
  const query = search.includes("?") ? search.slice(search.indexOf("?") + 1) : search.replace(/^\?/, "")
  const params = new URLSearchParams(query)
  if (params.get("view") !== "pro" || params.get("desk") !== "season") return null
  const product = (params.get("product") || "").trim().toUpperCase()
  if (product !== "IH" && product !== "IF" && product !== "IC" && product !== "IM") return null
  return { product }
}

export type AtmIvBar = { date: string; value: number }

export type AtmIvSpike = {
  product: string
  name: string
  peakDate: string
  peak: number
  baseDate: string
  base: number
}

/**
 * The quotes chart's 平值 series is the stored minute tape. A synthetic daily
 * close can print a one-day spike the tape never traded (66% against a 36% high).
 * Where the tape has that session, its last print replaces the daily close.
 */
export function barsWithSessionCloses(bars: AtmIvBar[], closes: Map<string, number>): AtmIvBar[] {
  if (closes.size === 0) return bars
  return bars.map((bar) => {
    const close = closes.get(bar.date)
    return close != null && close > 0 ? { date: bar.date, value: close } : bar
  })
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
    body: `${spike.name}（${spike.product}）日线近 ${INDEX_ATM_IV_SPIKE_DAYS} 个交易日 QVIX 最高 ${spike.peak.toFixed(2)}%（${spike.peakDate}），比 ${spike.baseDate} 的 ${spike.base.toFixed(2)}% 高出 ${rise.toFixed(2)} 个点。`,
    href: atmIvSpikeHref(spike.product),
    dedupeKey: `index_atm_iv_spike:${spike.product}:${spike.peakDate}`,
  }
}
