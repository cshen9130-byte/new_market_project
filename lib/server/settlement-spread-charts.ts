import { query } from "@/lib/db"

export type SpreadOrderPoint = {
  date: string
  instrument: string
  bs: "买" | "卖"
  oc: "开" | "平"
  lots: number
  /** Number of raw fill rows rolled into this marker. */
  fills: number
  spreadValue: number | null
  /**
   * Same-day trades on other months of the same product family
   * (e.g. LC2608/LC2610 while chart is LC2607-LC2609). Explains apparent one-leg opens.
   */
  relatedHedges: Array<{
    instrument: string
    bs: "买" | "卖"
    oc: "开" | "平"
    lots: number
    fills: number
  }>
}

export type GuoxinSpreadChart = {
  id: string
  name: string
  legA: string
  legB: string
  dates: string[]
  spread: (number | null)[]
  z20: (number | null)[]
  orderPoints: SpreadOrderPoint[]
  /** Raw fill count on the two legs (not whole product). */
  legFills: number
  /** Days where chart-leg opens look one-sided but other-month hedges exist same day. */
  crossMonthHedgeDays: number
  /** Days with balanced buy≈sell opens on the two chart legs. */
  pairedLegOpenDays: number
  entryDate: string | null
  exitDate: string | null
}

export type GuoxinOrderTimelinePoint = {
  date: string
  bs: "买" | "卖"
  oc: "开" | "平"
  lots: number
  signedLots: number
  fills: number
}

type TradeLike = {
  trade_date: string
  instrument: string
  bs: string
  oc: string
  lots: string | number
}

type SpreadDef = {
  name: string
  legA: string
  legB: string
  entry: string | null
  exit: string | null
}

const SPREAD_DEFS: SpreadDef[] = [
  { name: "玻璃 FG609-FG605", legA: "FG609", legB: "FG605", entry: "2026-04-17", exit: "2026-04-20" },
  { name: "玻璃 FG609-FG701", legA: "FG609", legB: "FG701", entry: "2026-04-21", exit: null },
  { name: "鸡蛋 JD2607-JD2606", legA: "JD2607", legB: "JD2606", entry: "2026-04-21", exit: "2026-04-22" },
  { name: "铝 AL2605-AL2606", legA: "AL2605", legB: "AL2606", entry: "2026-04-23", exit: null },
  { name: "不锈钢 SS2606-SS2607", legA: "SS2606", legB: "SS2607", entry: "2026-04-23", exit: null },
  { name: "碳酸锂 LC2607-LC2609", legA: "LC2607", legB: "LC2609", entry: "2026-04-17", exit: null },
  { name: "碳酸锂 LC2608-LC2609", legA: "LC2608", legB: "LC2609", entry: "2026-04-17", exit: null },
  { name: "碳酸锂 LC2610-LC2609", legA: "LC2610", legB: "LC2609", entry: "2026-04-17", exit: "2026-04-17" },
]

const KEY_SPREAD_NAMES = new Set([
  "碳酸锂 LC2607-LC2609",
  "鸡蛋 JD2607-JD2606",
  "铝 AL2605-AL2606",
  "玻璃 FG609-FG605",
  "玻璃 FG609-FG701",
])

function n(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const x = typeof v === "string" ? parseFloat(v) : v
  return Number.isFinite(x) ? x : 0
}

export function toCanonicalSymbol(sym: string): string {
  const s = String(sym || "")
    .trim()
    .toUpperCase()
    .replace(/\..*$/, "")
  const m = s.match(/^([A-Z]+)([0-9])(\d{2})$/)
  if (!m) return s
  const [, product, yearDigit, month] = m
  const decade = Number(yearDigit) >= 5 ? "2" : "3"
  return `${product}${decade}${yearDigit}${month}`
}

function normBs(value: string): "买" | "卖" | null {
  const s = String(value || "").trim()
  if (!s) return null
  if (s === "买" || s === "B" || s === "b" || s.includes("买")) return "买"
  if (s === "卖" || s === "S" || s === "s" || s.includes("卖")) return "卖"
  return null
}

function normOc(value: string): "开" | "平" | null {
  const s = String(value || "").trim()
  if (!s) return null
  if (s.startsWith("开") || s === "O" || s === "o") return "开"
  if (s.startsWith("平") || s === "C" || s === "c") return "平"
  return null
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function rollingZ20(values: (number | null)[]): (number | null)[] {
  return values.map((value, i) => {
    if (value == null) return null
    const window = values.slice(Math.max(0, i - 19), i + 1).filter((v): v is number => v != null)
    if (window.length < 5) return null
    const mean = window.reduce((a, b) => a + b, 0) / window.length
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(window.length - 1, 1)
    const std = Math.sqrt(variance)
    if (!(std > 0)) return null
    return (value - mean) / std
  })
}

export function buildOrderTimeline(trades: TradeLike[]): GuoxinOrderTimelinePoint[] {
  const agg = new Map<string, { lots: number; fills: number }>()
  for (const row of trades) {
    const bs = normBs(row.bs)
    const oc = normOc(row.oc)
    const lots = n(row.lots)
    if (!bs || !oc || lots <= 0) continue
    const date = String(row.trade_date).slice(0, 10)
    const key = `${date}\0${bs}\0${oc}`
    const cur = agg.get(key) ?? { lots: 0, fills: 0 }
    agg.set(key, { lots: cur.lots + lots, fills: cur.fills + 1 })
  }
  return Array.from(agg.entries())
    .map(([key, v]) => {
      const [date, bs, oc] = key.split("\0") as [string, "买" | "卖", "开" | "平"]
      return {
        date,
        bs,
        oc,
        lots: v.lots,
        fills: v.fills,
        signedLots: bs === "买" ? v.lots : -v.lots,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.bs.localeCompare(b.bs) || a.oc.localeCompare(b.oc))
}

async function fetchSettles(
  symbols: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, Map<string, number>>> {
  if (symbols.length === 0) return new Map()
  type Row = { date: string; sym: string; settle: string | number }
  const rows = await query<Row>(
    `
    SELECT DISTINCT ON (trade_date, sym)
      trade_date::text AS date,
      UPPER(SPLIT_PART(contract, '.', 1)) AS sym,
      clear AS settle
    FROM raw_futures_contracts_daily
    WHERE trade_date BETWEEN $1::date AND $2::date
      AND UPPER(SPLIT_PART(contract, '.', 1)) = ANY($3::text[])
      AND clear IS NOT NULL
    ORDER BY trade_date, sym,
      CASE WHEN contract LIKE '%.%' THEN 0 ELSE 1 END,
      contract
    `,
    [startDate, endDate, symbols],
  ).catch(() => [] as Row[])

  const bySym = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const settle = n(row.settle)
    if (!Number.isFinite(settle)) continue
    const sym = String(row.sym || "").toUpperCase()
    if (!bySym.has(sym)) bySym.set(sym, new Map())
    bySym.get(sym)!.set(String(row.date).slice(0, 10), settle)
  }
  return bySym
}

export async function buildSpreadCharts(
  trades: TradeLike[],
  startDate: string,
  endDate: string,
): Promise<GuoxinSpreadChart[]> {
  const tradedSymbols = new Set(trades.map((t) => toCanonicalSymbol(t.instrument)).filter(Boolean))
  const candidates = SPREAD_DEFS.filter(
    (def) =>
      KEY_SPREAD_NAMES.has(def.name) ||
      tradedSymbols.has(def.legA) ||
      tradedSymbols.has(def.legB),
  )
  if (candidates.length === 0) return []

  const symbols = [...new Set(candidates.flatMap((d) => [d.legA, d.legB]))]
  const marketStart = shiftDate(startDate, -25)
  const settles = await fetchSettles(symbols, marketStart, endDate)

  const orderAgg = new Map<string, { lots: number; fills: number }>()
  for (const row of trades) {
    const bs = normBs(row.bs)
    const oc = normOc(row.oc)
    const lots = n(row.lots)
    const sym = toCanonicalSymbol(row.instrument)
    if (!bs || !oc || lots <= 0 || !sym) continue
    const date = String(row.trade_date).slice(0, 10)
    // Keep legs separate: date × contract × side × open/close
    const key = `${date}\0${sym}\0${bs}\0${oc}`
    const cur = orderAgg.get(key) ?? { lots: 0, fills: 0 }
    orderAgg.set(key, { lots: cur.lots + lots, fills: cur.fills + 1 })
  }

  const charts: GuoxinSpreadChart[] = []
  for (const def of candidates) {
    const mapA = settles.get(def.legA)
    const mapB = settles.get(def.legB)
    if (!mapA || !mapB) continue

    const dates = [...new Set([...mapA.keys(), ...mapB.keys()])]
      .filter((d) => d >= marketStart && d <= endDate)
      .sort()
    if (dates.length < 5) continue

    const spread = dates.map((d) => {
      const a = mapA.get(d)
      const b = mapB.get(d)
      if (a == null || b == null) return null
      return a - b
    })
    const z20 = rollingZ20(spread)
    const spreadByDate = new Map(dates.map((d, i) => [d, spread[i]]))

    const legSet = new Set([def.legA, def.legB])
    const family = def.legA.replace(/[0-9]/g, "")
    const dayBuckets = new Map<string, number>()
    const orderPoints: SpreadOrderPoint[] = []
    let legFills = 0

    const relatedByDate = new Map<
      string,
      Array<{ instrument: string; bs: "买" | "卖"; oc: "开" | "平"; lots: number; fills: number }>
    >()
    for (const [key, agg] of orderAgg) {
      const [date, instrument, bs, oc] = key.split("\0") as [string, string, "买" | "卖", "开" | "平"]
      if (legSet.has(instrument)) continue
      if (!instrument.startsWith(family)) continue
      if (date < startDate || date > endDate) continue
      const list = relatedByDate.get(date) ?? []
      list.push({ instrument, bs, oc, lots: agg.lots, fills: agg.fills })
      relatedByDate.set(date, list)
    }

    for (const [key, agg] of orderAgg) {
      const [date, instrument, bs, oc] = key.split("\0") as [string, string, "买" | "卖", "开" | "平"]
      if (!legSet.has(instrument)) continue
      if (date < startDate || date > endDate) continue
      const base = spreadByDate.get(date)
      if (base == null) continue
      legFills += agg.fills
      const bucket = dayBuckets.get(date) ?? 0
      dayBuckets.set(date, bucket + 1)
      // Small vertical stagger so same-day multi-leg / multi-side markers stay visible.
      const spreadValue = base + (bucket % 5) * Math.max(Math.abs(base) * 0.002, 1)
      orderPoints.push({
        date,
        instrument,
        bs,
        oc,
        lots: agg.lots,
        fills: agg.fills,
        spreadValue,
        relatedHedges: relatedByDate.get(date) ?? [],
      })
    }
    orderPoints.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.instrument.localeCompare(b.instrument) ||
        a.bs.localeCompare(b.bs) ||
        a.oc.localeCompare(b.oc),
    )

    // Pairing diagnostics for the two chart legs only.
    const openByDate = new Map<string, { buy: number; sell: number; legs: Set<string> }>()
    for (const p of orderPoints) {
      if (p.oc !== "开") continue
      const cur = openByDate.get(p.date) ?? { buy: 0, sell: 0, legs: new Set<string>() }
      if (p.bs === "买") cur.buy += p.lots
      else cur.sell += p.lots
      cur.legs.add(p.instrument)
      openByDate.set(p.date, cur)
    }
    let pairedLegOpenDays = 0
    let crossMonthHedgeDays = 0
    for (const [date, cur] of openByDate) {
      const balanced = cur.buy > 0 && cur.sell > 0 && Math.abs(cur.buy - cur.sell) < 0.01 && cur.legs.size >= 2
      if (balanced) pairedLegOpenDays++
      else if ((relatedByDate.get(date) ?? []).some((r) => r.oc === "开")) crossMonthHedgeDays++
    }

    // Keep series mainly in account window, but retain lookback for Z20 continuity.
    const startIdx = Math.max(
      0,
      dates.findIndex((d) => d >= startDate) - 5,
    )
    const viewDates = dates.slice(startIdx)
    const viewSpread = spread.slice(startIdx)
    const viewZ20 = z20.slice(startIdx)

    charts.push({
      id: `${def.legA}_${def.legB}`,
      name: def.name,
      legA: def.legA,
      legB: def.legB,
      dates: viewDates,
      spread: viewSpread,
      z20: viewZ20,
      orderPoints,
      legFills,
      crossMonthHedgeDays,
      pairedLegOpenDays,
      entryDate: def.entry,
      exitDate: def.exit,
    })
  }

  charts.sort((a, b) => {
    const score = (c: GuoxinSpreadChart) =>
      (KEY_SPREAD_NAMES.has(c.name) ? 1000 : 0) + c.orderPoints.length * 10 + c.dates.length
    return score(b) - score(a)
  })

  return charts.slice(0, 5)
}
