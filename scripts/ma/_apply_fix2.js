const fs = require("fs")
const path = "D:/coding/market_website/lib/server/email-nav-query.ts"
let t = fs.readFileSync(path, "utf8")
if (t.includes("adjContinuesAtUnitReturn")) {
  console.log("email-nav-query already has unit-return guard")
  process.exit(0)
}

// 1) Add adjContinuesAtUnitReturn after adjContinuesAtCumReturn
const marker = "function adjContinuesAtCumReturn(prev: LegacyNavRow, curr: LegacyNavRow): boolean {"
const idx = t.indexOf(marker)
if (idx < 0) throw new Error("adjContinuesAtCumReturn not found")
// find end of function - next function storedCumAndAdjContinue
const nextFn = t.indexOf("function storedCumAndAdjContinue", idx)
if (nextFn < 0) throw new Error("storedCumAndAdjContinue not found")
const insert = `
/**
 * 复权 already moved with 单位 from the previous day.
 * A later adj/cum premium must not overwrite that chain (S39917 / SD9197):
 * those feeds keep 复权 on the unit return while 累计 sits above on a
 * dividend gap, so adj < cum is intentional.
 */
function adjContinuesAtUnitReturn(prev: LegacyNavRow, curr: LegacyNavRow): boolean {
  const prevAdj = parseOptionalNav(prev.cumulative_nav)
  const prevUnit = parseOptionalNav(prev.nav)
  const unit = parseOptionalNav(curr.nav)
  const adj = parseOptionalNav(curr.cumulative_nav)
  if (
    prevAdj == null || prevUnit == null || prevUnit <= 0 || unit == null || unit <= 0 || adj == null
  ) return false
  if (!isReasonableNav(prevAdj) || !isReasonableNav(unit) || !isReasonableNav(adj)) return false
  return Math.abs(adj - prevAdj * unit / prevUnit) <= STORED_ORIENTATION_ABS
}

`
t = t.slice(0, nextFn) + insert.replace(/\n/g, "\r\n") + t.slice(nextFn)

// 2) Use the guard in repairAdjBelowCumRows (both premium loops) and first loop
t = t.replace(
  "if (storedCumAndAdjContinue(original[i - 1], original[i])) continue\r\n\r\n    const prev = sorted[i - 1]\r\n    const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? parseOptionalNav(prev.cum_nav_withdrawal)\r\n    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)\r\n    if (prevAdj == null || prevCum == null || prevCum <= 0 || prevAdj < prevCum - 0.001) continue",
  "if (storedCumAndAdjContinue(original[i - 1], original[i])) continue\r\n    if (adjContinuesAtUnitReturn(original[i - 1], original[i])) continue\r\n\r\n    const prev = sorted[i - 1]\r\n    const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? parseOptionalNav(prev.cum_nav_withdrawal)\r\n    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)\r\n    if (prevAdj == null || prevCum == null || prevCum <= 0 || prevAdj < prevCum - 0.001) continue"
)

// forward + backward loops already have:
// storedCumAndAdjContinue || adjContinuesAtCumReturn
// add unit return
t = t.replaceAll(
  "storedCumAndAdjContinue(original[i - 1], original[i])\r\n      || adjContinuesAtCumReturn(original[i - 1], original[i])\r\n    )) continue",
  "storedCumAndAdjContinue(original[i - 1], original[i])\r\n      || adjContinuesAtCumReturn(original[i - 1], original[i])\r\n      || adjContinuesAtUnitReturn(original[i - 1], original[i])\r\n    )) continue"
)

// 3) repairSwappedCumAdjRows: skip large swap when adj follows unit
t = t.replace(
  "(prev && storedCumAndAdjContinue(prev, row))\r\n      || (next && storedCumAndAdjContinue(row, next))\r\n    ) continue",
  "(prev && (storedCumAndAdjContinue(prev, row) || adjContinuesAtUnitReturn(prev, row)))\r\n      || (next && (storedCumAndAdjContinue(row, next) || adjContinuesAtUnitReturn(row, next)))\r\n    ) continue"
)

// 4) refreshStaleDerivedFields: unit recovery after ex-div
const staleSkip = `    // Unit recovering toward 累计 after an ex-div while 累计/复权 stay put
    // is not a stale freeze (SEM163 2019-01-14: unit 1.075 → 1.175, adj flat).
    // Rechain would reopen the dividend gap for one day and spike 复权.
    if (
      staleAdj
      && staleCum
      && cum != null
      && prevCum != null
      && prevUnit != null
      && hasDividendOffset(prevUnit, prevCum)
      && Math.abs(cum - unit) <= Math.max(0.01, unit * 0.005)
      && Math.abs(cum - prevCum) / prevCum < 0.001
    ) {
      continue
    }

`
const staleAnchor = "    // Ex-div with adj already carrying a reinvestment premium — do not treat flat adj as stale.\r\n"
if (!t.includes(staleAnchor)) throw new Error("stale anchor missing")
if (!t.includes("Unit recovering toward")) {
  t = t.replace(staleAnchor, staleSkip.replace(/\n/g, "\r\n") + staleAnchor)
}

// 5) Extend repairAdjCollapsedToUnitRows for full unit=cum=adj collapse after gap
const collapseStart = t.indexOf("function repairAdjCollapsedToUnitRows")
const collapseEnd = t.indexOf("/** When 复权 drifted below 累计", collapseStart)
if (collapseStart < 0 || collapseEnd < 0) throw new Error("collapse fn bounds missing")
const collapseFn = `function repairAdjCollapsedToUnitRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  const flatEps = 0.001
  const sorted = rows.map((row) => ({ ...row }))

  for (let i = 0; i < sorted.length; i += 1) {
    const unit = parseOptionalNav(sorted[i].nav)
    const cum = parseOptionalNav(sorted[i].cum_nav_withdrawal) ?? parseOptionalNav(sorted[i].cumulative_nav)
    const adj = parseOptionalNav(sorted[i].cumulative_nav)
    if (unit == null || cum == null || adj == null) continue

    // Classic: 累计 still has the dividend gap but 复权 fell back to 单位 (AVM354).
    if (hasDividendOffset(unit, cum) && Math.abs(adj - cum) > flatEps && Math.abs(adj - unit) <= flatEps) {
      if (i > 0) {
        const prev = sorted[i - 1]
        const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? parseOptionalNav(prev.cum_nav_withdrawal)
        const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
        if (
          prevAdj != null && prevCum != null && prevCum > 0 &&
          isReasonableNav(prevAdj) && prevAdj >= prevCum - flatEps
        ) {
          const rechained = +(prevAdj * cum / prevCum).toFixed(6)
          if (isReasonableNav(rechained) && rechained >= cum - flatEps) {
            sorted[i].cumulative_nav = String(rechained)
            continue
          }
        }
      }
      if (isReasonableNav(cum)) {
        sorted[i].cumulative_nav = String(+cum.toFixed(6))
      }
      continue
    }

    // Full collapse (单位 ≈ 累计 ≈ 复权) right after a row that still carries the
    // dividend gap. Share-class fills and unit-only Type6 tails do this
    // (LC571B after parent history, SVL369 after the 2023-07 unit rebase).
    if (
      i > 0
      && Math.abs(cum - unit) <= Math.max(0.01, unit * 0.005)
      && Math.abs(adj - unit) <= Math.max(0.01, unit * 0.005)
    ) {
      const prev = sorted[i - 1]
      const prevUnit = parseOptionalNav(prev.nav)
      const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
      const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? prevCum
      if (
        prevUnit == null || prevUnit <= 0 || prevCum == null || prevAdj == null
        || !hasDividendOffset(prevUnit, prevCum)
        || !isReasonableNav(prevAdj)
      ) continue
      const unitRatio = unit / prevUnit
      if (unitRatio <= 0.7 || unitRatio >= 1 / 0.7) continue
      const nextCum = unit + (prevCum - prevUnit)
      const nextAdj = prevAdj * unitRatio
      if (!isReasonableNav(nextCum) || !isReasonableNav(nextAdj) || nextAdj + flatEps < nextCum) continue
      sorted[i].cum_nav_withdrawal = String(+nextCum.toFixed(6))
      sorted[i].cumulative_nav = String(+nextAdj.toFixed(6))
    }
  }

  return sorted
}

`
t = t.slice(0, collapseStart) + collapseFn.replace(/\n/g, "\r\n") + t.slice(collapseEnd)

fs.writeFileSync(path, t)
console.log("email-nav-query patched")
