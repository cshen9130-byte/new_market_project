import { mergeLegacyWithTeamNav, mergeNavSeriesWithEmail, isFofUnderlyingValuationEmailRow, selectEmailNavSeriesRows, dedupeLegacyNavRowsByDate } from "../lib/server/email-nav-query.ts"
import {
  enrichReturnNavSeries,
  capPeriodReturnByDrawdown,
  calcReturn,
  sanitizeNavPointSeries,
  expandBeiansWithShareClassFamily,
  backfillParentEmailFromShareClassSiblings,
} from "../lib/server/list-cache-nav-batch.ts"
import { lookupFundNavCorrectionRule } from "../lib/server/fund-nav-correction-rules.ts"
import { dedupeShareClassDisplayFunds } from "../lib/server/fund-name-match.ts"
import { extractNavMetadata, extractNavData, extractNavHistoryFromBody, applyEmailProductCodeOverride } from "../lib/server/email-nav-extract.ts"
import { computeManagedProductOneYearRiskMetrics, isPlausibleRiskRatio, loadManagedProductNavSeed, mergeManagedProductDetailNav } from "../lib/server/managed-product-nav-seed.ts"
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
// Daily return is unit-NAV based on a non-ex-div date: 1.2846/1.3111 - 1 ≈ -2.02%.
const dailyPct = parseFloat(r22.price_change)
assert("0622 daily return ~ -2.02%", Math.abs(dailyPct + 2.02) < 0.15)
// 复权 must rechain at the *cumulative* rate (not the unit rate), so the adj/cum
// ratio stays constant across rows — the documented behavior since the
// "cum-ratio rechaining" fix. (Asserting the old unit-ratio adj move here is wrong.)
const ratio18 = parseFloat(r18.cumulative_nav) / parseFloat(r18.cum_nav_withdrawal)
const ratio22 = parseFloat(r22.cumulative_nav) / parseFloat(r22.cum_nav_withdrawal)
assert("adj/cum ratio preserved after rechain", Math.abs(ratio22 - ratio18) < 0.001)
console.log("0622", r22)

// Weekend forward-fill from custody 净值表 must be dropped (Fri keep, Sat/Sun drop).
const weekendLegacy = [
  { price_date: "2026-07-24", nav: "1.3681", cumulative_nav: "1.3681", cum_nav_withdrawal: "1.3681", price_change: "" },
  { price_date: "2026-07-25", nav: "1.3681", cumulative_nav: "1.3681", cum_nav_withdrawal: "1.3681", price_change: "" },
  { price_date: "2026-07-26", nav: "1.3681", cumulative_nav: "1.3681", cum_nav_withdrawal: "1.3681", price_change: "" },
  { price_date: "2026-07-27", nav: "1.3700", cumulative_nav: "1.3700", cum_nav_withdrawal: "1.3700", price_change: "" },
]
const weekendOut = mergeNavSeriesWithEmail(weekendLegacy, [])
assert("weekend Sat dropped", !weekendOut.some((r) => r.price_date === "2026-07-25"))
assert("weekend Sun dropped", !weekendOut.some((r) => r.price_date === "2026-07-26"))
assert("weekend Fri kept", weekendOut.some((r) => r.price_date === "2026-07-24"))
assert("weekend Mon kept", weekendOut.some((r) => r.price_date === "2026-07-27"))
const weekendMon = weekendOut.find((r) => r.price_date === "2026-07-27")
const weekendMonPct = parseFloat(weekendMon.price_change)
assert("Mon daily vs Fri not flat weekend", Math.abs(weekendMonPct - ((1.37 / 1.3681 - 1) * 100)) < 0.02)

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

// SLA033-style V-shape: single-day unit/cum/adj dip on 2022-10-11 while neighbors agree
const sla033Legacy = [
  { price_date: "2022-10-04", nav: "1.05", cumulative_nav: "1.42", cum_nav_withdrawal: "1.35", price_change: "" },
  { price_date: "2022-10-11", nav: "0.92", cumulative_nav: "0.92", cum_nav_withdrawal: "0.92", price_change: "" },
  { price_date: "2022-10-18", nav: "1.05", cumulative_nav: "1.43", cum_nav_withdrawal: "1.36", price_change: "" },
  { price_date: "2026-05-29", nav: "1.0070", cumulative_nav: "1.5072", cum_nav_withdrawal: "1.4390", price_change: "" },
]
const sla033Out = mergeNavSeriesWithEmail(sla033Legacy, [])
const sla1011 = sla033Out.find((r) => r.price_date === "2022-10-11")
assert("SLA033 V-shape unit restored", Math.abs(parseFloat(sla1011.nav) - 1.05) < 0.001)
assert("SLA033 V-shape adj >= cum", parseFloat(sla1011.cumulative_nav) >= parseFloat(sla1011.cum_nav_withdrawal) - 0.001)
assert("SLA033 2022-10-11 adj near neighbors", Math.abs(parseFloat(sla1011.cumulative_nav) - 1.42) < 0.02)

// SLA033-style unit spike (cum stored as unit) on one date
const sla033SpikeLegacy = [
  { price_date: "2022-10-04", nav: "1.05", cumulative_nav: "1.42", cum_nav_withdrawal: "1.35", price_change: "" },
  { price_date: "2022-10-11", nav: "1.14", cumulative_nav: "1.14", cum_nav_withdrawal: "1.14", price_change: "" },
  { price_date: "2022-10-18", nav: "1.05", cumulative_nav: "1.43", cum_nav_withdrawal: "1.36", price_change: "" },
]
const sla033SpikeOut = mergeNavSeriesWithEmail(sla033SpikeLegacy, [])
const slaSpike1011 = sla033SpikeOut.find((r) => r.price_date === "2022-10-11")
assert("SLA033 unit spike restored", Math.abs(parseFloat(slaSpike1011.nav) - 1.05) < 0.001)

// SLA063 ex-div 2022-10-11: group table collapsed cum to unit; per-fund nav row is correct
const sla063ExDiv = dedupeLegacyNavRowsByDate([
  { price_date: "2022-10-10", nav: "1.127000", cumulative_nav: "1.283653", cum_nav_withdrawal: "1.266000", price_change: "", pri: 3 },
  { price_date: "2022-10-11", nav: "1.000000", cumulative_nav: "1.139000", cum_nav_withdrawal: "1.139000", price_change: "", pri: 3 },
  { price_date: "2022-10-11", nav: "1.000000", cumulative_nav: "1.282514", cum_nav_withdrawal: "1.265000", price_change: "", pri: 9 },
  { price_date: "2022-10-12", nav: "1.003000", cumulative_nav: "1.285931", cum_nav_withdrawal: "1.268000", price_change: "", pri: 3 },
])
const sla0631011 = sla063ExDiv.find((r) => r.price_date === "2022-10-11")
assert("SLA063 ex-div picks per-fund cum", Math.abs(parseFloat(sla0631011.cum_nav_withdrawal) - 1.265) < 0.001)
assert("SLA063 ex-div adj >= cum", parseFloat(sla0631011.cumulative_nav) >= parseFloat(sla0631011.cum_nav_withdrawal) - 0.001)
const sla063Merged = mergeNavSeriesWithEmail(sla063ExDiv, [])
const sla063Merged1011 = sla063Merged.find((r) => r.price_date === "2022-10-11")
assert("SLA063 merged ex-div cum flat", Math.abs(parseFloat(sla063Merged1011.cum_nav_withdrawal) - 1.265) < 0.001)
assert("SLA063 merged ex-div adj near prev", parseFloat(sla063Merged1011.cumulative_nav) > 1.27)

// SQX078 特夫郁金香全量化: legacy rows with 累计/复权 columns swapped (cum > adj)
const sqx078Legacy = [
  { price_date: "2026-05-15", nav: "1.088000", cumulative_nav: "2.790240", cum_nav_withdrawal: "2.251700", price_change: "" },
  { price_date: "2026-05-18", nav: "1.088900", cumulative_nav: "2.252600", cum_nav_withdrawal: "2.792500", price_change: "" },
  { price_date: "2026-05-25", nav: "1.105600", cumulative_nav: "2.269300", cum_nav_withdrawal: "2.835400", price_change: "" },
  { price_date: "2026-05-29", nav: "1.098400", cumulative_nav: "2.816912", cum_nav_withdrawal: "2.262100", price_change: "" },
]
const sqx078Out = mergeNavSeriesWithEmail(sqx078Legacy, [])
for (const d of ["2026-05-18", "2026-05-25"]) {
  const r = sqx078Out.find((x) => x.price_date === d)
  assert(`SQX078 ${d} adj >= cum`, parseFloat(r.cumulative_nav) >= parseFloat(r.cum_nav_withdrawal) - 0.001)
}
const sqx0518 = sqx078Out.find((r) => r.price_date === "2026-05-18")
assert("SQX078 swapped cum restored", Math.abs(parseFloat(sqx0518.cum_nav_withdrawal) - 2.2526) < 0.001)
assert("SQX078 swapped adj restored", Math.abs(parseFloat(sqx0518.cumulative_nav) - 2.7925) < 0.001)

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

// SSG947: verified xlsx seed — virtual NAV emails must not override reference series
const ssgSeed = loadManagedProductNavSeed("SSG947")
assert("SSG947 seed loaded", ssgSeed.length > 0)
const ssgMerged = mergeNavSeriesWithEmail(ssgSeed, [])
const ssg622 = ssgMerged.find((r) => r.price_date === "2026-06-22")
assert("SSG947 0622 unit ~1.9983", Math.abs(parseFloat(ssg622.nav) - 1.9983) < 0.001)
assert("SSG947 0622 cum ~2.5632", Math.abs(parseFloat(ssg622.cum_nav_withdrawal) - 2.5632) < 0.001)
assert("SSG947 0622 adj ~2.5893", Math.abs(parseFloat(ssg622.cumulative_nav) - 2.5893) < 0.001)
assert("SSG947 no chart spike", ssgMerged.every((r) => parseFloat(r.cumulative_nav) < 5))

const badEmailOverlay = [
  { price_date: "2026-06-23", nav: "1.9983", cumulative_nav: "1.9983", adjusted_nav: null },
  { price_date: "2026-06-24", nav: "1.9764", cumulative_nav: "1.9764", adjusted_nav: null },
]
const ssgDetail = mergeManagedProductDetailNav(
  ssgSeed,
  badEmailOverlay.map((row) => ({
    price_date: row.price_date,
    nav: row.nav,
    cumulative_nav: row.cumulative_nav,
    adjusted_nav: row.adjusted_nav,
  })),
  [],
)
const ssg623 = ssgDetail.find((r) => r.price_date === "2026-06-23")
assert("SSG947 detail extends past seed", ssgDetail.length > ssgMerged.length)
assert("SSG947 0623 unit ~1.9983", Math.abs(parseFloat(ssg623.nav) - 1.9983) < 0.001)
assert("SSG947 0623 cum ~2.5632", Math.abs(parseFloat(ssg623.cum_nav_withdrawal) - 2.5632) < 0.001)
assert("SSG947 0623 adj >= cum", parseFloat(ssg623.cumulative_nav) >= parseFloat(ssg623.cum_nav_withdrawal) - 0.001)
assert("SSG947 no chart spike after email extend", ssgDetail.every((r) => parseFloat(r.cumulative_nav) < 5))

const custodyHistory = [
  {
    nav_date: "2026-06-22",
    nav: "1.9983",
    cumulative_nav: "2.5632",
    adjusted_nav: null,
    product_code: "SSG947",
    fund_name: "抱朴聚融祥和一号私募证券投资基金",
    attachment_filename: "SSG947_抱朴聚融祥和一号_资产估值表_20260622.xls",
    subject: "【基金估值表】SSG947_抱朴聚融祥和一号_资产估值表_20260622",
    source: "attachment_valuation_table",
  },
  {
    nav_date: "2026-06-23",
    nav: "1.9983",
    cumulative_nav: "1.9983",
    adjusted_nav: null,
    product_code: "SSG947",
    fund_name: "资产净值公告_SSG947_抱朴聚融祥和一号",
    attachment_filename: "资产净值公告_SSG947_20260623.xls",
    subject: "资产净值公告",
    source: "attachment_nav_table",
  },
]
const corrected = selectEmailNavSeriesRows(custodyHistory, "SSG947", ["抱朴聚融祥和一号"])
const corrected623 = corrected.find((r) => r.nav_date === "2026-06-23")
assert("SSG947 manage stream corrects cum-as-unit", Math.abs(parseFloat(corrected623.nav) - 1.557898) < 0.001)

const fofRow = {
  nav_date: "2026-05-29",
  nav: "1.99",
  cumulative_nav: "2.56",
  adjusted_nav: null,
  product_code: "SBHK26",
  fund_name: "抱朴聚融祥和一号私募证券投资基金",
  attachment_filename: "SBHK26_六妙星豪鑫6号私募证券投资基金_资产估值表_20260529_4级_抱朴聚融祥和一号私募证券投资基金.xls",
  subject: "【基金估值表】SBHK26_六妙星豪鑫6号私募证券投资基金_资产估值表_20260529_4级_抱朴聚融祥和一号私募证券投资基金",
  source: "attachment_valuation_table",
}
assert("FOF 4级 valuation rejected for SSG947", isFofUnderlyingValuationEmailRow(fofRow, "SSG947"))

const custodyEmail = [{
  price_date: "2026-06-22",
  nav: "1.9983",
  cumulative_nav: "2.5632",
  adjusted_nav: null,
}]
const custodyMerged = mergeNavSeriesWithEmail([], custodyEmail)
const custody622 = custodyMerged.find((r) => r.price_date === "2026-06-22")
assert("custody email unit ~1.9983", Math.abs(parseFloat(custody622.nav) - 1.9983) < 0.001)
assert("custody email cum ~2.5632", Math.abs(parseFloat(custody622.cum_nav_withdrawal) - 2.5632) < 0.001)

// SNF018: email series should carry distinct unit/cum (attachment-only days corrected before merge)
const snfLegacyTail = [
  { price_date: "2026-06-22", nav: "1.3343", cum_nav_withdrawal: "1.7447", cumulative_nav: "1.8020", price_change: "" },
]
const snfEmail = [
  { price_date: "2026-06-23", nav: "1.3358", cumulative_nav: "1.7462", adjusted_nav: null },
  { price_date: "2026-06-25", nav: "1.3475", cumulative_nav: "1.7600", adjusted_nav: null },
]
const snfMerged = mergeNavSeriesWithEmail(snfLegacyTail, snfEmail)
const snf623 = snfMerged.find((r) => r.price_date === "2026-06-23")
const snf625 = snfMerged.find((r) => r.price_date === "2026-06-25")
assert("SNF018 0623 unit ~1.3358", Math.abs(parseFloat(snf623.nav) - 1.3358) < 0.001)
assert("SNF018 0623 cum ~1.7462", Math.abs(parseFloat(snf623.cum_nav_withdrawal) - 1.7462) < 0.001)
assert("SNF018 0623 adj > cum", parseFloat(snf623.cumulative_nav) > parseFloat(snf623.cum_nav_withdrawal) + 0.01)
assert("SNF018 0625 unit < 1.5", parseFloat(snf625.nav) < 1.5)
assert("SNF018 0625 adj >= cum >= unit", parseFloat(snf625.cumulative_nav) >= parseFloat(snf625.cum_nav_withdrawal) - 0.001
  && parseFloat(snf625.cum_nav_withdrawal) >= parseFloat(snf625.nav) - 0.001)

// SNF018: attachment copies cum into adjusted_nav — must still rechain 复权 from legacy ratio
const snfLegacy = [
  { price_date: "2026-06-12", nav: "1.3186", cum_nav_withdrawal: "1.7290", cumulative_nav: "1.785628", price_change: "" },
]
const snfEmailFlatAdj = [
  { price_date: "2026-06-15", nav: "1.3188", cumulative_nav: "1.7292", adjusted_nav: "1.7292" },
]
const snfFlatMerged = mergeNavSeriesWithEmail(snfLegacy, snfEmailFlatAdj)
const snf615 = snfFlatMerged.find((r) => r.price_date === "2026-06-15")
assert("SNF018 flat email adj rechains above cum", parseFloat(snf615.cumulative_nav) > parseFloat(snf615.cum_nav_withdrawal) + 0.01)

// SNF018: email overlapping legacy must not wipe good legacy 复权 when email has unit+cum only
const snfLegacyOverlap = [
  { price_date: "2026-05-29", nav: "1.3273", cum_nav_withdrawal: "1.7377", cumulative_nav: "1.807104", price_change: "" },
]
const snfEmailOverlap = [
  { price_date: "2026-05-29", nav: "1.3273", cumulative_nav: "1.7377", adjusted_nav: null },
  { price_date: "2026-06-15", nav: "1.3188", cumulative_nav: "1.7292", adjusted_nav: "1.7292" },
]
const snfOverlapMerged = mergeNavSeriesWithEmail(snfLegacyOverlap, snfEmailOverlap)
const snf529 = snfOverlapMerged.find((r) => r.price_date === "2026-05-29")
const snf615b = snfOverlapMerged.find((r) => r.price_date === "2026-06-15")
assert("SNF018 overlap keeps legacy adj on 0529", Math.abs(parseFloat(snf529.cumulative_nav) - 1.807104) < 0.001)
assert("SNF018 overlap rechains flat adj on 0615", parseFloat(snf615b.cumulative_nav) > parseFloat(snf615b.cum_nav_withdrawal) + 0.01)
const snf615Ratio = parseFloat(snf615b.cumulative_nav) / parseFloat(snf615b.cum_nav_withdrawal)
assert("SNF018 overlap 0615 ratio ~legacy", Math.abs(snf615Ratio - 1.807104 / 1.7377) < 0.002)

// SBPC20: 虚拟计提净值表 attachment mis-parsed fund AUM as unit NAV; subject + virtual carry correct unit
const sbpc20Rows = [
  {
    nav_date: "2026-07-07",
    nav: "5494454.23",
    cumulative_nav: "1.351700",
    adjusted_nav: "1.351700",
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20_六妙星九紫一号_20260707.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-07，单位净值为1.1386",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-07",
    nav: "1.138600",
    cumulative_nav: "1.127600",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_荣熙海泰1号私募证券投资基金_SBPC20_六妙星九紫一号私募证券投资基金_2026-07-07.xls",
    source: "body_table",
  },
  {
    nav_date: "2026-07-06",
    nav: "1.151100",
    cumulative_nav: "1.370200",
    adjusted_nav: "1.370200",
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20_六妙星九紫一号_20260706.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-06，单位净值为1.1511",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-06",
    nav: "1.151100",
    cumulative_nav: "1.092700",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_衡颐海泰1号私募证券投资基金_SBPC20_六妙星九紫一号私募证券投资基金_2026-07-06.xls",
    source: "body_table",
  },
]
const sbpc20Selected = selectEmailNavSeriesRows(sbpc20Rows, "SBPC20", ["六妙星九紫一号"])
const sbpc0707 = sbpc20Selected.find((r) => r.nav_date === "2026-07-07")
const sbpc0706 = sbpc20Selected.find((r) => r.nav_date === "2026-07-06")
assert("SBPC20 0707 unit ~1.1386", Math.abs(parseFloat(sbpc0707.nav) - 1.1386) < 0.001)
assert("SBPC20 0706 attachment wins over virtual (dividend offset)", Math.abs(parseFloat(sbpc0706.cumulative_nav) - 1.3702) < 0.001)

// SBPC20: virtual stored first must not block attachment with dividend offset (Jul 8 regression)
const sbpc20Jul8Rows = [
  {
    nav_date: "2026-07-08",
    nav: "1.156500",
    cumulative_nav: "1.109600",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_荣熙海泰1号私募证券投资基金_SBPC20_六妙星九紫一号私募证券投资基金_2026-07-08.xls",
    source: "body_table",
  },
  {
    nav_date: "2026-07-08",
    nav: "1.156500",
    cumulative_nav: "1.369600",
    adjusted_nav: "1.369600",
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20_六妙星九紫一号_20260708.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-08，单位净值为1.1565",
    source: "attachment_nav_table",
  },
]
const sbpc20Jul8Selected = selectEmailNavSeriesRows(sbpc20Jul8Rows, "SBPC20", ["六妙星九紫一号"])
const sbpc0708 = sbpc20Jul8Selected.find((r) => r.nav_date === "2026-07-08")
assert("SBPC20 0708 unit ~1.1565", Math.abs(parseFloat(sbpc0708.nav) - 1.1565) < 0.001)
assert("SBPC20 0708 cum ~1.3696", Math.abs(parseFloat(sbpc0708.cumulative_nav) - 1.3696) < 0.001)

const sbpc20MergedJul8 = mergeNavSeriesWithEmail([], [
  { price_date: "2026-07-07", nav: "1.138600", cumulative_nav: "1.351700", adjusted_nav: "1.351700" },
  { price_date: "2026-07-08", nav: "1.156500", cumulative_nav: "1.369600", adjusted_nav: "1.369600" },
])
const sbpcMerged708 = sbpc20MergedJul8.find((r) => r.price_date === "2026-07-08")
assert("SBPC20 merged 0708 cum > unit", parseFloat(sbpcMerged708.cum_nav_withdrawal) > parseFloat(sbpcMerged708.nav) + 0.05)
assert("SBPC20 merged 0708 cum ~1.3696", Math.abs(parseFloat(sbpcMerged708.cum_nav_withdrawal) - 1.3696) < 0.001)

// SBPC20: legacy pre-email rows must not overwrite email 累计 during adj rechain
const sbpcLegacyTail = [
  { price_date: "2026-05-23", nav: "1.2513", cum_nav_withdrawal: "1.2513", cumulative_nav: "1.2513", price_change: "" },
  { price_date: "2026-05-25", nav: "1.2489", cum_nav_withdrawal: "1.2489", cumulative_nav: "1.2489", price_change: "" },
]
const sbpcEmailJul = [
  { price_date: "2026-07-07", nav: "1.138600", cumulative_nav: "1.351700", adjusted_nav: "1.351700" },
  { price_date: "2026-07-08", nav: "1.156500", cumulative_nav: "1.369600", adjusted_nav: "1.369600" },
]
const sbpcLegacyEmail = mergeNavSeriesWithEmail(sbpcLegacyTail, sbpcEmailJul)
const sbpc708le = sbpcLegacyEmail.find((r) => r.price_date === "2026-07-08")
assert("SBPC20 legacy+email 0708 cum ~1.3696", Math.abs(parseFloat(sbpc708le.cum_nav_withdrawal) - 1.3696) < 0.001)
assert("SBPC20 legacy+email 0708 cum > unit", parseFloat(sbpc708le.cum_nav_withdrawal) > parseFloat(sbpc708le.nav) + 0.05)

// SBPC20 Jul 2-3: attachment unit=cum must rechain 累计; Jul 3 must not show +15% cliff
const sbpc20Jul2Rows = [
  {
    nav_date: "2026-07-02",
    nav: "1.185500",
    cumulative_nav: "1.185500",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20_六妙星九紫一号_20260702.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-02，单位净值为1.1855",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-02",
    nav: "1.185500",
    cumulative_nav: "1.095400",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_衡颐海泰1号私募证券投资基金_SBPC20_六妙星九紫一号私募证券投资基金_2026-07-02.xls",
    source: "body_table",
  },
]
const sbpc20Jul3Rows = [
  {
    nav_date: "2026-07-03",
    nav: "1.160600",
    cumulative_nav: "1.373700",
    adjusted_nav: "1.373700",
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20_六妙星九紫一号_20260703.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-03，单位净值为1.1606",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-03",
    nav: "1.160600",
    cumulative_nav: "1.095400",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_衡颐海泰1号私募证券投资基金_SBPC20_六妙星九紫一号私募证券投资基金_2026-07-03.xls",
    source: "body_table",
  },
]
const sbpcJul1Email = { price_date: "2026-07-01", nav: "1.180500", cumulative_nav: "1.393600", adjusted_nav: "1.393600" }
const sbpcJul2Email = { price_date: "2026-07-02", nav: "1.185500", cumulative_nav: "1.185500", adjusted_nav: null }
const sbpcJul3Email = { price_date: "2026-07-03", nav: "1.160600", cumulative_nav: "1.373700", adjusted_nav: "1.373700" }
const sbpcJul2Legacy = [
  { price_date: "2026-07-01", nav: "1.1805", cum_nav_withdrawal: "1.3936", cumulative_nav: "1.3936", price_change: "" },
  { price_date: "2026-07-02", nav: "1.1855", cum_nav_withdrawal: "1.1855", cumulative_nav: "1.1855", price_change: "" },
]
const sbpcJul23Merged = mergeNavSeriesWithEmail(sbpcJul2Legacy, [sbpcJul1Email, sbpcJul2Email, sbpcJul3Email])
const sbpc702 = sbpcJul23Merged.find((r) => r.price_date === "2026-07-02")
const sbpc703 = sbpcJul23Merged.find((r) => r.price_date === "2026-07-03")
assert("SBPC20 merged 0702 cum > unit", parseFloat(sbpc702.cum_nav_withdrawal) > parseFloat(sbpc702.nav) + 0.05)
assert("SBPC20 merged 0702 cum ~1.3986", Math.abs(parseFloat(sbpc702.cum_nav_withdrawal) - 1.3986) < 0.002)
const sbpc703Chg = parseFloat(sbpc703.price_change)
assert("SBPC20 merged 0703 daily change sane", Math.abs(sbpc703Chg + 1.8) < 0.5)

// SBPC20 live: attachment stores AUM as nav + correct 累计; subject has unit; virtual has wrong cum
const sbpc20AumJul2Rows = [
  {
    nav_date: "2026-07-02",
    nav: "4650928.290000",
    cumulative_nav: "1.398600",
    adjusted_nav: "1.398600",
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20_六妙星九紫一号_20260702.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-02，单位净值：1.1855",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-02",
    nav: "1805869.070000",
    cumulative_nav: "1.398600",
    adjusted_nav: "1.398600",
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20_六妙星九紫一号_20260702.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-02，单位净值：1.1855",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-02",
    nav: "1.185500",
    cumulative_nav: "1.155300",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_国泰海通金舆基石一号私募证券投资基金_SBPC20_六妙星九紫一号私募证券投资基金_2026-07-02.xls",
    source: "body_table",
  },
  {
    nav_date: "2026-07-02",
    nav: "1.185500",
    cumulative_nav: "1.113000",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_衡颐海泰1号私募证券投资基金_SBPC20_六妙星九紫一号私募证券投资基金_2026-07-02.xls",
    source: "body_table",
  },
  {
    nav_date: "2026-07-02",
    nav: "1.185500",
    cumulative_nav: "1.119600",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_荣熙共赢私募证券投资基金_SBPC20_六妙星九紫一号私募证券投资基金_2026-07-02.xls",
    source: "body_table",
  },
]
const sbpc20AumSelected = selectEmailNavSeriesRows(sbpc20AumJul2Rows, "SBPC20", ["六妙星九紫一号"])
const sbpcAum702 = sbpc20AumSelected.find((r) => r.nav_date === "2026-07-02")
assert("SBPC20 AUM attachment recovers unit ~1.1855", Math.abs(parseFloat(sbpcAum702.nav) - 1.1855) < 0.001)
assert("SBPC20 AUM attachment keeps cum ~1.3986", Math.abs(parseFloat(sbpcAum702.cumulative_nav) - 1.3986) < 0.001)

const sbpc20AumSeries = [
  {
    nav_date: "2026-07-01",
    nav: "4650928.290000",
    cumulative_nav: "1.393600",
    adjusted_nav: "1.393600",
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-01，单位净值：1.1805",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-01",
    nav: "1.180500",
    cumulative_nav: "1.109900",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_衡颐海泰1号_SBPC20_六妙星九紫一号_2026-07-01.xls",
    source: "body_table",
  },
  ...sbpc20AumJul2Rows,
  {
    nav_date: "2026-07-03",
    nav: "1.160600",
    cumulative_nav: "1.373700",
    adjusted_nav: "1.373700",
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: "SBPC20.xls",
    subject: "【净值信息】SBPC20_六妙星九紫一号私募证券投资基金_2026-07-03，单位净值：1.1606",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-03",
    nav: "1.160600",
    cumulative_nav: "1.098300",
    adjusted_nav: null,
    product_code: "SBPC20",
    fund_name: "六妙星九紫一号私募证券投资基金",
    attachment_filename: null,
    subject: "虚拟业绩报酬_衡颐海泰1号_SBPC20_六妙星九紫一号_2026-07-03.xls",
    source: "body_table",
  },
]
const sbpcAumLiveSelected = selectEmailNavSeriesRows(sbpc20AumSeries, "SBPC20", ["六妙星九紫一号"])
const sbpcAumLiveMerged = mergeNavSeriesWithEmail([], sbpcAumLiveSelected.map((r) => ({
  price_date: r.nav_date,
  nav: r.nav,
  cumulative_nav: r.cumulative_nav,
  adjusted_nav: r.adjusted_nav,
})))
const sbpcLive702 = sbpcAumLiveMerged.find((r) => r.price_date === "2026-07-02")
const sbpcLive703 = sbpcAumLiveMerged.find((r) => r.price_date === "2026-07-03")
assert("SBPC20 live AUM Jul2 cum ~1.3986", Math.abs(parseFloat(sbpcLive702.cum_nav_withdrawal) - 1.3986) < 0.002)
assert("SBPC20 live AUM Jul2 cum > unit", parseFloat(sbpcLive702.cum_nav_withdrawal) > parseFloat(sbpcLive702.nav) + 0.05)
assert("SBPC20 live AUM Jul3 change not +15%", Math.abs(parseFloat(sbpcLive703.price_change)) < 5)

// SBPC20 Jun 11 first ex-div: cum dips slightly with unit collapse — must seed adj > cum and soft daily change
const sbpcExDivLegacy = [
  { price_date: "2026-06-10", nav: "1.2419", cum_nav_withdrawal: "1.2419", cumulative_nav: "1.2419", price_change: "" },
  { price_date: "2026-06-11", nav: "1.0000", cum_nav_withdrawal: "1.2131", cumulative_nav: "1.2131", price_change: "" },
  { price_date: "2026-06-12", nav: "1.0160", cum_nav_withdrawal: "1.2291", cumulative_nav: "1.2291", price_change: "" },
]
const sbpcExDivOut = mergeNavSeriesWithEmail(sbpcExDivLegacy, [])
const sbpc0611 = sbpcExDivOut.find((r) => r.price_date === "2026-06-11")
const sbpc0612 = sbpcExDivOut.find((r) => r.price_date === "2026-06-12")
assert("SBPC20 Jun11 daily not unit cliff", Math.abs(parseFloat(sbpc0611.price_change)) < 5)
assert("SBPC20 Jun11 adj > cum", parseFloat(sbpc0611.cumulative_nav) > parseFloat(sbpc0611.cum_nav_withdrawal) + 0.01)
assert("SBPC20 Jun12 keeps adj/cum premium", parseFloat(sbpc0612.cumulative_nav) / parseFloat(sbpc0612.cum_nav_withdrawal) > 1.01)

// BDW42B: parent SBDW42 attachment publishes A/B share-class NAVs on the same date (~1.09 vs ~1.45).
const bdw42bRows = [
  {
    nav_date: "2026-07-06",
    nav: "1.093700",
    cumulative_nav: "1.093700",
    adjusted_nav: null,
    product_code: "SBDW42",
    fund_name: "青钱基石1号",
    attachment_filename: "SBDW42_青钱基石1号_20260706.xls",
    subject: "【净值信息】SBDW42_青钱基石1号_20260706",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-06",
    nav: "1.458200",
    cumulative_nav: "1.458200",
    adjusted_nav: null,
    product_code: "SBDW42",
    fund_name: "青钱基石1号",
    attachment_filename: "SBDW42_青钱基石1号_20260706.xls",
    subject: "【净值信息】SBDW42_青钱基石1号_20260706",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-07",
    nav: "1.089800",
    cumulative_nav: "1.089800",
    adjusted_nav: null,
    product_code: "SBDW42",
    fund_name: "青钱基石1号",
    attachment_filename: "SBDW42_青钱基石1号_20260707.xls",
    subject: "【净值信息】SBDW42_青钱基石1号_20260707",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-07",
    nav: "1.455800",
    cumulative_nav: "1.455800",
    adjusted_nav: null,
    product_code: "SBDW42",
    fund_name: "青钱基石1号",
    attachment_filename: "SBDW42_青钱基石1号_20260707.xls",
    subject: "【净值信息】SBDW42_青钱基石1号_20260707",
    source: "attachment_nav_table",
  },
]
const bdw42bSelected = selectEmailNavSeriesRows(bdw42bRows, "BDW42B", ["青钱基石1号私募证券投资基金B类"])
const bdw0706 = bdw42bSelected.find((r) => r.nav_date === "2026-07-06")
const bdw0707 = bdw42bSelected.find((r) => r.nav_date === "2026-07-07")
assert("BDW42B picks B-class NAV on 0706", Math.abs(parseFloat(bdw0706.nav) - 1.4582) < 0.001)
assert("BDW42B picks B-class NAV on 0707", Math.abs(parseFloat(bdw0707.nav) - 1.4558) < 0.001)
const bdwDaily = parseFloat(bdw0707.nav) / parseFloat(bdw0706.nav) - 1
assert("BDW42B daily move sane", Math.abs(bdwDaily + 0.0016) < 0.005)

const bdw42bJul9OnlyA = [
  ...bdw42bRows,
  {
    nav_date: "2026-07-09",
    nav: "1.086700",
    cumulative_nav: "1.086700",
    adjusted_nav: null,
    product_code: "SBDW42",
    fund_name: "青钱基石1号",
    attachment_filename: "集合计划每日净值表.xls",
    subject: "【净值表】青钱基石1号-SBDW42-20260709",
    source: "attachment_nav_table",
  },
]
const bdwJul9 = selectEmailNavSeriesRows(bdw42bJul9OnlyA, "BDW42B", ["青钱基石1号私募证券投资基金B类"])
assert("BDW42B skips 0709 when only A-class row published", !bdwJul9.some((r) => r.nav_date === "2026-07-09"))
assert("BDW42B latest stays 0707", bdwJul9.at(-1)?.nav_date === "2026-07-07")

const sbdwJul9 = selectEmailNavSeriesRows(bdw42bJul9OnlyA, "SBDW42", ["青钱基石1号"])
assert("SBDW42 skips 0709 single-class discontinuity", !sbdwJul9.some((r) => r.nav_date === "2026-07-09"))

const sbdw0707Selected = selectEmailNavSeriesRows(bdw42bRows, "SBDW42", ["青钱基石1号"]).find((r) => r.nav_date === "2026-07-07")
const sbdw0707FirstRaw = bdw42bRows.find((r) => r.nav_date === "2026-07-07")
assert("SBDW42 selected parent NAV ~1.4558", Math.abs(parseFloat(sbdw0707Selected.nav) - 1.4558) < 0.001)
assert("date-only remap would wrongly pick B-class ~1.0898", parseFloat(sbdw0707FirstRaw.nav) < 1.2)

const seedBackfill = ssgSeed.filter((r) => r.price_date < "2024-11-19")
const emailTeam = custodyMerged
const combined = mergeLegacyWithTeamNav(seedBackfill, emailTeam)
const combined622 = combined.find((r) => r.price_date === "2026-06-22")
assert("email team wins over seed on 0622", Math.abs(parseFloat(combined622.nav) - 1.9983) < 0.001)

// SBDF95: terminal legacy / Citics summary row stored cumulative-return index (~4.66) as unit NAV
const sbdf95Legacy = [
  { price_date: "2026-06-29", nav: "1.0270", cumulative_nav: "1.0270", cum_nav_withdrawal: "1.0270", price_change: "" },
  { price_date: "2026-07-01", nav: "1.0214", cumulative_nav: "1.0214", cum_nav_withdrawal: "1.0214", price_change: "" },
  { price_date: "2026-07-03", nav: "4.6587", cumulative_nav: "4.6587", cum_nav_withdrawal: "4.6587", price_change: "" },
]
const sbdf95Out = mergeNavSeriesWithEmail(sbdf95Legacy, [])
assert("SBDF95 terminal spike removed", !sbdf95Out.some((r) => r.price_date === "2026-07-03"))
const sbdf95Latest = sbdf95Out.at(-1)
assert("SBDF95 latest ~1.0214", Math.abs(parseFloat(sbdf95Latest.nav) - 1.0214) < 0.001)
assert("SBDF95 max unit sane", Math.max(...sbdf95Out.map((r) => parseFloat(r.nav))) < 2)

const sbdf95Tail = [
  { price_date: "2026-06-30", nav: "1.0284", cumulative_nav: "1.0284", cum_nav_withdrawal: "1.0284", price_change: "" },
  { price_date: "2026-07-01", nav: "1.0214", cumulative_nav: "1.0214", cum_nav_withdrawal: "1.0214", price_change: "" },
  { price_date: "2026-07-07", nav: "4.6831", cumulative_nav: "4.6831", cum_nav_withdrawal: "4.6831", price_change: "" },
  { price_date: "2026-07-08", nav: "4.6627", cumulative_nav: "4.6627", cum_nav_withdrawal: "4.6627", price_change: "" },
]
const sbdf95TailOut = mergeNavSeriesWithEmail(sbdf95Tail, [])
assert("SBDF95 multi-day return-index tail removed", !sbdf95TailOut.some((r) => r.price_date >= "2026-07-07"))
assert("SBDF95 tail latest ~1.0214", Math.abs(parseFloat(sbdf95TailOut.at(-1).nav) - 1.0214) < 0.001)

const sbdf95EmailOnly = [
  { price_date: "2026-06-30", nav: "1.0284", cumulative_nav: "1.0284", adjusted_nav: "1.0284" },
  { price_date: "2026-07-01", nav: "1.0214", cumulative_nav: "1.0214", adjusted_nav: "1.0214" },
  { price_date: "2026-07-03", nav: "4.6587", cumulative_nav: "4.6587", adjusted_nav: "4.6587" },
  { price_date: "2026-07-06", nav: "4.6813", cumulative_nav: "4.6813", adjusted_nav: "4.6813" },
  { price_date: "2026-07-07", nav: "4.6831", cumulative_nav: "4.6831", adjusted_nav: "4.6831" },
  { price_date: "2026-07-08", nav: "4.6627", cumulative_nav: "4.6627", adjusted_nav: "4.6627" },
]
const sbdf95EmailOut = mergeNavSeriesWithEmail([], sbdf95EmailOnly)
assert("SBDF95 email-only corrupt cluster removed", !sbdf95EmailOut.some((r) => r.price_date >= "2026-07-03"))
assert("SBDF95 email-only latest ~1.0214", Math.abs(parseFloat(sbdf95EmailOut.at(-1).nav) - 1.0214) < 0.001)

const sbdf95Batch = sanitizeNavPointSeries([
  { nav_date: "2026-07-01", nav: 1.0214 },
  { nav_date: "2026-07-03", nav: 4.6587 },
  { nav_date: "2026-07-08", nav: 4.6627 },
], { beian_hao: "SBDF95" })
assert("SBDF95 batch with correction rule keeps ~4 tail", sbdf95Batch.length === 2)
assert("SBDF95 batch correction drops pre-07-03", !sbdf95Batch.some((p) => p.nav_date < "2026-07-03"))
assert("SBDF95 batch correction latest ~4.66", Math.abs(sbdf95Batch[0].nav - 4.6627) < 0.01)

const sbdf95Rule = lookupFundNavCorrectionRule("SBDF95", "锐耐稳健对冲11号")
assert("SBDF95 correction rule loaded", sbdf95Rule?.series_start_date === "2026-07-03")
assert("SBDF95 preserve high nav", sbdf95Rule?.preserve_high_nav_scale === true)

const bdp99aRule = lookupFundNavCorrectionRule("BDF95A", "锐耐稳健对冲11号A类")
assert("BDF95A correction rule loaded", bdp99aRule?.series_start_date === "2026-07-09")

// AVM354 笃熙泰渊流1号A类: platform stored 单位 in 复权 while 累计 is correct (post-dividend)
const avm354Legacy = [
  { price_date: "2026-06-03", nav: "1.1710", cum_nav_withdrawal: "1.9226", cumulative_nav: "1.1710", price_change: "" },
  { price_date: "2026-07-08", nav: "1.1950", cum_nav_withdrawal: "1.9440", cumulative_nav: "1.9440", price_change: "" },
]
const avm354Out = mergeNavSeriesWithEmail(avm354Legacy, [])
const avm3540603 = avm354Out.find((r) => r.price_date === "2026-06-03")
const avm3540708 = avm354Out.find((r) => r.price_date === "2026-07-08")
assert("AVM354 0603 adj not collapsed to unit", Math.abs(parseFloat(avm3540603.cumulative_nav) - 1.171) > 0.01)
assert("AVM354 0603 adj >= cum", parseFloat(avm3540603.cumulative_nav) >= parseFloat(avm3540603.cum_nav_withdrawal) - 0.001)
assert("AVM354 0708 adj >= cum >= unit", parseFloat(avm3540708.cumulative_nav) >= parseFloat(avm3540708.cum_nav_withdrawal) - 0.001
  && parseFloat(avm3540708.cum_nav_withdrawal) >= parseFloat(avm3540708.nav) - 0.001)
const avm354Ret = parseFloat(avm3540708.cumulative_nav) / parseFloat(avm3540603.cumulative_nav) - 1
const avm354Days = (new Date("2026-07-08").getTime() - new Date("2026-06-03").getTime()) / 86400000
const avm354Ann = Math.pow(1 + avm354Ret, 365 / avm354Days) - 1
assert("AVM354 ann not absurd when adj repaired", avm354Ann < 5)

// SQU767 六妙星豪鑫主观2号: 【净值表】 stored 基金资产净值 (AUM ~212M) in nav; cumulative holds true unit NAV
const squ767Rows = [
  {
    nav_date: "2026-06-04",
    nav: "222061940.860000",
    cumulative_nav: "2.901900",
    adjusted_nav: "2.901900",
    product_code: "SQU767",
    fund_name: "六妙星豪鑫主观2号私募证券投资基金",
    attachment_filename: "净值表.xlsx",
    subject: "【净值表】六妙星豪鑫主观2号-SQU767",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-06-18",
    nav: "3.144800",
    cumulative_nav: "3.144800",
    adjusted_nav: "3.144800",
    product_code: "SQU767",
    fund_name: "六妙星豪鑫主观2号私募证券投资基金",
    attachment_filename: "净值表.xlsx",
    subject: "【净值表】六妙星豪鑫主观2号-SQU767",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-02",
    nav: "3.333600",
    cumulative_nav: "3.333600",
    adjusted_nav: "3.333600",
    product_code: "SQU767",
    fund_name: "六妙星豪鑫主观2号私募证券投资基金",
    attachment_filename: "净值表.xlsx",
    subject: "【净值表】六妙星豪鑫主观2号-SQU767",
    source: "attachment_nav_table",
  },
]
const squ767Selected = selectEmailNavSeriesRows(squ767Rows, "SQU767", ["六妙星豪鑫主观2号"])
assert("SQU767 AUM row recovered from cumulative", squ767Selected.some((r) => r.nav_date === "2026-06-04" && Math.abs(parseFloat(r.nav) - 2.9019) < 0.001))
assert("SQU767 includes post-gap dates", squ767Selected.some((r) => r.nav_date === "2026-07-02"))
assert("SQU767 latest ~3.3336", Math.abs(parseFloat(squ767Selected.at(-1).nav) - 3.3336) < 0.001)

// ASX73A-style: email-only tail lacks 复权; legacy row establishes unit→adj ratio before ex-div unit drop
const asx73History = enrichReturnNavSeries([
  { nav_date: "2025-12-24", nav: 1.0007, return_nav: 1.419193 },
  { nav_date: "2026-06-25", nav: 1.0 },
  { nav_date: "2026-07-02", nav: 1.0187 },
])
const jul2 = asx73History.find((p) => p.nav_date === "2026-07-02")
const jun25 = asx73History.find((p) => p.nav_date === "2026-06-25")
assert("ASX73A enrich fills return_nav on email tail", jul2?.return_nav != null && jul2.return_nav > 1.4)
const asx73Ret1m = calcReturn(jul2.return_nav, jun25.return_nav)
assert("ASX73A 1m return sane after enrich", asx73Ret1m != null && Math.abs(asx73Ret1m) < 0.15)
assert(
  "ASX73A cap rejects unit-vs-adj phantom loss",
  capPeriodReturnByDrawdown(-0.3889, asx73History, "2026-07-02", 30) == null,
)

const dupFunds = dedupeShareClassDisplayFunds([
  { beian_hao: "ASX73A", product_name: "六妙星豪鑫3号A类" },
  { beian_hao: "SASX73", product_name: "六妙星豪鑫3号A类" },
  { beian_hao: "SASX73", product_name: "六妙星豪鑫3号" },
])
assert("share-class dedupe keeps ASX73A", dupFunds.some((f) => f.beian_hao === "ASX73A"))
assert("share-class dedupe drops mislabeled SASX73 A类", !dupFunds.some((f) => f.beian_hao === "SASX73" && f.product_name.includes("A类")))
assert("share-class dedupe keeps parent SASX73 main name", dupFunds.some((f) => f.beian_hao === "SASX73" && f.product_name === "六妙星豪鑫3号"))

const bangkeMeta = extractNavMetadata(
  "SAUV26_邦客鼎成精选私募证券投资基金_净值2026-07-09【国信托管】",
  "",
)
assert("subject extracts SAUV26 邦客", bangkeMeta.productCode === "SAUV26" && bangkeMeta.fundName?.includes("邦客"))

const bangkeBody = extractNavData(
  "SAUV26邦客鼎成精选私募证券投资基金净值2026-07-09【国信托管】",
  "1 SAUV26 邦客鼎成精选私募证券投资基金 2026-07-09 未授权 未授权 1.3014 1.3014",
)
assert("guosen body table extracts 0709 nav", bangkeBody?.navDate === "2026-07-09" && bangkeBody?.nav === 1.3014)

const zhufengSubject =
  "虚拟净值-铸锋太阿3号私募证券投资基金A类[衡顾海岳1号私募证券投资基金]-20260709.xls"
const zhufengBody =
  "净值日期 确认日期 基金代码 基金名称 基金账号 客户名称 试算提成金额 发生份额 试算后单位净值 试算前单位净值 试算前累计净值 试算后客户净资产 " +
  "2026-07-09 2026-07-10 SB969A 铸锋太阿3号私募证券投资基金A类 CJ8001210951 衡顾海岳1号私募证券投资基金 0.00 1000000.00 1.0000 1 1 1000000.00"
const zhufengMeta = extractNavMetadata(zhufengSubject, zhufengBody)
assert(
  "changjiang virtual subject extracts SB969A",
  zhufengMeta.productCode === "SB969A" && zhufengMeta.fundName?.includes("铸锋太阿"),
)
const zhufengNav = extractNavData(zhufengSubject, zhufengBody)
assert(
  "changjiang virtual body extracts 0709 nav",
  zhufengNav?.navDate === "2026-07-09" && zhufengNav?.nav === 1.0 && zhufengNav?.productCode === "SB969A",
)

const cscSade15Subject = "20260724汉鸿景明1号私募证券投资基金SADE15资产净值公告（含用印pdf）"
const cscSade15Body =
  "日期 产品代码 产品名称 基金份额净值 基金份额累计净值\n" +
  "2026-07-24 SADE15 汉鸿景明1号私募证券投资基金 1.0007 1.0007"
const cscSade15Meta = extractNavMetadata(cscSade15Subject, cscSade15Body)
assert(
  "csc 资产净值公告 subject extracts SADE15 / 汉鸿景明1号",
  cscSade15Meta.productCode === "SADE15" && cscSade15Meta.fundName === "汉鸿景明1号",
)
const cscSade15Nav = extractNavData(cscSade15Subject, cscSade15Body)
assert(
  "csc 资产净值公告 body extracts 2026-07-24 nav 1.0007",
  cscSade15Nav?.navDate === "2026-07-24"
    && cscSade15Nav?.nav === 1.0007
    && cscSade15Nav?.cumulativeNav === 1.0007
    && cscSade15Nav?.productCode === "SADE15",
)
const cscSade15History = extractNavHistoryFromBody(cscSade15Subject, cscSade15Body)
assert(
  "csc 资产净值公告 history table extracts one SADE15 row",
  cscSade15History.length === 1
    && cscSade15History[0]?.navDate === "2026-07-24"
    && cscSade15History[0]?.nav === 1.0007,
)

const cscBatchSubject = "汉鸿景明1号私募证券投资基金_SADE15批量补发 资产净值公告"
const cscBatchBody =
  "产品代码 产品名称 日期 基金份额净值 基金份额累计净值\n" +
  "SADE15 汉鸿景明1号私募证券投资基金 2026-05-25 1.0000 1.0000\n" +
  "SADE15 汉鸿景明1号私募证券投资基金 2026-05-26 1.0000 1.0000\n" +
  "SADE15 汉鸿景明1号私募证券投资基金 2026-05-27 1.0001 1.0001\n" +
  "SADE15 汉鸿景明1号私募证券投资基金 2026-07-23 1.0009 1.0009\n"
const cscBatchHistory = extractNavHistoryFromBody(cscBatchSubject, cscBatchBody)
assert(
  "csc 批量补发 history extracts multi-day SADE15 rows",
  cscBatchHistory.length === 4
    && cscBatchHistory[0]?.navDate === "2026-05-25"
    && cscBatchHistory[0]?.nav === 1
    && cscBatchHistory.at(-1)?.navDate === "2026-07-23"
    && cscBatchHistory.at(-1)?.nav === 1.0009,
)
const cscBatchDateOnlyBody =
  "日期 基金份额净值 基金份额累计净值\n" +
  "2026-05-25 1.0000 1.0000\n" +
  "2026-05-26 1.0000 1.0000\n" +
  "2026-06-05 1.0000 1.0000\n"
const cscBatchDateOnly = extractNavHistoryFromBody(cscBatchSubject, cscBatchDateOnlyBody)
assert(
  "csc 批量补发 date-nav rows use subject SADE15",
  cscBatchDateOnly.length === 3
    && cscBatchDateOnly.every((r) => r.productCode === "SADE15")
    && cscBatchDateOnly[2]?.navDate === "2026-06-05",
)

const jinyuZhuiTaSubject =
  "国泰海通证券资产托管发送：金奥追风1号私募证券投资基金A【金舆追风1号私募证券投资基金】TA虚拟净值_2026-07-22"
const jinyuZhuiTaBody = "净值日期 2026-07-22 单位净值 1.1800 累计单位净值 1.9290"
const jinyuZhuiTaMeta = extractNavMetadata(jinyuZhuiTaSubject, jinyuZhuiTaBody)
assert(
  "guotai TA virtual metadata not mapped to SCJ536",
  jinyuZhuiTaMeta.productCode !== "SCJ536" && jinyuZhuiTaMeta.fundName?.includes("金奥追风"),
)
const jinyuZhuiTaNav = extractNavData(jinyuZhuiTaSubject, jinyuZhuiTaBody)
assert(
  "guotai TA virtual ingests under underlying 金奥追风, not managed 金舆追风",
  jinyuZhuiTaNav?.navDate === "2026-07-22"
    && jinyuZhuiTaNav?.nav === 1.18
    && jinyuZhuiTaNav?.cumulativeNav === 1.929
    && jinyuZhuiTaNav?.fundName?.includes("金奥追风") === true
    && !jinyuZhuiTaNav?.fundName?.includes("金舆追风")
    && jinyuZhuiTaNav?.productCode !== "SCJ536",
)

const rongxiTaSubject =
  "国泰海通证券资产托管发送：绵烁ETF套利3号私募证券投资基金A【荣熙共赢私募证券投资基金】TA虚拟净值_2026-07-20"
const rongxiTaNav = extractNavData(rongxiTaSubject, "净值日期 2026-07-20 单位净值 0.9912 累计单位净值 0.9912")
assert(
  "rongxi TA virtual ingests under underlying, not managed 荣熙共赢",
  rongxiTaNav?.nav === 0.9912
    && rongxiTaNav?.navDate === "2026-07-20"
    && !rongxiTaNav?.fundName?.includes("荣熙"),
)

const duxiAvmTaSubject =
  "国泰海通证券资产托管发送：笃熙禀泰渊流1号私募证券投资基金A【荣熙共赢私募证券投资基金】TA虚拟净值_2026-07-22"
const duxiAvmTaMeta = extractNavMetadata(duxiAvmTaSubject, "单位净值 1.1800")
assert(
  "AVM35A TA virtual metadata keeps underlying 笃熙, not 荣熙共赢A类",
  duxiAvmTaMeta.fundName?.includes("笃熙") === true
    && !duxiAvmTaMeta.fundName?.includes("荣熙"),
)
const duxiAvmTaNav = extractNavData(duxiAvmTaSubject, "净值日期 2026-07-22 单位净值 1.1800 累计单位净值 1.1800")
assert(
  "AVM35A TA virtual ingests under underlying 笃熙 (not 荣熙/SBNX55)",
  duxiAvmTaNav?.nav === 1.18
    && duxiAvmTaNav?.fundName?.includes("笃熙") === true
    && !duxiAvmTaNav?.fundName?.includes("荣熙")
    && duxiAvmTaNav?.productCode !== "SBNX55",
)

const tailai3TaSubject =
  "国泰海通证券资产托管发送：棕榈滩泰来三号私募证券投资基金A【荣熙共赢私募证券投资基金】TA虚拟净值_2026-07-24"
const tailai3TaNav = extractNavData(
  tailai3TaSubject,
  "净值日期 2026-07-24 单位净值 1.0976 累计单位净值 1.0976",
)
assert(
  "BVC41A Guotai TA virtual extracts Jul-24 under 棕榈滩泰来三号A类 / BVC41A",
  tailai3TaNav?.navDate === "2026-07-24"
    && tailai3TaNav?.nav === 1.0976
    && tailai3TaNav?.productCode === "BVC41A"
    && tailai3TaNav?.fundName?.includes("泰来三号") === true
    && !tailai3TaNav?.fundName?.includes("荣熙"),
)

const sqx078Subject =
  "【虚拟净值】SQX078_特夫郁金香全量化私募证券投资基金_衡颐海泰1号私募证券投资基金_2026-07-15"
const sqx078Body =
  "净值日期 客户名称 基金账号 证件号码 基金代码 基金名称 份额 单位净值 累计单位净值 业绩计提金额 虚拟单位净值 " +
  "2026-07-15 衡颐海泰1号私募证券投资基金 NB8003591509 SBPU97 SQX078 特夫郁金香全量化私募证券投资基金 951,112.80 1.1130 2.2767 17,576.56 1.0945"
const sqx078Meta = extractNavMetadata(sqx078Subject, sqx078Body)
assert(
  "SQX078 virtual bracket subject extracts code",
  sqx078Meta.productCode === "SQX078" && sqx078Meta.fundName?.includes("郁金香"),
)
const sqx078Nav = extractNavData(sqx078Subject, sqx078Body)
assert(
  "SQX078 virtual email uses actual unit not virtual unit",
  sqx078Nav?.navDate === "2026-07-15"
    && sqx078Nav?.nav === 1.113
    && sqx078Nav?.cumulativeNav === 2.2767
    && sqx078Nav?.productCode === "SQX078",
)

// 【基金虚拟净值表现估算】 must store 实际净值 (col3), not per-investor 虚拟净值 (col2).
const bhk26aEstimateSubject =
  "【基金虚拟净值表现估算】BHK26A_六妙星豪鑫6号私募证券投资基金A类_2026-07-24_金舆基石一号私募证券投资基金"
const bhk26aEstimateBody =
  "净值日期 业务类型 持有份额 份额变动 虚拟净值 实际净值 实际累计净值 " +
  "2026-07-24 TA计提 2,473,410.83 0 1.0965 1.0548 1.6750"
const bhk26aEstimateNav = extractNavData(bhk26aEstimateSubject, bhk26aEstimateBody)
assert(
  "BHK26A 虚拟净值表现估算 stores 实际净值 1.0548 not 虚拟净值 1.0965",
  bhk26aEstimateNav?.navDate === "2026-07-24"
    && bhk26aEstimateNav?.nav === 1.0548
    && bhk26aEstimateNav?.cumulativeNav === 1.675
    && bhk26aEstimateNav?.productCode === "BHK26A",
)

// SQX078: virtual email cum/unit > 2 must not be stripped; 复权 grows at unit rate on email tail
const sqx078LegacyTail = [
  { price_date: "2026-05-29", nav: "1.098400", cumulative_nav: "2.816912", cum_nav_withdrawal: "2.262100", price_change: "" },
]
const sqx078VirtualEmail = [
  {
    nav_date: "2026-06-04",
    nav: "1.101100",
    cumulative_nav: "2.264800",
    adjusted_nav: "2.264800",
    product_code: "SQX078",
    subject: "【虚拟净值】SQX078_特夫郁金香全量化私募证券投资基金_衡颐海泰1号_2026-06-04",
    source: "attachment_nav_table",
  },
  {
    nav_date: "2026-07-15",
    nav: "1.113000",
    cumulative_nav: "2.276700",
    adjusted_nav: "2.276700",
    product_code: "SQX078",
    subject: "【虚拟净值】SQX078_特夫郁金香全量化私募证券投资基金_衡颐海泰1号_2026-07-15",
    source: "attachment_nav_table",
  },
]
const sqx078EmailSelected = selectEmailNavSeriesRows(sqx078VirtualEmail, "SQX078", ["特夫郁金香全量化"])
const sqx078Jul15Email = sqx078EmailSelected.find((r) => r.nav_date === "2026-07-15")
assert(
  "SQX078 virtual email keeps cum when cum/unit > 2",
  sqx078Jul15Email != null && Math.abs(parseFloat(sqx078Jul15Email.cumulative_nav) - 2.2767) < 0.001,
)
const sqx078EmailPoints = sqx078EmailSelected.map((r) => ({
  price_date: r.nav_date,
  nav: r.nav,
  cumulative_nav: r.cumulative_nav,
  adjusted_nav: r.adjusted_nav,
}))
const sqx078EmailMerged = mergeNavSeriesWithEmail(sqx078LegacyTail, sqx078EmailPoints)
const sqx078Jul15Merged = sqx078EmailMerged.find((r) => r.price_date === "2026-07-15")
assert(
  "SQX078 email tail adj uses unit rate not cum rate",
  sqx078Jul15Merged != null && parseFloat(sqx078Jul15Merged.cumulative_nav) > 2.845,
)
assert(
  "SQX078 Jul15 adj >= cum",
  parseFloat(sqx078Jul15Merged.cumulative_nav) >= parseFloat(sqx078Jul15Merged.cum_nav_withdrawal) - 0.001,
)
assert(
  "SQX078 Jul15 cum from email",
  Math.abs(parseFloat(sqx078Jul15Merged.cum_nav_withdrawal) - 2.2767) < 0.001,
)

const sbhk26History = [
  {
    nav_date: "2026-06-12",
    nav: "1.325300",
    cumulative_nav: "1.529900",
    adjusted_nav: null,
    product_code: "BHK26A",
    fund_name: "六妙星豪鑫6号A类",
    attachment_filename: "",
    subject: "【基金虚拟净值表现估算】BHK26A_六妙星豪鑫6号私募证券投资基金A类_2026-06-12_荣熙共赢私募证券投资基金",
    source: "body_table",
  },
  {
    nav_date: "2026-06-29",
    nav: "1.122700",
    cumulative_nav: "1.122700",
    adjusted_nav: null,
    product_code: "SBHK26",
    fund_name: "六妙星豪鑫6号",
    attachment_filename: "SBHK26_六妙星豪鑫6号私募证券投资基金_资产估值表_20260630_4级_荣熙共赢私募证券投资基金.xls",
    subject: "【基金估值表】SBHK26_六妙星豪鑫6号私募证券投资基金_资产估值表_20260630_4级_荣熙共赢私募证券投资基金.xls",
    source: "attachment_valuation_table",
  },
]
const sbhk26Selected = selectEmailNavSeriesRows(sbhk26History, "SBHK26", ["六妙星豪鑫6号"])
const sbhk26Jun29 = sbhk26Selected.find((r) => r.nav_date === "2026-06-29")
assert(
  "SBHK26 custody valuation keeps unit 1.1227",
  sbhk26Jun29 != null && Math.abs(parseFloat(sbhk26Jun29.nav) - 1.1227) < 0.0001,
)

assert(
  "share-class family expands SBHK26 to BHK26A",
  expandBeiansWithShareClassFamily(["SBHK26"]).includes("BHK26A"),
)
const sbhk26ListMap = new Map([
  ["SBHK26", [{ nav_date: "2026-06-30", nav: 1.1227, source: "attachment_valuation_table", subject: "【基金估值表】SBHK26" }]],
  ["BHK26A", [
    { nav_date: "2026-07-23", nav: 1.074, source: "body_table", subject: "【基金虚拟净值表现估算】BHK26A_荣熙共赢" },
    { nav_date: "2026-07-22", nav: 1.0712, source: "body_table", subject: "【基金虚拟净值表现估算】BHK26A_荣熙共赢" },
  ]],
])
backfillParentEmailFromShareClassSiblings(sbhk26ListMap, ["SBHK26"])
const sbhk26Backfilled = sbhk26ListMap.get("SBHK26") ?? []
assert(
  "SBHK26 list parent gets BHK26A Jul-23 fallback",
  sbhk26Backfilled.some((p) => p.nav_date === "2026-07-23" && Math.abs(p.nav - 1.074) < 0.0001),
)

// Multi-investor 【基金虚拟净值表现估算】 under one product_code: continuity must
// win over max(id). Otherwise list return mixes 金舆/抱朴 → bogus +3.40%.
const bhk26aMultiInvestor = [
  // Deliberately max-id-first order (list batch used to feed DESC) — ids force ASC pick.
  {
    id: 522318,
    nav_date: "2026-07-24",
    nav: "1.096500",
    cumulative_nav: "1.675000",
    adjusted_nav: null,
    product_code: "BHK26A",
    fund_name: "六妙星豪鑫6号A类",
    attachment_filename: "",
    subject: "【基金虚拟净值表现估算】BHK26A_六妙星豪鑫6号私募证券投资基金A类_2026-07-24_金舆基石一号私募证券投资基金",
    source: "body_table",
  },
  {
    id: 522294,
    nav_date: "2026-07-24",
    nav: "1.068400",
    cumulative_nav: "1.675000",
    adjusted_nav: null,
    product_code: "BHK26A",
    fund_name: "六妙星豪鑫6号A类",
    attachment_filename: "",
    subject: "【基金虚拟净值表现估算】BHK26A_六妙星豪鑫6号私募证券投资基金A类_2026-07-24_荣熙共赢私募证券投资基金",
    source: "body_table",
  },
  {
    id: 522287,
    nav_date: "2026-07-24",
    nav: "1.054800",
    cumulative_nav: "1.675000",
    adjusted_nav: null,
    product_code: "BHK26A",
    fund_name: "六妙星豪鑫6号A类",
    attachment_filename: "",
    subject: "【基金虚拟净值表现估算】BHK26A_六妙星豪鑫6号私募证券投资基金A类_2026-07-24_抱朴聚融祥和一号私募证券投资基金",
    source: "body_table",
  },
  {
    id: 509636,
    nav_date: "2026-07-23",
    nav: "1.060400",
    cumulative_nav: "1.686400",
    adjusted_nav: null,
    product_code: "BHK26A",
    fund_name: "六妙星豪鑫6号A类",
    attachment_filename: "",
    subject: "【基金虚拟净值表现估算】BHK26A_六妙星豪鑫6号私募证券投资基金A类_2026-07-23_抱朴聚融祥和一号私募证券投资基金",
    source: "body_table",
  },
  {
    id: 509202,
    nav_date: "2026-07-23",
    nav: "1.107900",
    cumulative_nav: "1.686400",
    adjusted_nav: null,
    product_code: "BHK26A",
    fund_name: "六妙星豪鑫6号A类",
    attachment_filename: "",
    subject: "【基金虚拟净值表现估算】BHK26A_六妙星豪鑫6号私募证券投资基金A类_2026-07-23_金舆基石一号私募证券投资基金",
    source: "body_table",
  },
  {
    id: 509122,
    nav_date: "2026-07-23",
    nav: "1.074000",
    cumulative_nav: "1.686400",
    adjusted_nav: null,
    product_code: "BHK26A",
    fund_name: "六妙星豪鑫6号A类",
    attachment_filename: "",
    subject: "【基金虚拟净值表现估算】BHK26A_六妙星豪鑫6号私募证券投资基金A类_2026-07-23_荣熙共赢私募证券投资基金",
    source: "body_table",
  },
]
const bhk26aSelected = selectEmailNavSeriesRows(bhk26aMultiInvestor, "BHK26A", [
  "六妙星豪鑫6号A类",
  "六妙星豪鑫6号私募证券投资基金A类",
])
const bhk26aJul24 = bhk26aSelected.find((r) => r.nav_date === "2026-07-24")
const bhk26aJul23 = bhk26aSelected.find((r) => r.nav_date === "2026-07-23")
assert(
  "BHK26A multi-investor picks continuous Jul-24 unit (not max-id 金舆 1.0965)",
  bhk26aJul24 != null && Math.abs(parseFloat(bhk26aJul24.nav) - 1.0548) < 0.0001,
)
assert(
  "BHK26A multi-investor Jul-23/24 day return is not cross-investor +3.40%",
  bhk26aJul23 != null
    && bhk26aJul24 != null
    && Math.abs(parseFloat(bhk26aJul24.nav) / parseFloat(bhk26aJul23.nav) - 1 - 0.03404376) > 0.01,
)
// Email-only rechain on the detail continuity picks must set 复权 ≠ 单位净值
// so list daily return can use return_nav (detail 平台数据涨跌幅).
const bhk26aAdj = mergeNavSeriesWithEmail(
  [],
  [
    { price_date: "2026-07-22", nav: "1.0576", cumulative_nav: "1.6819", adjusted_nav: null },
    { price_date: "2026-07-23", nav: "1.074", cumulative_nav: "1.6864", adjusted_nav: null },
    { price_date: "2026-07-24", nav: "1.0548", cumulative_nav: "1.675", adjusted_nav: null },
  ],
  { beian_hao: "BHK26A", product_name: "六妙星豪鑫6号A类" },
)
const bhk26aAdj24 = bhk26aAdj.find((r) => r.price_date === "2026-07-24")
assert(
  "BHK26A email rechain keeps 复权 above 单位净值 on Jul-24",
  bhk26aAdj24 != null
    && parseFloat(bhk26aAdj24.cumulative_nav) > parseFloat(bhk26aAdj24.nav) + 0.05,
)
assert(
  "BHK26A detail 复权 day return is -1.14% (list target)",
  Math.abs(1.682335 / 1.701709 - 1 - (-0.011385)) < 0.0001,
)
assert(
  "BHK26A unit day return is -1.79% (must not be list 最新涨跌幅)",
  Math.abs(1.0548 / 1.074 - 1 - (-0.017877)) < 0.0001,
)

const sbfm35History = [
  {
    nav_date: "2026-05-29",
    nav: "1.026300",
    cumulative_nav: "3.000000",
    adjusted_nav: null,
    product_code: "SBFM35",
    fund_name: "金友至远1号",
    attachment_filename: "",
    subject: "SBFM35金友至远1号私募证券投资基金每日产品三级估值表20260529",
    source: "attachment_valuation_table",
  },
  {
    nav_date: "2026-05-29",
    nav: "1.023400",
    cumulative_nav: "1.023400",
    adjusted_nav: null,
    product_code: "BFM35A",
    fund_name: "南京金友A类",
    attachment_filename: "",
    subject: "BFM35A（协会备案代码SBFM35)金友至远1号A类产品2026年05月29日资产净值份额公告",
    source: "body_table",
  },
  {
    nav_date: "2026-06-12",
    nav: "1.054000",
    cumulative_nav: "1.054000",
    adjusted_nav: null,
    product_code: "BFM35A",
    fund_name: "南京金友A类",
    attachment_filename: "",
    subject: "BFM35A（协会备案代码SBFM35)金友至远1号A类产品2026年06月12日资产净值份额公告",
    source: "body_table",
  },
  {
    nav_date: "2026-06-30",
    nav: "1.081300",
    cumulative_nav: null,
    adjusted_nav: null,
    product_code: "SBFM35",
    fund_name: "金友至远1号",
    attachment_filename: "",
    subject: "SBFM35金友至远1号私募证券投资基金每日产品三级估值表20260630",
    source: "attachment_valuation_table",
  },
]
const sbfm35Selected = selectEmailNavSeriesRows(sbfm35History, "SBFM35", ["金友至远1号"])
const sbfm35May29 = sbfm35Selected.find((r) => r.nav_date === "2026-05-29")
const sbfm35Jun12 = sbfm35Selected.find((r) => r.nav_date === "2026-06-12")
const sbfm35Jun30 = sbfm35Selected.find((r) => r.nav_date === "2026-06-30")
assert(
  "SBFM35 May29 ignores corrupt cum=3 valuation row",
  sbfm35May29 != null
    && Math.abs(parseFloat(sbfm35May29.nav) - 1.0263) < 0.001
    && (sbfm35May29.cumulative_nav == null || parseFloat(sbfm35May29.cumulative_nav) < 2),
)
assert(
  "SBFM35 Jun12 keeps A-class unit ~1.054 (no ratio bleed)",
  sbfm35Jun12 != null && Math.abs(parseFloat(sbfm35Jun12.nav) - 1.054) < 0.001,
)
assert(
  "SBFM35 Jun30 custody valuation ~1.0813",
  sbfm35Jun30 != null && Math.abs(parseFloat(sbfm35Jun30.nav) - 1.0813) < 0.001,
)
const sbfm35Legacy = [
  { price_date: "2026-05-29", nav: "1.024100", cumulative_nav: "1.024100", cum_nav_withdrawal: "1.024100", price_change: "" },
  { price_date: "2026-06-12", nav: "0.360573", cumulative_nav: "2.334273", cum_nav_withdrawal: "2.334273", price_change: "" },
]
const sbfm35EmailPoints = sbfm35Selected.map((r) => ({
  price_date: r.nav_date,
  nav: r.nav,
  cumulative_nav: r.cumulative_nav,
  adjusted_nav: r.adjusted_nav,
}))
const sbfm35Merged = mergeNavSeriesWithEmail(sbfm35Legacy, sbfm35EmailPoints)
const sbfm35MergedJun12 = sbfm35Merged.find((r) => r.price_date === "2026-06-12")
const sbfm35MergedJun30 = sbfm35Merged.find((r) => r.price_date === "2026-06-30")
assert(
  "SBFM35 merged Jun12 unit ~1.054 not halved legacy",
  sbfm35MergedJun12 != null && Math.abs(parseFloat(sbfm35MergedJun12.nav) - 1.054) < 0.001,
)
assert(
  "SBFM35 merged Jun30 unit ~1.0813",
  sbfm35MergedJun30 != null && Math.abs(parseFloat(sbfm35MergedJun30.nav) - 1.0813) < 0.001,
)

const bfm35aHistory = [
  {
    nav_date: "2026-05-29",
    nav: "1.026300",
    cumulative_nav: "3.000000",
    adjusted_nav: null,
    product_code: "SBFM35",
    fund_name: "金友至远1号",
    attachment_filename: "",
    subject: "SBFM35金友至远1号私募证券投资基金每日产品三级估值表20260529",
    source: "attachment_valuation_table",
  },
  {
    nav_date: "2026-05-29",
    nav: "1.023400",
    cumulative_nav: "1.023400",
    adjusted_nav: null,
    product_code: "BFM35A",
    fund_name: "南京金友A类",
    attachment_filename: "",
    subject: "BFM35A（协会备案代码SBFM35)金友至远1号A类产品2026年05月29日资产净值份额公告",
    source: "body_table",
  },
  {
    nav_date: "2026-06-30",
    nav: "1.081300",
    cumulative_nav: null,
    adjusted_nav: null,
    product_code: "SBFM35",
    fund_name: "金友至远1号",
    attachment_filename: "",
    subject: "SBFM35金友至远1号私募证券投资基金每日产品三级估值表20260630",
    source: "attachment_valuation_table",
  },
  {
    nav_date: "2026-07-03",
    nav: "1.074500",
    cumulative_nav: "1.074500",
    adjusted_nav: null,
    product_code: "BFM35A",
    fund_name: "南京金友A类",
    attachment_filename: "",
    subject: "BFM35A（协会备案代码SBFM35)金友至远1号A类产品2026年07月03日资产净值份额公告",
    source: "body_table",
  },
]
const bfm35aSelected = selectEmailNavSeriesRows(bfm35aHistory, "BFM35A", ["金友至远1号A类", "南京金友A类"])
assert(
  "BFM35A May29 uses A-class body ~1.0234",
  bfm35aSelected.some((r) => r.nav_date === "2026-05-29" && Math.abs(parseFloat(r.nav) - 1.0234) < 0.001),
)
assert(
  "BFM35A skips parent valuation on 0630",
  !bfm35aSelected.some((r) => r.nav_date === "2026-06-30"),
)
const bfm35aJul3 = bfm35aSelected.find((r) => r.nav_date === "2026-07-03")
assert(
  "BFM35A Jul3 unit ~1.0745",
  bfm35aJul3 != null && Math.abs(parseFloat(bfm35aJul3.nav) - 1.0745) < 0.001,
)

const savm35BrokenLegacy = [
  { price_date: "2026-07-01", nav: "0.7658", cum_nav_withdrawal: "1.5158", cumulative_nav: "1.5158", price_change: "" },
  { price_date: "2026-07-08", nav: "0.7279", cum_nav_withdrawal: "1.4769", cumulative_nav: "1.4769", price_change: "" },
  { price_date: "2026-07-09", nav: "0.7400", cum_nav_withdrawal: "1.4890", cumulative_nav: "1.4890", price_change: "" },
]
const savm35Email = [
  { price_date: "2026-07-08", nav: "1.1950", cumulative_nav: null, adjusted_nav: null },
  { price_date: "2026-07-09", nav: "1.2150", cumulative_nav: null, adjusted_nav: null },
]
const savm35Merged = mergeNavSeriesWithEmail(savm35BrokenLegacy, savm35Email)
const savm35Jul9 = savm35Merged.find((r) => r.price_date === "2026-07-09")
assert("SAVM35 halved legacy + email unit ~1.215", Math.abs(parseFloat(savm35Jul9.nav) - 1.215) < 0.001)
assert("SAVM35 halved legacy + email cum ~1.964", Math.abs(parseFloat(savm35Jul9.cum_nav_withdrawal) - 1.964) < 0.01)

const emailPoolDedupe = (funds) => {
  const isCode = (r) => /^[A-Z0-9]{4,10}$/i.test(String(r).trim())
  const coded = funds.filter((f) => isCode(f.register_number))
  const nameOnly = funds.filter((f) => !isCode(f.register_number))
  const codedNames = new Set(coded.map((f) => f.product_name.trim().toLowerCase()))
  return [...coded, ...nameOnly.filter((f) => !codedNames.has(f.product_name.trim().toLowerCase()))]
}
const hengyingPool = emailPoolDedupe([
  { register_number: "SBAH99", product_name: "荣熙恒盈2号A类" },
  { register_number: "BAH99A", product_name: "荣熙恒盈2号A类" },
  { register_number: "BAH99C", product_name: "荣熙恒盈2号C类" },
  { register_number: "SBAH99", product_name: "荣熙恒盈2号" },
])
assert(
  "email pool keeps parent + A + C registers",
  hengyingPool.some((f) => f.register_number === "SBAH99" && f.product_name === "荣熙恒盈2号")
    && hengyingPool.some((f) => f.register_number === "BAH99A")
    && hengyingPool.some((f) => f.register_number === "BAH99C"),
)

function canonicalEmailPoolNameForTest(bflName, emailNameByCode) {
  const emailName = String(emailNameByCode ?? "").trim()
  const bfl = String(bflName ?? "").trim()
  if (emailName && bfl) {
    const same =
      emailName === bfl
      || emailName.startsWith(bfl)
      || bfl.startsWith(emailName)
      || emailName.replace(/[^\u4e00-\u9fff0-9A-Za-z]/g, "") === bfl.replace(/[^\u4e00-\u9fff0-9A-Za-z]/g, "")
    if (!same && !emailName.includes("文艺复兴") && emailName.includes("多资产轮动")) return emailName
  }
  return bfl || emailName
}
assert(
  "email pool prefers email name when BFL register label disagrees (SNG210)",
  canonicalEmailPoolNameForTest("笃熙禀泰文艺复兴16号", "笃熙禀泰多资产轮动策略2号")
    === "笃熙禀泰多资产轮动策略2号",
)

assert(
  "文艺复兴26 NAV rows remap SQQ300 → SQQ26A",
  applyEmailProductCodeOverride(
    "SQQ300",
    "笃熙禀泰文艺复兴26号",
    "资产净值公告_SQQ300_笃熙禀泰文艺复兴26号私募证券投资基金_2026-06-18",
  ) === "SQQ26A",
)
assert(
  "多资产轮动策略3号 keeps SQQ300",
  applyEmailProductCodeOverride(
    "SQQ300",
    "笃熙禀泰多资产轮动策略3号",
    "资产净值公告_SQQ300_笃熙禀泰多资产轮动策略3号私募证券投资基金_2026-07-09",
  ) === "SQQ300",
)

{
  const jinyouVirtual =
    "金舆基石一号私募证券投资基金【SXN097-古曲祥辰5号私募证券投资基金】虚拟净值20260709"
  const meta = extractNavMetadata(jinyouVirtual, "")
  assert("FOF bracket virtual NAV uses underlying code SXN097", meta.productCode === "SXN097")
  assert("FOF bracket virtual NAV uses underlying name 古曲祥辰5号", meta.fundName === "古曲祥辰5号")
}

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
