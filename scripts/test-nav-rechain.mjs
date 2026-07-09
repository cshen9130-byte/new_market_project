import { mergeLegacyWithTeamNav, mergeNavSeriesWithEmail, isFofUnderlyingValuationEmailRow, selectEmailNavSeriesRows, dedupeLegacyNavRowsByDate } from "../lib/server/email-nav-query.ts"
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
