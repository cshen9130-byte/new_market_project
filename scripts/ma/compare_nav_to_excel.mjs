/**
 * Compare merged NAV output against a reference xlsx (all rows must match).
 * Usage: npx tsx scripts/ma/compare_nav_to_excel.mjs [xlsx-path]
 */
import { mergeNavSeriesWithEmail } from "../../lib/server/email-nav-query.ts"
import { analyzeNavWorkbook } from "../../lib/server/nav-cleaner.ts"
import { computeNavPctChange } from "../../app/ma/dashboard/private-funds/[beian_hao]/components/shared.ts"
import fs from "fs"

const EXCEL = process.argv[2] ?? "c:/Users/13904/Downloads/荣熙恒盈2号净值20260624.xlsx"
const buf = fs.readFileSync(EXCEL)
const excel = analyzeNavWorkbook(buf, "ref.xlsx")

function excelPct(i) {
  if (i <= 0) return null
  return ((excel.rows[i].unitNav / excel.rows[i - 1].unitNav - 1) * 100)
}

function compare(label, merged) {
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
  console.log(`${label}: ${bad} mismatches / ${excel.rows.length}`)
  for (const x of issues.slice(0, 10)) console.log(" ", x)
  return bad
}

const teamEmail = excel.rows.map((r) => ({
  price_date: r.date,
  nav: String(r.unitNav),
  cumulative_nav: String(r.cumulativeNav),
  adjusted_nav: r.adjustedNav != null ? String(r.adjustedNav) : null,
}))
const bad = compare("team nav path", mergeNavSeriesWithEmail([], teamEmail))
process.exit(bad > 0 ? 1 : 0)
