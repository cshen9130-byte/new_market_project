import { mergeNavSeriesWithEmail } from "../lib/server/email-nav-query.ts"
import { analyzeNavWorkbook } from "../lib/server/nav-cleaner.ts"
import fs from "fs"

function assert(name, ok) {
  if (!ok) throw new Error(name)
  console.log("ok:", name)
}

// stale legacy + spikes
const legacy = [
  { price_date: "2026-06-17", nav: "1.3184", cumulative_nav: "1.5204", cum_nav_withdrawal: "1.5284", price_change: "" },
  { price_date: "2026-06-18", nav: "1.3111", cumulative_nav: "1462545.11", cum_nav_withdrawal: "1.5211", price_change: "" },
  { price_date: "2026-06-22", nav: "1.2846", cumulative_nav: "1.5127", cum_nav_withdrawal: "1.5095", price_change: "" },
]
const email = [{ price_date: "2026-06-22", nav: "1.2846", cumulative_nav: null }]
const out = mergeNavSeriesWithEmail(legacy, email)
const maxAdj = Math.max(...out.map((r) => parseFloat(r.cumulative_nav)))
assert("spike removed", maxAdj < 10)
const r22 = out.find((r) => r.price_date === "2026-06-22")
const r18 = out.find((r) => r.price_date === "2026-06-18")
const pct = (parseFloat(r22.cumulative_nav) / parseFloat(r18.cumulative_nav) - 1) * 100
assert("adj pct ~ -2%", Math.abs(pct + 2.02) < 0.15)
console.log("0622", r22)

// attachment column detection from user excel
const buf = fs.readFileSync(String.raw`c:\Users\cong\Downloads\荣熙恒盈2号净值20260624.xlsx`)
const analysis = analyzeNavWorkbook(buf, "ref.xlsx")
assert("detects 复权 column", analysis.detectedColumns.adjustedNav != null)
const sample = analysis.rows.find((r) => r.date === "2026-06-22")
console.log("excel row", sample)
assert("excel adj ~1.4814", Math.abs(sample.adjustedNav - 1.4814) < 0.001)

// ex-div: cumulative stored as unit on 2026-04-30
const exDivLegacy = [
  { price_date: "2026-04-29", nav: "1.3565", cumulative_nav: "1.5645", cum_nav_withdrawal: "1.5665", price_change: "" },
  { price_date: "2026-04-30", nav: "1.5805", cumulative_nav: "1.5805", cum_nav_withdrawal: "1.5805", price_change: "" },
  { price_date: "2026-05-06", nav: "1.3705", cumulative_nav: "1.5805", cum_nav_withdrawal: "1.5805", price_change: "" },
]
const exOut = mergeNavSeriesWithEmail(exDivLegacy, [])
const r430 = exOut.find((r) => r.price_date === "2026-04-30")
assert("ex-div unit ~1.3705", Math.abs(parseFloat(r430.nav) - 1.3705) < 0.001)
assert("ex-div cum ~1.5805", Math.abs(parseFloat(r430.cum_nav_withdrawal) - 1.5805) < 0.001)
assert("ex-div adj ~1.5805", Math.abs(parseFloat(r430.cumulative_nav) - 1.5805) < 0.001)

// full excel key dates via attachment-shaped email rows
const keyDates = ["2026-04-30", "2026-06-18", "2026-06-22", "2026-06-23"]
for (const d of keyDates) {
  const ex = analysis.rows.find((r) => r.date === d)
  if (!ex) continue
  const emailRow = [{
    price_date: d,
    nav: String(ex.unitNav),
    cumulative_nav: ex.cumulativeNav != null ? String(ex.cumulativeNav) : null,
    adjusted_nav: ex.adjustedNav != null ? String(ex.adjustedNav) : null,
  }]
  const merged = mergeNavSeriesWithEmail(exDivLegacy, emailRow)
  const got = merged.find((r) => r.price_date === d)
  console.log(d, {
    unit: got.nav,
    cum: got.cum_nav_withdrawal,
    adj: got.cumulative_nav,
  })
}
