/**
 * Compare managed-product NAV path (excel seed + team unit overlay) vs reference xlsx.
 */
import fs from "fs"

import { computeNavPctChange } from "../../app/ma/dashboard/private-funds/[beian_hao]/components/shared.ts"
import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query.ts"
import { loadManagedProductNavSeed } from "../../lib/server/managed-product-nav-seed.ts"
import { analyzeNavWorkbook } from "../../lib/server/nav-cleaner.ts"

const EXCEL = process.argv[2] ?? "c:/Users/13904/Downloads/荣熙恒盈2号净值20260624.xlsx"
const excel = analyzeNavWorkbook(fs.readFileSync(EXCEL), "ref.xlsx")
const seed = loadManagedProductNavSeed("SBAH99")

// Team DB stream is unit-only from 2026-01-16 (simulated with excel units).
const teamUnitPoints = excel.rows
  .filter((r) => r.date >= "2026-01-16")
  .map((r) => ({
    price_date: r.date,
    nav: String(r.unitNav),
    cumulative_nav: null,
    adjusted_nav: null,
  }))

const merged = mergeNavSeriesWithEmail(seed, teamUnitPoints)

function excelPct(i) {
  if (i <= 0) return null
  return ((excel.rows[i].unitNav / excel.rows[i - 1].unitNav - 1) * 100)
}

let bad = 0
const issues = []
for (let i = 0; i < excel.rows.length; i++) {
  const ex = excel.rows[i]
  const m = merged.find((r) => r.price_date === ex.date)
  if (!m) {
    bad++
    issues.push({ date: ex.date, field: "missing" })
    continue
  }
  const pct = computeNavPctChange(merged, "单位净值", ex.date)
  const expPct = excelPct(i)
  const checks = [
    ["unit", parseFloat(m.nav), ex.unitNav],
    ["cum", parseFloat(m.cum_nav_withdrawal), ex.cumulativeNav],
    ["adj", parseFloat(m.cumulative_nav), ex.adjustedNav ?? ex.cumulativeNav],
  ]
  for (const [field, got, exp] of checks) {
    if (Math.abs(got - exp) > 0.0005) {
      bad++
      issues.push({ date: ex.date, field, got, exp })
    }
  }
  if (expPct != null && (pct == null || Math.abs(pct - expPct) > 0.05)) {
    bad++
    issues.push({ date: ex.date, field: "pct", got: pct, exp: expPct })
  }
}

console.log(`managed seed path: ${bad} mismatches / ${excel.rows.length} (seed rows: ${seed.length})`)
for (const x of issues.slice(0, 15)) console.log(" ", x)
process.exit(bad > 0 ? 1 : 0)
