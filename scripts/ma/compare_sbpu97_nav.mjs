/**
 * Compare SBPU97 managed-product NAV seed vs reference xlsx.
 */
import fs from "fs"

import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query.ts"
import { loadManagedProductNavSeed } from "../../lib/server/managed-product-nav-seed.ts"
import { analyzeNavWorkbook } from "../../lib/server/nav-cleaner.ts"

const EXCEL = process.argv[2] ?? "c:/Users/cong/Downloads/衡颐海泰1号净值20260626.xlsx"
const excel = analyzeNavWorkbook(fs.readFileSync(EXCEL), "ref.xlsx")
const seed = loadManagedProductNavSeed("SBPU97")
const merged = mergeNavSeriesWithEmail(seed, [])

let bad = 0
for (const ex of excel.rows) {
  const m = merged.find((r) => r.price_date === ex.date)
  if (!m) {
    bad++
    console.log("missing", ex.date)
    continue
  }
  const unit = parseFloat(m.nav)
  const cum = parseFloat(m.cum_nav_withdrawal)
  const adj = parseFloat(m.cumulative_nav)
  if (Math.abs(unit - ex.unitNav) > 0.0005) {
    bad++
    console.log("unit", ex.date, unit, ex.unitNav)
  }
  if (Math.abs(cum - ex.cumulativeNav) > 0.0005) {
    bad++
    console.log("cum", ex.date, cum, ex.cumulativeNav)
  }
  const expAdj = ex.adjustedNav ?? ex.cumulativeNav
  if (Math.abs(adj - expAdj) > 0.003) {
    bad++
    console.log("adj", ex.date, adj, expAdj)
  }
}

console.log(`SBPU97 seed: ${bad} mismatches / ${excel.rows.length} (seed rows: ${seed.length})`)
process.exit(bad > 0 ? 1 : 0)
