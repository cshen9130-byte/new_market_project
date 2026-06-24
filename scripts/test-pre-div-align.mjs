import { mergeNavSeriesWithEmail } from "../lib/server/email-nav-query.ts"
import { analyzeNavWorkbook } from "../lib/server/nav-cleaner.ts"
import fs from "fs"

const buf = fs.readFileSync(String.raw`c:\Users\cong\Downloads\荣熙恒盈2号净值20260624.xlsx`)
const analysis = analyzeNavWorkbook(buf, "ref.xlsx")

console.log("=== Excel: when unit/cum/adj diverge ===")
for (const r of analysis.rows) {
  if (r.date < "2026-03-10" || r.date > "2026-05-06") continue
  const same = Math.abs(r.unitNav - r.cumulativeNav) < 0.001 && Math.abs(r.unitNav - r.adjustedNav) < 0.001
  if (!same || r.date >= "2026-03-15") {
    console.log(r.date, r.unitNav, r.cumulativeNav, r.adjustedNav, same ? "SAME" : "DIFF")
  }
}

// Simulate legacy with wrong adj/cum diverging from unit pre-div (like user sees since 3/17)
const legacy = analysis.rows
  .filter((r) => r.date >= "2026-03-10" && r.date <= "2026-05-06")
  .map((r) => {
    let cum = r.cumulativeNav
    let adj = r.adjustedNav
    // inject wrong legacy: adj drifts from unit before ex-div
    if (r.date >= "2026-03-17" && r.date < "2026-04-30") {
      adj = r.unitNav * 1.001
      cum = r.unitNav * 1.002
    }
    return {
      price_date: r.date,
      nav: String(r.unitNav),
      cumulative_nav: String(adj),
      cum_nav_withdrawal: String(cum),
      price_change: "",
    }
  })

const email = analysis.rows
  .filter((r) => r.date >= "2026-03-17")
  .map((r) => ({
    price_date: r.date,
    nav: String(r.unitNav),
    cumulative_nav: r.cumulativeNav != null ? String(r.cumulativeNav) : null,
    adjusted_nav: r.adjustedNav != null ? String(r.adjustedNav) : null,
  }))

const out = mergeNavSeriesWithEmail(legacy, email)
console.log("\n=== Merged output (problem dates) ===")
for (const r of out) {
  if (r.price_date < "2026-03-15" || r.price_date > "2026-05-06") continue
  const u = parseFloat(r.nav)
  const c = parseFloat(r.cum_nav_withdrawal)
  const a = parseFloat(r.cumulative_nav)
  const same = Math.abs(u - c) < 0.001 && Math.abs(u - a) < 0.001
  console.log(r.price_date, u.toFixed(4), c.toFixed(4), a.toFixed(4), same ? "SAME" : "DIFF")
}

let preDivBad = 0
for (const r of out) {
  if (r.price_date >= "2026-04-30") break
  if (r.price_date < "2026-03-15") continue
  const u = parseFloat(r.nav)
  const c = parseFloat(r.cum_nav_withdrawal)
  const a = parseFloat(r.cumulative_nav)
  if (Math.abs(u - c) >= 0.001 || Math.abs(u - a) >= 0.001) preDivBad++
}
if (preDivBad > 0) throw new Error(`pre-div mismatch on ${preDivBad} rows`)
console.log("\nok: all pre-div rows unit=cum=adj")
