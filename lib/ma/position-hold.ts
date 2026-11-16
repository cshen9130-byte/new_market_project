/** How long a book has held a product, and whether the open lots are ahead of entry. */

export type ExposureDay = {
  date: string
  netLots: number
  grossLots: number
}

export type HoldSpell = {
  /** Calendar days from the first day of this spell to the report date. 0 means opened that day. */
  days: number
  since: string
  capped: boolean
  mode: "direction" | "gross"
}

export type WeightedMedian = {
  median: number
  n: number
}

const LOT_EPS = 1e-6
const SPREAD_NET_RATIO = 0.25
export const PRODUCT_TYPICAL_MIN = 8
export const TYPICAL_MIN = 3

export function calendarDays(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

function isSpread(netLots: number, grossLots: number): boolean {
  const gross = Math.abs(grossLots)
  const net = Math.abs(netLots)
  return gross > LOT_EPS && net < SPREAD_NET_RATIO * gross && gross > net * 1.5
}

/**
 * Current product spell.
 * `presentDates` are days this account has a settlement file, including days with no position.
 * A file with no position in this product ends the spell. A missing file does not.
 * A sign flip starts a new spell. A two-sided book keeps one spell until both sides are gone.
 * If the spell touches the first day in the book, the length is a lower bound.
 */
export function holdSpell(input: {
  exposure: ExposureDay[]
  presentDates: readonly string[]
  asOf: string
  dataStart: string | null
}): HoldSpell | null {
  const asOf = input.asOf.slice(0, 10)
  const byDate = new Map<string, { netLots: number; grossLots: number }>()
  for (const row of input.exposure) {
    const date = row.date.slice(0, 10)
    if (!date || date > asOf) continue
    const cur = byDate.get(date) ?? { netLots: 0, grossLots: 0 }
    cur.netLots += row.netLots
    cur.grossLots += row.grossLots
    byDate.set(date, cur)
  }
  const today = byDate.get(asOf)
  if (!today || today.grossLots <= LOT_EPS) return null

  const mode: HoldSpell["mode"] = isSpread(today.netLots, today.grossLots) ? "gross" : "direction"
  const sign = Math.sign(today.netLots) || 1
  const dates = new Set<string>()
  for (const date of input.presentDates) {
    const day = date.slice(0, 10)
    if (day && day <= asOf) dates.add(day)
  }
  for (const date of byDate.keys()) dates.add(date)
  const ordered = [...dates].sort()

  let since = asOf
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const date = ordered[i]
    if (date === asOf) continue
    const row = byDate.get(date)
    const gross = row?.grossLots ?? 0
    const net = row?.netLots ?? 0
    if (gross <= LOT_EPS) break
    if (mode === "direction" && Math.sign(net) !== sign) break
    since = date
  }

  const start = input.dataStart?.slice(0, 10) || null
  return {
    days: calendarDays(since, asOf),
    since,
    capped: Boolean(start && since <= start),
    mode,
  }
}

export function weightedMedian(samples: Array<{ value: number; weight: number }>): WeightedMedian | null {
  const rows = samples.filter((row) => Number.isFinite(row.value) && row.weight > 0 && row.value >= 0 && row.value <= 800)
  if (rows.length === 0) return null
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  rows.sort((a, b) => a.value - b.value)
  let acc = 0
  const target = total / 2
  for (const row of rows) {
    acc += row.weight
    if (acc >= target - 1e-9) return { median: row.value, n: rows.length }
  }
  return { median: rows[rows.length - 1].value, n: rows.length }
}

export function pickTypicalHold(
  product: WeightedMedian | null,
  account: WeightedMedian | null,
): { days: number; n: number; scope: "product" | "account" } | null {
  if (product && product.n >= PRODUCT_TYPICAL_MIN) return { days: product.median, n: product.n, scope: "product" }
  if (account && account.n >= PRODUCT_TYPICAL_MIN) return { days: account.median, n: account.n, scope: "account" }
  if (product && product.n >= TYPICAL_MIN) return { days: product.median, n: product.n, scope: "product" }
  if (account && account.n >= TYPICAL_MIN) return { days: account.median, n: account.n, scope: "account" }
  return null
}

export function openLotAge(
  lots: Array<{ openDate: string | null; lots: number }>,
  asOf: string,
): { weightedDays: number | null; oldestDate: string | null } {
  let weight = 0
  let acc = 0
  let oldest: string | null = null
  for (const lot of lots) {
    const openDate = lot.openDate?.slice(0, 10) ?? ""
    if (!openDate || lot.lots <= 0) continue
    const days = calendarDays(openDate, asOf)
    if (days < 0 || days > 800) continue
    weight += lot.lots
    acc += days * lot.lots
    if (!oldest || openDate < oldest) oldest = openDate
  }
  return {
    weightedDays: weight > 0 ? Math.round(acc / weight) : null,
    oldestDate: oldest,
  }
}

/**
 * Open-to-settle P&L for one lot. Long: (settle − buy) × lots × multiplier.
 * Short: (sell − settle) × lots × multiplier. A missing entry price is skipped.
 */
export function lotFloatingPnl(input: {
  buyLots: number
  buyPx: number
  sellLots: number
  sellPx: number
  settle: number
  marketValue: number
  multiplierFallback: number
}): number | null {
  const { buyLots, sellLots, buyPx, sellPx, settle } = input
  if (!(settle > 0)) return null
  const lots = buyLots + sellLots
  if (!(lots > 0)) return null
  let mult = 0
  if (input.marketValue > 0) {
    const raw = input.marketValue / (settle * lots)
    const rounded = Math.round(raw)
    if (rounded > 0 && Math.abs(raw - rounded) / rounded < 0.05) mult = rounded
  }
  if (!(mult > 0)) mult = input.multiplierFallback
  if (!(mult > 0)) return null
  let pnl = 0
  let used = false
  if (buyLots > 0 && buyPx > 0) {
    pnl += (settle - buyPx) * buyLots * mult
    used = true
  }
  if (sellLots > 0 && sellPx > 0) {
    pnl += (sellPx - settle) * sellLots * mult
    used = true
  }
  return used ? pnl : null
}

export type PositionHoldStats = {
  holdDays: number | null
  holdSince: string | null
  holdCapped: boolean
  holdMode: "direction" | "gross" | null
  lotAgeDays: number | null
  oldestLotDate: string | null
  typicalDays: number | null
  typicalN: number
  typicalScope: "product" | "account" | null
  productTypicalDays: number | null
  productTypicalN: number
  accountTypicalDays: number | null
  accountTypicalN: number
  floatPnl: number | null
}
