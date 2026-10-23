const fs = require("fs")

// ---- share-class-nav-fill.ts: fix multi-day carry accumulation ----
{
  const path = "D:/coding/market_website/lib/server/share-class-nav-fill.ts"
  let t = fs.readFileSync(path, "utf8")
  const old = `function carryDividendGapOntoFilledRows<T extends {
  price_date?: string
  nav_date?: string
  nav: string | number
  cumulative_nav?: string | number | null
  cum_nav_withdrawal?: string | number | null
}>(original: T[], filled: T[]): T[] {
  const originalDays = new Set(original.map((row) => rowDay(row)))
  const sorted = [...filled].sort((a, b) => rowDay(a).localeCompare(rowDay(b)))
  let changed = false
  const out = sorted.map((row, index) => {
    if (index === 0 || originalDays.has(rowDay(row))) return row
    const unit = positiveNav(row.nav)
    const cum = positiveNav(row.cum_nav_withdrawal) ?? positiveNav(row.cumulative_nav)
    const adj = positiveNav(row.cumulative_nav)
    if (unit == null) return row
    if (cum != null && Math.abs(cum - unit) / unit > COLLAPSED_TOL) return row
    if (adj != null && Math.abs(adj - unit) / unit > COLLAPSED_TOL) return row
    const prev = sorted[index - 1]
    const prevUnit = positiveNav(prev.nav)
    const prevCum = positiveNav(prev.cum_nav_withdrawal) ?? positiveNav(prev.cumulative_nav)
    const prevAdj = positiveNav(prev.cumulative_nav) ?? prevCum
    if (prevUnit == null || prevCum == null || prevAdj == null) return row
    if (prevCum - prevUnit <= DIVIDEND_GAP) return row
    const unitRatio = unit / prevUnit
    if (!(unitRatio > SAME_SERIES_UNIT && unitRatio < 1 / SAME_SERIES_UNIT)) return row
    const nextCum = unit + (prevCum - prevUnit)
    const nextAdj = prevAdj * unitRatio
    if (!(nextCum > 0) || !(nextAdj > 0)) return row
    changed = true
    return {
      ...row,
      cum_nav_withdrawal: String(+nextCum.toFixed(6)),
      cumulative_nav: String(+nextAdj.toFixed(6)),
    }
  })
  return changed ? out : filled
}`

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
  const out: T[] = []
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]
    if (index === 0 || originalDays.has(rowDay(row))) {
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
    if (cum != null && Math.abs(cum - unit) / unit > COLLAPSED_TOL) {
      out.push(row)
      continue
    }
    if (adj != null && Math.abs(adj - unit) / unit > COLLAPSED_TOL) {
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
}`

  if (!t.includes("already-fixed prior filled day") && t.includes("const prev = sorted[index - 1]")) {
    // match flexible CRLF
    const start = t.indexOf("function carryDividendGapOntoFilledRows")
    const end = t.indexOf("const SAME_DAY_SPIKE_DEVIATION", start)
    if (start < 0 || end < 0) throw new Error("carry block not found")
    t = t.slice(0, start) + neu.replace(/\n/g, "\r\n") + "\r\n\r\n" + t.slice(end)
    fs.writeFileSync(path, t)
    console.log("share-class carry fixed")
  } else if (t.includes("already-fixed prior filled day")) {
    console.log("share-class carry already fixed")
  } else {
    throw new Error("unexpected share-class content")
  }
}
