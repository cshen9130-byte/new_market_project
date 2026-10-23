const fs = require("fs")
const path = "D:/coding/market_website/lib/server/share-class-nav-fill.ts"
let t = fs.readFileSync(path, "utf8")
const start = t.indexOf("function carryDividendGapOntoFilledRows")
const end = t.indexOf("const SAME_DAY_SPIKE_DEVIATION", start)
if (start < 0 || end < 0) throw new Error("bounds")
const neu = `function carryDividendGapOntoFilledRows<T extends {
  price_date?: string
  nav_date?: string
  nav: string | number
  cumulative_nav?: string | number | null
  cum_nav_withdrawal?: string | number | null
}>(original: T[], filled: T[]): T[] {
  const originalDays = new Set(original.map((row) => rowDay(row)))
  const sorted = [...filled].sort((a, b) => rowDay(a).localeCompare(rowDay(b)))
  let changed = false
  // Walk forward so a multi-day hole (SLC571 2025-06-23..26) carries from the
  // already-fixed prior filled day, not the collapsed donor row still in sorted[].
  // Own dates that publish 单位=累计=复权 after a gap-bearing filled prefix
  // (LC571B after parent history) need the same carry — finalize already ran.
  const out: T[] = []
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]
    if (index === 0) {
      out.push(row)
      continue
    }
    const unit = positiveNav(row.nav)
    const cum = positiveNav(row.cum_nav_withdrawal) ?? positiveNav(row.cumulative_nav)
    const adj = positiveNav(row.cumulative_nav)
    if (unit == null) {
      out.push(row)
      continue
    }
    const collapsedCum = cum == null || Math.abs(cum - unit) / unit <= COLLAPSED_TOL
    const collapsedAdj = adj == null || Math.abs(adj - unit) / unit <= COLLAPSED_TOL
    if (!collapsedCum || !collapsedAdj) {
      out.push(row)
      continue
    }
    const prev = out[index - 1]
    const prevUnit = positiveNav(prev.nav)
    const prevCum = positiveNav(prev.cum_nav_withdrawal) ?? positiveNav(prev.cumulative_nav)
    const prevAdj = positiveNav(prev.cumulative_nav) ?? prevCum
    if (prevUnit == null || prevCum == null || prevAdj == null) {
      out.push(row)
      continue
    }
    if (prevCum - prevUnit <= DIVIDEND_GAP) {
      out.push(row)
      continue
    }
    const unitRatio = unit / prevUnit
    if (!(unitRatio > SAME_SERIES_UNIT && unitRatio < 1 / SAME_SERIES_UNIT)) {
      out.push(row)
      continue
    }
    const nextCum = unit + (prevCum - prevUnit)
    const nextAdj = prevAdj * unitRatio
    if (!(nextCum > 0) || !(nextAdj > 0)) {
      out.push(row)
      continue
    }
    changed = true
    out.push({
      ...row,
      cum_nav_withdrawal: String(+nextCum.toFixed(6)),
      cumulative_nav: String(+nextAdj.toFixed(6)),
    })
  }
  return changed ? out : filled
}

`
t = t.slice(0, start) + neu.replace(/\n/g, "\r\n") + t.slice(end)
fs.writeFileSync(path, t)
console.log("carry rewritten")
