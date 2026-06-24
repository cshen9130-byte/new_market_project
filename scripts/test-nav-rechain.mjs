import { mergeLegacyWithTeamNav, mergeNavSeriesWithEmail } from "../lib/server/email-nav-query.ts"
import { computeManagedProductOneYearRiskMetrics, isPlausibleRiskRatio } from "../lib/server/managed-product-nav-seed.ts"
import { analyzeNavWorkbook } from "../lib/server/nav-cleaner.ts"
import fs from "fs"

function assert(name, ok) {
  if (!ok) throw new Error(name)
  console.log("ok:", name)
}

const risk = computeManagedProductOneYearRiskMetrics("SBAH99", "2026-06-23")
console.log("SBAH99 1y risk", risk)
assert("managed calmar plausible", isPlausibleRiskRatio(risk.calmar_1y))
assert("managed calmar not absurd", risk.calmar_1y <= 100)

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

// legacy unit NAV spikes (Jan 2026) while cum/adj are sane
const janLegacy = [
  { price_date: "2026-01-08", nav: "1.2220", cumulative_nav: "1.2220", cum_nav_withdrawal: "1.2220", price_change: "" },
  { price_date: "2026-01-09", nav: "10040991.1000", cumulative_nav: "1.2393", cum_nav_withdrawal: "1.2393", price_change: "" },
  { price_date: "2026-01-12", nav: "10468784.4700", cumulative_nav: "1.2921", cum_nav_withdrawal: "1.2921", price_change: "" },
  { price_date: "2026-01-15", nav: "10616243.5500", cumulative_nav: "1.3103", cum_nav_withdrawal: "1.3103", price_change: "" },
  { price_date: "2026-01-16", nav: "1.2851", cumulative_nav: "1.2851", cum_nav_withdrawal: "1.2851", price_change: "" },
]
const janOut = mergeNavSeriesWithEmail(janLegacy, [])
for (const d of ["2026-01-09", "2026-01-12", "2026-01-15"]) {
  const r = janOut.find((x) => x.price_date === d)
  const u = parseFloat(r.nav)
  assert(`jan unit sane ${d}`, u > 0.5 && u < 5)
  assert(`jan unit matches cum ${d}`, Math.abs(u - parseFloat(r.cum_nav_withdrawal)) < 0.001)
}
assert("no million-scale unit left", janOut.every((r) => parseFloat(r.nav) < 100))

// Full series: 涨跌幅 matches Excel (prev row in series, incl. post-holiday)
const fullDec = [
  { price_date: "2025-12-25", nav: "1.1717", cumulative_nav: "1.1717", cum_nav_withdrawal: "1.1717", price_change: "" },
  { price_date: "2025-12-26", nav: "1.202", cumulative_nav: "1.202", cum_nav_withdrawal: "1.202", price_change: "" },
]
const fullOut = mergeNavSeriesWithEmail(fullDec, [])
const full1226 = fullOut.find((r) => r.price_date === "2025-12-26")
assert("full series 1226 pct ~2.59%", Math.abs(parseFloat(full1226.price_change) - 2.59) < 0.01)

// Managed product: sparse type6 legacy + full team email → team wins, 1226 pct correct
const sparseDecLegacy = [
  { price_date: "2025-12-19", nav: "1.0925", cumulative_nav: "1.0925", cum_nav_withdrawal: "1.0925", price_change: "" },
  { price_date: "2025-12-26", nav: "1.2020", cumulative_nav: "1.2020", cum_nav_withdrawal: "1.2020", price_change: "" },
]
const fullTeamDec = [
  { price_date: "2025-12-19", nav: "1.0925", cumulative_nav: "1.0925", cum_nav_withdrawal: "1.0925", price_change: "" },
  { price_date: "2025-12-22", nav: "1.1420", cumulative_nav: "1.1420", cum_nav_withdrawal: "1.1420", price_change: "" },
  { price_date: "2025-12-23", nav: "1.1520", cumulative_nav: "1.1520", cum_nav_withdrawal: "1.1520", price_change: "" },
  { price_date: "2025-12-24", nav: "1.1610", cumulative_nav: "1.1610", cum_nav_withdrawal: "1.1610", price_change: "" },
  { price_date: "2025-12-25", nav: "1.1717", cumulative_nav: "1.1717", cum_nav_withdrawal: "1.1717", price_change: "" },
  { price_date: "2025-12-26", nav: "1.2020", cumulative_nav: "1.2020", cum_nav_withdrawal: "1.2020", price_change: "" },
]
const managedOut = mergeLegacyWithTeamNav(sparseDecLegacy, fullTeamDec)
const managed1226 = managedOut.find((r) => r.price_date === "2025-12-26")
assert("managed merge 1226 pct ~2.59%", Math.abs(parseFloat(managed1226.price_change) - 2.59) < 0.01)
assert("managed merge has 1225", managedOut.some((r) => r.price_date === "2025-12-25"))

// Seed backfill + sparse team: history before team start is preserved
const sparseTeam = [
  { price_date: "2026-01-16", nav: "1.2687", cumulative_nav: "1.2687", cum_nav_withdrawal: "1.2687", price_change: "" },
  { price_date: "2026-01-23", nav: "1.2803", cumulative_nav: "1.2803", cum_nav_withdrawal: "1.2803", price_change: "" },
]
const seedHistory = [
  { price_date: "2025-12-25", nav: "1.1717", cumulative_nav: "1.1717", cum_nav_withdrawal: "1.1717", price_change: "" },
  { price_date: "2025-12-26", nav: "1.2020", cumulative_nav: "1.2020", cum_nav_withdrawal: "1.2020", price_change: "" },
  { price_date: "2026-01-15", nav: "1.2600", cumulative_nav: "1.2600", cum_nav_withdrawal: "1.2600", price_change: "" },
]
const withSeed = mergeLegacyWithTeamNav(
  mergeLegacyWithTeamNav([], seedHistory),
  sparseTeam,
)
assert("seed+team first date 2025-12-25", withSeed[0]?.price_date === "2025-12-25")
assert("seed+team 1226 pct ~2.59%", Math.abs(parseFloat(withSeed.find((r) => r.price_date === "2025-12-26").price_change) - 2.59) < 0.01)

// attachment column detection from user excel
const excelPath = process.env.NAV_TEST_XLSX ?? "c:/Users/13904/Downloads/荣熙恒盈2号净值20260624.xlsx"
if (fs.existsSync(excelPath)) {
  const buf = fs.readFileSync(excelPath)
  const analysis = analyzeNavWorkbook(buf, "ref.xlsx")
  assert("detects 复权 column", analysis.detectedColumns.adjustedNav != null)
  const sample = analysis.rows.find((r) => r.date === "2026-06-22")
  console.log("excel row", sample)
  assert("excel adj ~1.4814", Math.abs(sample.adjustedNav - 1.4814) < 0.001)

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
}
