export const INDEX_FUTURES = [
  { product: "IH", name: "上证50" },
  { product: "IF", name: "沪深300" },
  { product: "IC", name: "中证500" },
  { product: "IM", name: "中证1000" },
] as const

export type IndexProduct = (typeof INDEX_FUTURES)[number]["product"]

export type CtpCandle = {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type CtpTick = {
  symbol: string
  last: number | null
  bid: number | null
  ask: number | null
  volume: number | null
  open_interest: number | null
  pre_close: number | null
  pre_settlement: number | null
  update_time: string | null
  update_millis: number | null
}

export type CtpStatus = {
  connected?: boolean
  logged_in?: boolean
  profile?: string
  front?: string
  message?: string
  tick_count?: number
  symbols?: string[]
  index_symbols?: string[]
}

export function contractsForProduct(symbols: string[], product: string) {
  const re = new RegExp(`^${product}\\d{4}$`, "i")
  return symbols.filter((s) => re.test(s)).sort()
}

export function pickMainContract(symbols: string[], product: string) {
  const matches = contractsForProduct(symbols, product)
  if (!matches.length) return null
  const now = new Date()
  const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`
  return matches.find((s) => s.slice(-4) >= yymm) ?? matches[matches.length - 1]
}

export function pickMostActiveContract(
  symbols: string[],
  product: string,
  quotes: Record<string, CtpTick>,
) {
  const matches = contractsForProduct(symbols, product)
  if (!matches.length) return null
  const ranked = matches
    .map((symbol) => ({
      symbol,
      oi: quotes[symbol]?.open_interest || 0,
      volume: quotes[symbol]?.volume || 0,
    }))
    .sort((a, b) => b.oi - a.oi || b.volume - a.volume)
  if (ranked[0].oi > 0 || ranked[0].volume > 0) return ranked[0].symbol
  return pickMainContract(symbols, product)
}

export function upsertCandle(history: CtpCandle[] | undefined, candle: CtpCandle | null | undefined) {
  if (!candle) return history || []
  const rows = history ? history.slice() : []
  if (!rows.length) return [candle]
  const last = rows[rows.length - 1]
  if (last.time === candle.time) {
    rows[rows.length - 1] = candle
    return rows
  }
  if (candle.time > last.time) {
    rows.push(candle)
    if (rows.length > 1500) rows.splice(0, rows.length - 1500)
    return rows
  }
  return rows
}

export function formatBarTime(unix: number) {
  const d = new Date(unix * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
