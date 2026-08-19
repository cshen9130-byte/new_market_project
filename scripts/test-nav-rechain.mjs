import { mergeLegacyWithTeamNav, mergeNavSeriesWithEmail, isFofUnderlyingValuationEmailRow, selectEmailNavSeriesRows, dedupeLegacyNavRowsByDate, emailRowMatchesFund } from "../lib/server/email-nav-query.ts"
import {
  enrichReturnNavSeries,
  calcDailyReturnPctFromHistory,
  MAX_DAILY_RETURN_LOOKBACK_DAYS,
  capPeriodReturnByDrawdown,
  calcReturn,
  sanitizeNavPointSeries,
  expandBeiansWithShareClassFamily,
  backfillParentEmailFromShareClassSiblings,
} from "../lib/server/list-cache-nav-batch.ts"
import { lookupFundNavCorrectionRule, applyFundNavCorrectionToLegacyRows } from "../lib/server/fund-nav-correction-rules.ts"
import {
  isGuotaiValuationSubject,
  isCustodySendDateValuationSubject,
  isHuataiDailyValuationSubject,
  extractNavFromValuationBuffer,
  extractValuationFromBuffer,
} from "../lib/server/email-valuation-attachment.ts"
import { unitNavFromValuationSummary } from "../lib/server/email-valuation-nav-backfill.ts"
import { dedupeShareClassDisplayFunds } from "../lib/server/fund-name-match.ts"
import { extractNavMetadata, extractNavData, extractNavHistoryFromBody, applyEmailProductCodeOverride } from "../lib/server/email-nav-extract.ts"
import { deriveNetAssetValue, resolveEmailFundMetrics } from "../lib/server/email-valuation-cache-enrich.ts"
import {
  extractNavTableFromBuffer,
  selectNavTableAttachments,
} from "../lib/server/email-nav-attachment.ts"
import {
  computeManagedProductOneYearRiskMetrics,
  isPlausibleRiskRatio,
  loadManagedProductNavSeed,
  mergeManagedProductDetailNav,
  resolveTeamSeriesListNavAt,
  buildManagedProductListNavHistory,
} from "../lib/server/managed-product-nav-seed.ts"
import { filterWeekendNavRows, isWeekendIsoDate } from "../lib/nav-trading-day.ts"
import { analyzeNavWorkbook } from "../lib/server/nav-cleaner.ts"
import * as XLSX from "xlsx"
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

// List "最新净值日期" must also skip custody weekend forward-fills.
const weekendTeamRows = [
  { nav_date: "2026-07-24", unit_nav: "0.9989" },
  { nav_date: "2026-07-25", unit_nav: "0.9988" },
  { nav_date: "2026-07-26", unit_nav: "0.9988" },
]
const listWeekend = resolveTeamSeriesListNavAt(weekendTeamRows, "2026-07-28")
assert("list nav skips Sat/Sun", listWeekend?.nav_date === "2026-07-24")
assert("list nav uses Fri unit", listWeekend?.nav === "0.9989")
const listHist = buildManagedProductListNavHistory("", [], weekendTeamRows)
assert("list history drops weekends", !listHist.some((p) => p.nav_date === "2026-07-25" || p.nav_date === "2026-07-26"))
assert("list history keeps Fri", listHist.some((p) => p.nav_date === "2026-07-24"))
assert("iso weekend Sat", isWeekendIsoDate("2026-07-25"))
assert("iso weekend Sun", isWeekendIsoDate("2026-07-26"))
assert("iso weekday Fri", !isWeekendIsoDate("2026-07-24"))
const uiFiltered = filterWeekendNavRows([
  { price_date: "2026-07-26", nav: "0.9988" },
  { price_date: "2026-07-25", nav: "0.9988" },
  { price_date: "2026-07-24", nav: "0.9989" },
])
assert("ui filter drops 25/26", uiFiltered.length === 1 && uiFiltered[0].price_date === "2026-07-24")

// Guotai `_YYYYMMDD估值表` subjects encode the NAV date; detect them as custody.
const guotaiSubject = "国泰海通证券资产托管估值表发送：SAVW72_金舆基石一号私募证券投资基金_20260615估值表"
assert("guotai subject detected", isGuotaiValuationSubject(guotaiSubject, ""))
assert("guotai is custody pattern", isCustodySendDateValuationSubject(guotaiSubject, ""))

// SAVW72 series_start_date drops mis-dated pre-inception valuation rows.
const savwRule = lookupFundNavCorrectionRule("SAVW72")
assert("SAVW72 correction rule loaded", !!savwRule && savwRule.series_start_date === "2026-06-12")
const savwTrimmed = applyFundNavCorrectionToLegacyRows(
  [
    { price_date: "2026-06-02", nav: "1.0069", cumulative_nav: "1.0069", cum_nav_withdrawal: "1.0069", price_change: "" },
    { price_date: "2026-06-12", nav: "1.0001", cumulative_nav: "1.0001", cum_nav_withdrawal: "1.0001", price_change: "" },
    { price_date: "2026-06-15", nav: "1.0002", cumulative_nav: "1.0002", cum_nav_withdrawal: "1.0002", price_change: "" },
  ],
  { beian_hao: "SAVW72", product_name: "金舆基石一号", short_name: null },
)
assert("SAVW72 drops 06-02", !savwTrimmed.some((r) => r.price_date === "2026-06-02"))
assert("SAVW72 keeps inception", savwTrimmed[0]?.price_date === "2026-06-12")

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

// CMS/招商 multi-product 【净值表】: subject names first fund, body/attachment has two codes.
const cmsMultiSubject =
  '【净值表】杭州山信私募基金管理有限公司管理人旗下"山信至诚一号私募证券投资基金-SBAD05"等2个产品净值表发送20250620_20260724'
const cmsMultiMeta = extractNavMetadata(cmsMultiSubject, "")
assert(
  "cms multi-product subject extracts SBAD05 / 山信至诚",
  cmsMultiMeta.productCode === "SBAD05" && cmsMultiMeta.fundName?.includes("山信至诚"),
)
const cmsMultiBody =
  "日期 产品代码 产品名称 单位净值 累计单位净值\n" +
  "2026年07月23日 SBAD05 山信至诚一号私募证券投资基金 1.0089 1.0016\n" +
  "2026年07月24日 SBAD05 山信至诚一号私募证券投资基金 1.0095 1.0022\n" +
  "2026年07月23日 SBCK34 山信韵远一号私募证券投资基金 1.0702 1.0702\n" +
  "2026年07月24日 SBCK34 山信韵远一号私募证券投资基金 1.0710 1.0710\n"
const cmsMultiHistory = extractNavHistoryFromBody(cmsMultiSubject, cmsMultiBody)
assert(
  "cms multi-product body keeps both SBAD05 and SBCK34",
  cmsMultiHistory.some((r) => r.productCode === "SBAD05" && r.fundName?.includes("山信至诚"))
    && cmsMultiHistory.some((r) => r.productCode === "SBCK34" && r.fundName?.includes("山信韵远")),
)
assert(
  "cms multi-product same-date rows not collapsed",
  cmsMultiHistory.filter((r) => r.navDate === "2026-07-24").length === 2,
)
const cmsMultiSheet = XLSX.utils.aoa_to_sheet([
  ["日期", "产品代码", "产品名称", "单位净值", "累计单位净值"],
  ["2026-07-23", "SBAD05", "山信至诚一号私募证券投资基金", 1.0089, 1.0016],
  ["2026-07-24", "SBAD05", "山信至诚一号私募证券投资基金", 1.0095, 1.0022],
  ["2026-07-23", "SBCK34", "山信韵远一号私募证券投资基金", 1.0702, 1.0702],
  ["2026-07-24", "SBCK34", "山信韵远一号私募证券投资基金", 1.0710, 1.0710],
])
const cmsMultiBook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(cmsMultiBook, cmsMultiSheet, "Sheet1")
const cmsMultiBuf = XLSX.write(cmsMultiBook, { type: "buffer", bookType: "xlsx" })
const cmsMultiAttach = extractNavTableFromBuffer(cmsMultiBuf, "每日净值表.xls", cmsMultiSubject)
assert(
  "cms multi-product attachment keeps per-row product codes",
  cmsMultiAttach.some((r) => r.productCode === "SBAD05" && r.fundName?.includes("山信至诚"))
    && cmsMultiAttach.some((r) => r.productCode === "SBCK34" && r.fundName?.includes("山信韵远")),
)
assert(
  "cms multi-product attachment keeps both same-date rows",
  cmsMultiAttach.filter((r) => r.navDate === "2026-07-24").length === 2,
)
const cmsMultiAnalysis = analyzeNavWorkbook(cmsMultiBuf, "每日净值表.xls")
assert(
  "cms multi-product workbook dedupes by date+code",
  cmsMultiAnalysis.rows.filter((r) => r.date === "2026-07-23").length === 2,
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

// CFSC/财通 【TA虚拟净值】-DATE-CODE-FUND-INVESTOR — must ingest attachment + body unit NAV.
const zy084aTaSubject =
  "【TA虚拟净值】-2026-08-03-ZY084A-交睿宏观配置5号私募证券投资基金A-金舆基石一号私募证券投资基金"
const zy084aTaBody =
  "净值日期 产品代码 产品名称 客户名称 单位净值 累计单位净值 虚拟单位净值 发生份额 业绩计提金额 " +
  "2026-08-03 ZY084A 交睿宏观配置5号私募证券投资基金A 金舆基石一号私募证券投资基金 1.6804 2.0432 1.6801 597193.19 156.74"
const zy084aTaMeta = extractNavMetadata(zy084aTaSubject, zy084aTaBody)
assert(
  "ZY084A CFSC TA subject extracts code/name",
  zy084aTaMeta.productCode === "ZY084A"
    && zy084aTaMeta.fundName?.includes("交睿宏观配置5号") === true
    && !zy084aTaMeta.fundName?.includes("基石"),
)
const zy084aTaNav = extractNavData(zy084aTaSubject, zy084aTaBody)
assert(
  "ZY084A CFSC TA body stores 单位净值 1.6804 not 虚拟单位净值 1.6801",
  zy084aTaNav?.navDate === "2026-08-03"
    && zy084aTaNav?.nav === 1.6804
    && zy084aTaNav?.cumulativeNav === 2.0432
    && zy084aTaNav?.productCode === "ZY084A",
)
const zy084aAtts = selectNavTableAttachments(zy084aTaSubject, [
  {
    filename:
      "TA虚拟净值-2026-08-03-ZY084A-交睿宏观配置5号私募证券投资基金A类-金舆基石一号私募证券投资基金.xlsx",
    part: "2",
  },
])
assert(
  "ZY084A CFSC TA xlsx is selected as NAV attachment",
  zy084aAtts.length === 1,
)

// Weekly team/manual + collapsed legacy mid-weeks must not intercalate (SZJ909 sawtooth).
{
  const weeklyTeam = mergeNavSeriesWithEmail([], [
    { price_date: "2025-10-17", nav: "1.2013", cumulative_nav: "1.5268" },
    { price_date: "2025-10-24", nav: "0.9997", cumulative_nav: "1.5271" },
    { price_date: "2025-10-31", nav: "1.0019", cumulative_nav: "1.5293" },
    { price_date: "2025-11-07", nav: "1.0007", cumulative_nav: "1.5281" },
  ])
  const badLegacy = [
    { price_date: "2023-03-01", nav: "1.0000", cumulative_nav: "1.0000", cum_nav_withdrawal: "1.0000", price_change: "" },
    { price_date: "2025-10-20", nav: "1.1800", cumulative_nav: "1.1800", cum_nav_withdrawal: "1.1800", price_change: "" },
    { price_date: "2025-10-28", nav: "1.0000", cumulative_nav: "1.0000", cum_nav_withdrawal: "1.0000", price_change: "" },
    { price_date: "2025-11-04", nav: "1.0010", cumulative_nav: "1.0010", cum_nav_withdrawal: "1.0010", price_change: "" },
  ]
  const merged = mergeLegacyWithTeamNav(badLegacy, weeklyTeam)
  assert("SZJ909-style merge keeps pre-team legacy", merged.some((r) => r.price_date === "2023-03-01"))
  assert(
    "SZJ909-style merge drops mid-window legacy (no sawtooth intercalation)",
    !merged.some((r) => ["2025-10-20", "2025-10-28", "2025-11-04"].includes(r.price_date)),
  )
  assert(
    "SZJ909-style merge keeps all weekly team dates",
    ["2025-10-17", "2025-10-24", "2025-10-31", "2025-11-07"].every((d) =>
      merged.some((r) => r.price_date === d),
    ),
  )
}

// Xingye/兴证: YYYYMMDD_CODE基金名_账号_投资者业绩报酬试算表 — official 单位净值, not 试算单位净值.
const sbbc18TrialSubject =
  "20260805_SBBC18贞元强势1号私募证券投资基金_XY8002280517_金舆守安一号私募证券投资基金业绩报酬试算表，请查收！"
const sbbc18TrialBody =
  "客户名称 金舆守安一号私募证券投资基金 基金名称 贞元强势1号 基金代码 SBBC18 " +
  "协会备案代码 SBBC18 投资人基金账号 XY8002280517 基金净值日期 20260805 " +
  "持有份额 1,018,122.58 单位净值 0.9849 累计净值 1.1354 " +
  "试算业绩报酬 1,058.85 试算单位净值 (扣除业绩报酬后) 0.9839"
const sbbc18TrialMeta = extractNavMetadata(sbbc18TrialSubject, sbbc18TrialBody)
assert(
  "SBBC18 Xingye trial subject extracts code without gluing it into fund name",
  sbbc18TrialMeta.productCode === "SBBC18"
    && sbbc18TrialMeta.fundName === "贞元强势1号"
    && !String(sbbc18TrialMeta.fundName).startsWith("SBBC18"),
)
const sbbc18TrialNav = extractNavData(sbbc18TrialSubject, sbbc18TrialBody)
assert(
  "SBBC18 Xingye trial body stores official 单位净值 0.9849 (not 试算 0.9839)",
  sbbc18TrialNav?.navDate === "2026-08-05"
    && sbbc18TrialNav?.nav === 0.9849
    && sbbc18TrialNav?.cumulativeNav === 1.1354
    && sbbc18TrialNav?.productCode === "SBBC18"
    && sbbc18TrialNav?.fundName === "贞元强势1号",
)
const sbbc18TrialAtts = selectNavTableAttachments(sbbc18TrialSubject, [
  {
    filename:
      "贞元强势1号私募证券投资基金_20260805_金舆守安一号私募证券投资基金_计提净值试算结果.xlsx",
    part: "2",
  },
  {
    filename: "虚拟业绩报酬_其他产品_2026-08-05.xls",
    part: "3",
  },
])
assert(
  "SBBC18 Xingye trial xlsx is selected; pure 虚拟业绩报酬 attachment stays excluded",
  sbbc18TrialAtts.length === 1
    && sbbc18TrialAtts[0].filename.includes("计提净值试算结果"),
)
assert(
  "SBBC18 Xingye trial row matches fund despite investor TA account in subject",
  emailRowMatchesFund(
    {
      product_code: "SBBC18",
      fund_name: "贞元强势1号",
      nav_date: "2026-08-05",
      nav: "0.984900",
      cumulative_nav: "1.135400",
      adjusted_nav: null,
      source: "attachment_nav_table",
      subject: sbbc18TrialSubject,
      attachment_filename:
        "贞元强势1号私募证券投资基金_20260805_金舆守安一号私募证券投资基金_虚拟净值试算结果.xlsx",
    },
    "SBBC18",
    ["贞元强势1号", "贞元强势1号私募证券投资基金"],
  ),
)

// Sparse gap: unit-only FOF 估值表 holdings must not collapse 累计 after June pre-div tip.
const sbbc18JuneTip = [
  {
    price_date: "2026-06-24",
    nav: "1.145900",
    cumulative_nav: "1.145900",
    cum_nav_withdrawal: "1.145900",
    price_change: "",
  },
]
const sbbc18FofOnly = mergeNavSeriesWithEmail(
  sbbc18JuneTip,
  [{ price_date: "2026-08-04", nav: "0.983200", cumulative_nav: null, adjusted_nav: null }],
  { beian_hao: "SBBC18", product_name: "贞元强势1号私募证券投资基金", short_name: "贞元强势1号" },
)
assert(
  "SBBC18 skips unit-only FOF holdings crash across June→Aug gap (no false −14%)",
  sbbc18FofOnly.length === 1
    && sbbc18FofOnly[0].price_date === "2026-06-24"
    && Number(sbbc18FofOnly[0].nav) === 1.1459,
)
const sbbc18EmailCum = mergeNavSeriesWithEmail(
  sbbc18JuneTip,
  [
    {
      price_date: "2026-08-05",
      nav: "0.984900",
      cumulative_nav: "1.135400",
      adjusted_nav: null,
    },
  ],
  { beian_hao: "SBBC18", product_name: "贞元强势1号私募证券投资基金", short_name: "贞元强势1号" },
)
const sbbc18Aug5 = sbbc18EmailCum.find((r) => r.price_date === "2026-08-05")
assert(
  "SBBC18 Xingye trial keeps email 累计净值 1.1354 across sparse gap",
  sbbc18Aug5 != null
    && Number(sbbc18Aug5.nav) === 0.9849
    && Math.abs(Number(sbbc18Aug5.cum_nav_withdrawal) - 1.1354) < 0.0001,
)

// Zhongtai/中泰: CODE_产品_投资者_虚拟净值_YYYYMMDD — body + attachment must ingest.
const szj909Subject =
  "SZJ909_汇融林健CTA9号私募证券投资基金_金舆瑞泰一号私募证券投资基金_虚拟净值_20260731"
const szj909Body =
  "序号 产品代码 产品名称 基金账号 客户名称 业务日期 持仓份额 单位净值 累计单位净值 拟计业绩报酬 虚拟净值 " +
  "1 SZJ909 汇融林健CTA9号私募证券投资基金 QL8059373444 金舆瑞泰一号私募证券投资基金 20260731 940,822.28 1.0628 1.5902 0.00 1.0628"
const szj909Meta = extractNavMetadata(szj909Subject, szj909Body)
assert(
  "SZJ909 Zhongtai virtual subject extracts underlying code/name (not investor)",
  szj909Meta.productCode === "SZJ909"
    && szj909Meta.fundName?.includes("汇融林健CTA9") === true
    && !szj909Meta.fundName?.includes("瑞泰"),
)
const szj909Nav = extractNavData(szj909Subject, szj909Body)
assert(
  "SZJ909 Zhongtai virtual body stores 单位净值/累计 (not 虚拟净值 alone)",
  szj909Nav?.navDate === "2026-07-31"
    && szj909Nav?.nav === 1.0628
    && szj909Nav?.cumulativeNav === 1.5902
    && szj909Nav?.productCode === "SZJ909"
    && szj909Nav?.fundName?.includes("汇融林健CTA9") === true,
)
const szj909Atts = selectNavTableAttachments(szj909Subject, [
  {
    filename:
      "SZJ909_汇融林健CTA9号私募证券投资基金_金舆瑞泰一号私募证券投资基金_虚拟净值_20260731.xlsx",
    part: "2",
  },
])
assert("SZJ909 Zhongtai virtual xlsx is selected as NAV attachment", szj909Atts.length === 1)

// CSC/中信建投 虚拟净值提取信息披露 (SVP460 墨雪鑫瑞1号) — body + 虚拟净值查询 xlsx.
const svp460VirtualSubject =
  "墨雪鑫瑞1号私募证券投资基金-金舆稳健增长1号FOF私募证券投资基金-虚拟净值提取信息披露邮件20260806"
const svp460VirtualFilename =
  "墨雪鑫瑞1号私募证券投资基金_金舆稳健增长1号FOF私募证券投资基金_虚拟净值数据20260807.xlsx"
const svp460VirtualBody =
  "产品代码 产品名称 客户名称 基金账号 证件类型 证件号码 净值日期 未扣除计提费用的单位净值 参与/计划份额 进账计划计提报酬 扣除净值后的单位净值 扣除净值后的累计单位净值 产品净值规模 投资者占比 所有人虚拟参考市值 " +
  "SVP460 墨雪鑫瑞1号私募证券投资基金 金舆稳健增长1号FOF私募证券投资基金 C50233778849 其它 SCU622 20260806 3.7673 1328127.08 1726.57 3.766 3.7673 25369312.12 10.72% 5001726.58"
const svp460VirtualMeta = extractNavMetadata(svp460VirtualSubject, svp460VirtualBody)
assert(
  "SVP460 CSC virtual subject/body extracts underlying (not FOF investor)",
  svp460VirtualMeta.productCode === "SVP460"
    && svp460VirtualMeta.fundName?.includes("墨雪鑫瑞1") === true
    && !svp460VirtualMeta.fundName?.includes("金舆"),
)
const svp460SubjectOnly = extractNavMetadata(svp460VirtualSubject, "")
assert(
  "SVP460 CSC virtual subject-only keeps underlying (not FOF investor)",
  svp460SubjectOnly.fundName?.includes("墨雪鑫瑞1") === true
    && !svp460SubjectOnly.fundName?.includes("金舆"),
)
const bsq40bVirtualSubject =
  "自然红启程2号私募证券投资基金（B类份额）-金舆稳健增长1号FOF私募证券投资基金-虚拟净值提取信息披露邮件20260812"
const bsq40bSubjectOnly = extractNavMetadata(bsq40bVirtualSubject, "")
assert(
  "BSQ40B CSC virtual subject keeps underlying (not SCU622 FOF investor)",
  bsq40bSubjectOnly.fundName?.includes("自然红启程") === true
    && !bsq40bSubjectOnly.fundName?.includes("金舆"),
)
const svp460VirtualNav = extractNavData(svp460VirtualSubject, svp460VirtualBody)
assert(
  "SVP460 CSC virtual body uses 扣除净值后的单位净值 3.766 (not 未扣除 3.7673)",
  svp460VirtualNav?.navDate === "2026-08-06"
    && svp460VirtualNav?.nav === 3.766
    && svp460VirtualNav?.cumulativeNav === 3.7673
    && svp460VirtualNav?.productCode === "SVP460",
)
const svp460VirtualAtts = selectNavTableAttachments(svp460VirtualSubject, [
  { filename: svp460VirtualFilename, part: "2" },
])
assert("SVP460 CSC 虚拟净值数据 xlsx is selected as NAV attachment", svp460VirtualAtts.length === 1)

{
  // CSC 资产净值公告 label/value form (no date column table).
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ["资产净值公告"],
    ["中信建投证券基金运营业务___专用表"],
    ["2026-08-05"],
    ["  截至2026-08-05,以下基金资产净值如下："],
    ["单位：人民币元"],
    ["基金代码：", "SVP460"],
    ["基金名称：", "墨雪鑫瑞1号私募证券投资基金"],
    ["基金份额累计净值：", "3.7647"],
  ])
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1")
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xls" })
  const formRows = extractNavTableFromBuffer(
    Buffer.from(buf),
    "资产净值公告_SVP460墨雪鑫瑞1号私募证券投资基金_20260805.xls",
    "20260805墨雪鑫瑞1号私募证券投资基金SVP460资产净值公告",
  )
  assert(
    "SVP460 CSC 资产净值公告 form uses 累计净值 as unit when unit missing",
    formRows.length === 1
      && formRows[0]?.navDate === "2026-08-05"
      && formRows[0]?.nav === 3.7647
      && formRows[0]?.cumulativeNav === 3.7647
      && formRows[0]?.productCode === "SVP460",
  )
}

{
  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      "产品代码",
      "产品名称",
      "净值日期",
      "虚拟净值提取前单位净值",
      "参与计提份额",
      "虚拟计提金额",
      "虚拟净值提取后单位净值",
      "虚拟净值提取前累计单位净值",
      "产品净值规模",
    ],
    [
      "SVP460",
      "墨雪鑫瑞1号私募证券投资基金",
      "20260806",
      3.7673,
      1328127.08,
      1726.57,
      3.766,
      3.7673,
      25369312.12,
    ],
  ])
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1")
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })
  const rows = extractNavTableFromBuffer(Buffer.from(buf), svp460VirtualFilename, svp460VirtualSubject)
  assert(
    "SVP460 CSC virtual xlsx prefers 提取后 unit over 提取前",
    rows.length === 1
      && rows[0]?.navDate === "2026-08-06"
      && rows[0]?.nav === 3.766
      && rows[0]?.cumulativeNav === 3.7673
      && rows[0]?.productCode === "SVP460",
  )
}

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

// Citics 【基金虚拟净值表现估值|估算】 + T07998 must remap onto AMAC TG733C / 宁苑沛华.
const tg733cValuationSubject =
  "【基金虚拟净值表现估算】T07998_宁苑沛华稳定增长一号私募证券投资基金C类_2026-08-05_荣熙共赢私募证券投资基金"
const tg733cValuationBody =
  "客户名称 荣熙共赢私募证券投资基金 基金账号 S58007873812 " +
  "估值基准日 2026-08-05 计提方式 TA计提 持仓份额 2,051,928.61 " +
  "虚拟净值 实际净值 实际累计净值 " +
  "2026-08-05 TA计提 2,051,928.61 0 3.9638 3.9638 3.9638"
const tg733cValuationNav = extractNavData(tg733cValuationSubject, tg733cValuationBody)
assert(
  "TG733C Citics 表现估算 remaps T07998→TG733C and stores 实际净值 3.9638",
  tg733cValuationNav?.navDate === "2026-08-05"
    && tg733cValuationNav?.nav === 3.9638
    && tg733cValuationNav?.cumulativeNav === 3.9638
    && tg733cValuationNav?.productCode === "TG733C",
)
assert(
  "T07998 email product-code override maps to TG733C",
  applyEmailProductCodeOverride("T07998", "宁苑沛华稳定增长一号C类", tg733cValuationSubject) === "TG733C",
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

// BSJ74B: history tip still on Jul-13 must not become 最新涨跌幅 when list NAV is Jul-27.
const bsj74bStaleTip = [
  { nav_date: "2026-07-10", nav: 0.9033, return_nav: 1.24376 },
  { nav_date: "2026-07-13", nav: 0.8421, return_nav: 1.182458 },
]
const bsj74bStaleDaily = calcDailyReturnPctFromHistory(bsj74bStaleTip, 0.7241, "2026-07-27", 0.0461)
assert(
  "BSJ74B stale tip must not keep Jul-13 +4.61% as list 最新涨跌幅",
  bsj74bStaleDaily != null && Math.abs(bsj74bStaleDaily - 0.0461) > 0.01,
)
const bsj74bFull = [
  ...bsj74bStaleTip,
  { nav_date: "2026-07-22", nav: 0.715, return_nav: 1.069876 },
  { nav_date: "2026-07-27", nav: 0.7241, return_nav: 1.083493 },
]
const bsj74bDaily = calcDailyReturnPctFromHistory(bsj74bFull, 0.7241, "2026-07-27", null)
assert(
  "BSJ74B list daily matches detail 复权 +1.27%",
  bsj74bDaily != null && Math.abs(bsj74bDaily - 0.012727) < 0.0001,
)
// 估值表-only Jul-23/24 between email Jul-22 and Jul-27 must not become the prev day
// (that yielded list +4.61% = 1.083493/1.03576 - 1 while detail shows +1.27%).
const bsj74bWithValGaps = [
  { nav_date: "2026-07-22", nav: 0.715, return_nav: 1.069876 },
  { nav_date: "2026-07-23", nav: 0.7128, return_nav: 1.066584 },
  { nav_date: "2026-07-24", nav: 0.6922, return_nav: 1.03576 },
  { nav_date: "2026-07-27", nav: 0.7241, return_nav: 1.083493 },
]
const bsj74bValGapDaily = calcDailyReturnPctFromHistory(bsj74bWithValGaps, 0.7241, "2026-07-27", null)
assert(
  "BSJ74B valuation gap days produce the wrong +4.61% (detail excludes them)",
  bsj74bValGapDaily != null && Math.abs(bsj74bValGapDaily - 0.046085) < 0.0001,
)
const bsj74bDetailLike = calcDailyReturnPctFromHistory(bsj74bFull, 0.7241, "2026-07-27", null)
assert(
  "BSJ74B detail-like series (no val gaps) stays +1.27%",
  bsj74bDetailLike != null && Math.abs(bsj74bDetailLike - 0.012727) < 0.0001,
)

// VN917B / 天戈钻选CTA1号B类: valuation tip 2026-07-30 / 1.6350 vs stale parent email
// 2026-06-12 / 1.7792 must NOT become list 最新涨跌幅 (−8.10%).
const vn917bStaleEmail = [
  { nav_date: "2026-06-05", nav: 1.7703, return_nav: 1.7703 },
  { nav_date: "2026-06-12", nav: 1.7792, return_nav: 1.7792 },
]
const vn917bBogus = calcDailyReturnPctFromHistory(vn917bStaleEmail, 1.635, "2026-07-30", null)
assert(
  "VN917B multi-week email gap must not yield −8.10% daily return",
  vn917bBogus == null,
)
assert(
  "VN917B gap exceeds MAX_DAILY_RETURN_LOOKBACK_DAYS",
  (Date.parse("2026-07-30T00:00:00Z") - Date.parse("2026-06-12T00:00:00Z")) / 86_400_000
    > MAX_DAILY_RETURN_LOOKBACK_DAYS,
)
const vn917bValuation = [
  { nav_date: "2026-07-29", nav: 1.6177, return_nav: 1.6177 },
  { nav_date: "2026-07-30", nav: 1.635, return_nav: 1.635 },
]
const vn917bDaily = calcDailyReturnPctFromHistory(vn917bValuation, 1.635, "2026-07-30", null)
assert(
  "VN917B valuation-adjacent series matches detail +1.07%",
  vn917bDaily != null && Math.abs(vn917bDaily - 0.010694) < 0.0001,
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

// Exact 0.05/unit cash dividend (九鞅禾禧五号B类 2023-12-21): float gap is 0.049999…
// and must still be treated as post-dividend so 累计/复权 are not collapsed to 单位.
{
  const hexiManual = [
    { price_date: "2023-11-17", nav: "1.2200", cumulative_nav: "1.2200" },
    { price_date: "2023-11-24", nav: "1.2230", cumulative_nav: "1.2230" },
    { price_date: "2023-12-01", nav: "1.2249", cumulative_nav: "1.2249" },
    { price_date: "2023-12-08", nav: "1.2278", cumulative_nav: "1.2278" },
    { price_date: "2023-12-15", nav: "1.2306", cumulative_nav: "1.2306" },
    { price_date: "2023-12-21", nav: "1.1828", cumulative_nav: "1.2328" },
    { price_date: "2023-12-22", nav: "1.1827", cumulative_nav: "1.2327" },
    { price_date: "2023-12-29", nav: "1.1853", cumulative_nav: "1.2353" },
  ]
  const hexiOut = mergeNavSeriesWithEmail([], hexiManual)
  const hexi21 = hexiOut.find((r) => r.price_date === "2023-12-21")
  const hexi22 = hexiOut.find((r) => r.price_date === "2023-12-22")
  const hexi15 = hexiOut.find((r) => r.price_date === "2023-12-15")
  assert("禾禧五号B 1221 keeps uploaded 累计 1.2328", Math.abs(parseFloat(hexi21.cum_nav_withdrawal) - 1.2328) < 0.0001)
  assert("禾禧五号B 1221 unit stays 1.1828", Math.abs(parseFloat(hexi21.nav) - 1.1828) < 0.0001)
  assert("禾禧五号B 1221 adj >= cum", parseFloat(hexi21.cumulative_nav) + 0.0005 >= parseFloat(hexi21.cum_nav_withdrawal))
  assert("禾禧五号B 1221 not -3.88% unit crash", Math.abs(parseFloat(hexi21.price_change) + 3.88) > 0.5)
  assert(
    "禾禧五号B 1221 daily ~ cum ratio",
    Math.abs(parseFloat(hexi21.price_change) - ((1.2328 / 1.2306 - 1) * 100)) < 0.15,
  )
  assert("禾禧五号B 1222 keeps 累计 gap", Math.abs(parseFloat(hexi22.cum_nav_withdrawal) - 1.2327) < 0.0001)
  assert("禾禧五号B pre-div 1215 unit=cum=adj", hexi15.nav === hexi15.cum_nav_withdrawal && hexi15.nav === hexi15.cumulative_nav)
  console.log("禾禧五号B 0.05 dividend", hexi21)
}

// 九鞅禾瑞十号C类: 0.03 dividend (2023-12-20) then another ~0.05 (2024-12-24 → gap 0.08).
// A 0.05-only gate collapses the 0.03 era to unit=cum and creates a false +2.61% step-up
// when 累计 reappears on the second ex-div.
{
  const heruiC = [
    { price_date: "2023-12-07", nav: "1.0431", cumulative_nav: "1.0431" },
    { price_date: "2023-12-14", nav: "1.0451", cumulative_nav: "1.0451" },
    { price_date: "2023-12-20", nav: "1.0159", cumulative_nav: "1.0459" },
    { price_date: "2023-12-21", nav: "1.0160", cumulative_nav: "1.0460" },
    { price_date: "2023-12-28", nav: "1.0189", cumulative_nav: "1.0489" },
    { price_date: "2024-12-12", nav: "1.1293", cumulative_nav: "1.1593" },
    { price_date: "2024-12-19", nav: "1.1299", cumulative_nav: "1.1599" },
    { price_date: "2024-12-24", nav: "1.0794", cumulative_nav: "1.1594" },
    { price_date: "2024-12-26", nav: "1.0801", cumulative_nav: "1.1601" },
  ]
  const heruiOut = mergeNavSeriesWithEmail([], heruiC)
  const h20 = heruiOut.find((r) => r.price_date === "2023-12-20")
  const h19 = heruiOut.find((r) => r.price_date === "2024-12-19")
  const h24 = heruiOut.find((r) => r.price_date === "2024-12-24")
  assert("禾瑞十号C 2023-12-20 keeps 累计 gap 0.03", Math.abs(parseFloat(h20.cum_nav_withdrawal) - 1.0459) < 0.0001)
  assert("禾瑞十号C 2023-12-20 not -2.79% unit crash", Math.abs(parseFloat(h20.price_change) + 2.79) > 0.5)
  assert("禾瑞十号C 2024-12-19 keeps prior 0.03 gap", Math.abs(parseFloat(h19.cum_nav_withdrawal) - 1.1599) < 0.0001)
  assert("禾瑞十号C 2024-12-19 unit stays 1.1299", Math.abs(parseFloat(h19.nav) - 1.1299) < 0.0001)
  assert("禾瑞十号C 2024-12-24 keeps 累计 1.1594", Math.abs(parseFloat(h24.cum_nav_withdrawal) - 1.1594) < 0.0001)
  assert("禾瑞十号C 2024-12-24 not false +2.61% step-up", Math.abs(parseFloat(h24.price_change) - 2.61) > 0.5)
  assert(
    "禾瑞十号C 2024-12-24 daily ~ cum ratio",
    Math.abs(parseFloat(h24.price_change) - ((1.1594 / 1.1599 - 1) * 100)) < 0.15,
  )
  assert("禾瑞十号C 2024-12-24 adj >= cum", parseFloat(h24.cumulative_nav) + 0.0005 >= parseFloat(h24.cum_nav_withdrawal))
  console.log("禾瑞十号C 0.03+0.05 dividends", { h20, h19, h24 })
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

// CMS/招商 估值表: header 单位净值 must win over 昨日单位净值 (SCJ536 day-shift).
{
  const fromHeader = unitNavFromValuationSummary({
    header_rows: [
      ["SCJ536金舆追风1号私募证券投资基金委托资产资产估值表20260805"],
      [],
      ["招商证券股份有限公司_金舆追风1号私募证券投资基金_专用表"],
      ["日期：2026-08-05", "单位净值:0.9884"],
      ["昨日单位净值:0.9846", "累计单位净值:0.9884"],
    ],
  })
  assert("CMS header unit beats 昨日单位净值", fromHeader === 0.9884)

  const skipPrior = unitNavFromValuationSummary({
    header_rows: [
      ["昨日单位净值:0.9846"],
      ["单位净值:0.9884"],
    ],
  })
  assert("CMS skips prior-day-only header row", skipPrior === 0.9884)

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ["SCJ536金舆追风1号私募证券投资基金委托资产资产估值表20260805"],
    [],
    ["招商证券股份有限公司_金舆追风1号私募证券投资基金_专用表"],
    ["日期：2026-08-05", "单位净值:0.9884"],
    ["科目代码", "科目名称", "市值-本币"],
    ["1002", "银行存款", 3000148.33],
    ["1102", "交易性金融资产", 12838786.38],
    ["", "昨日单位净值", 0.9846],
    ["", "资产合计", 15838973.52],
    ["", "负债合计", 7768.08],
    ["", "资产净值", 15831205.44],
    ["", "实收资本", 16078819.26],
    ["", "单位净值", 0.9846],
  ])
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1")
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xls" })
  const cmsNav = extractNavFromValuationBuffer(
    Buffer.from(buf),
    "SCJ536金舆追风1号私募证券投资基金委托资产资产估值表20260805.xls",
    "【估值表】SCJ536 金舆追风1号私募证券投资基金_20260805",
  )
  assert("CMS extractNav uses header 0.9884 not 昨日/body 0.9846", cmsNav?.nav === 0.9884)
  assert("CMS extractNav date 2026-08-05", cmsNav?.navDate === "2026-08-05")
}

// 华泰 金舆锡泰一号: custody 估值表 is SCQ403, not the TA-virtual underlying SBKM53.
{
  const subject = "SCQ403_金舆锡泰一号私募证券投资基金估值表20260817"
  const filename = "SCQ403_金舆锡泰一号私募证券投资基金_产品估值表_日报_20260817.xls"
  const meta = extractNavMetadata(subject, "")
  assert("Huatai 锡泰 subject code SCQ403", meta.productCode === "SCQ403")
  assert("Huatai 锡泰 subject name 金舆锡泰一号", meta.fundName === "金舆锡泰一号")
  const fileMeta = extractNavMetadata(filename, "")
  assert("Huatai 锡泰 filename code SCQ403", fileMeta.productCode === "SCQ403")
  assert("Huatai daily filename is NAV date", isHuataiDailyValuationSubject(subject, filename) === true)

  const lookup = {
    byProductCode: new Map([
      ["SCQ403", {
        product_code: "SCQ403",
        custody_balance: 9999600,
        net_asset_value: 51954300.54,
        unit_nav: 0.9991,
        valuation_date: "2026-08-17",
      }],
      ["SBKM53", {
        product_code: "SBKM53",
        custody_balance: 50000000,
        net_asset_value: 207135317.39,
        unit_nav: 1.0123,
        valuation_date: "2026-08-17",
      }],
    ]),
    byFundName: new Map([
      ["金舆锡泰一号", {
        product_code: "SBKM53",
        custody_balance: 50000000,
        net_asset_value: 207135317.39,
        unit_nav: 1.0123,
        valuation_date: "2026-08-17",
      }],
    ]),
  }
  const fromCode = resolveEmailFundMetrics("金舆锡泰一号", "SCQ403", lookup)
  assert("锡泰 资产净值 from SCQ403 not SBKM53", fromCode.net_asset_value === 51954300.54)
  const fromWrongAuto = resolveEmailFundMetrics("金舆锡泰一号", "SBKM53", lookup)
  assert("锡泰 ignores auto-resolved SBKM53 AUM", fromWrongAuto.net_asset_value === 51954300.54)
  const nameOnly = resolveEmailFundMetrics("金舆锡泰一号", "SCQ403", {
    byProductCode: new Map(),
    byFundName: lookup.byFundName,
  })
  assert("锡泰 name-match rejects SBKM53 metrics", nameOnly.net_asset_value == null)

  const derived = deriveNetAssetValue({
    net_asset_value: "207135317.39",
    paid_in_capital: "51951118.25",
    unit_nav: "0.9991",
  })
  assert("锡泰 stored 207M AUM yields 实收资本×单位净值", Math.abs((derived ?? 0) - 51951118.25 * 0.9991) < 1)

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    ["SCQ403 金舆锡泰一号私募证券投资基金 产品估值表 日报 20260817"],
    ["华泰证券股份有限公司_金舆锡泰一号私募证券投资基金_专用表"],
    ["日期: 2026-08-17", "单位净值:0.9991"],
    ["科目代码", "科目名称", "币种", "汇率", "数量", "单位成本", "成本", "", "", "行情", "市值", "", "", "估值增值", ""],
    ["", "", "", "", "", "", "原币", "本币", "成本占比", "", "原币", "本币", "市值占比", "原币", "本币"],
    ["1002", "银行存款", "CNY", 1, "", "", 9999600, 0, "", "", 9999600, 0, "", "", ""],
    ["1108", "基金投资", "CNY", 1, "", "", 41954700.54, 0, "", "", 41954700.54, 0, "", "", ""],
    ["", "资产合计", "CNY", 1, "", "", 52000300.54, 0, "", "", 52000300.54, 0, "", "", ""],
    ["", "负债合计", "CNY", 1, "", "", 45999.99, 0, "", "", 45999.99, 0, "", "", ""],
    ["", "资产净值", "CNY", 1, "", "", 51954300.55, 0, "", "", 51954300.55, 0, "", "", ""],
    ["3003", "实收资本", "CNY", 1, 51998118.25, 1, 51998118.25, 0, "", "", 51998118.25, 0, "", "", ""],
    ["", "单位净值", "CNY", 1, "", "", "", "", "", "", 0.9991, 0, "", "", ""],
  ])
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1")
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xls" })
  const parsed = extractValuationFromBuffer(Buffer.from(buf), filename, subject)
  assert("Huatai 锡泰 unit NAV 0.9991", parsed?.unitNav === 0.9991)
  assert("Huatai 锡泰 资产净值 ~51.95M not 207M", parsed?.netAssetValue != null && Math.abs(parsed.netAssetValue - 51954300.55) < 1)
  assert("Huatai 锡泰 date 2026-08-17", parsed?.valuationDate === "2026-08-17")

  const poisoned = XLSX.utils.book_new()
  const poisonedSheet = XLSX.utils.aoa_to_sheet([
    ["SCQ403 金舆锡泰一号私募证券投资基金 产品估值表 日报 20260817"],
    ["华泰证券股份有限公司_金舆锡泰一号私募证券投资基金_专用表"],
    ["日期: 2026-08-17", "单位净值:0.9991"],
    ["科目代码", "科目名称", "币种", "汇率", "数量", "单位成本", "成本", "", "", "行情", "市值", "", "", "估值增值", ""],
    ["", "", "", "", "", "", "原币", "本币", "成本占比", "", "原币", "本币", "市值占比", "原币", "本币"],
    ["1002", "银行存款", "CNY", 1, "", "", 9999600, 0, "", "", 9999600, 0, "", "", ""],
    ["1108", "基金投资", "CNY", 1, 207321907.11, 1, 41954700.54, 0, "", "", 41954700.54, 0, "", "", ""],
    ["", "资产合计", "CNY", 1, "", "", 52000300.54, 0, "", "", 52000300.54, 0, "", "", ""],
    ["", "负债合计", "CNY", 1, "", "", 45999.99, 0, "", "", 45999.99, 0, "", "", ""],
    ["", "资产净值", "CNY", 1, "", "", 207135317.39, 0, "", "", 207135317.39, 0, "", "", ""],
    ["4001", "实收资本", "CNY", 1, 207321907.11, 1, 207321907.11, 0, "", "", 207321907.11, 0, "", "", ""],
    ["", "单位净值", "CNY", 1, "", "", "", "", "", "", 0.9991, 0, "", "", ""],
  ])
  XLSX.utils.book_append_sheet(poisoned, poisonedSheet, "Sheet1")
  const poisonedBuf = XLSX.write(poisoned, { type: "buffer", bookType: "xls" })
  const poisonedParsed = extractValuationFromBuffer(Buffer.from(poisonedBuf), filename, subject)
  assert(
    "Huatai 锡泰 rejects underlying 207M footer AUM",
    poisonedParsed?.netAssetValue != null && Math.abs(poisonedParsed.netAssetValue - 51954300.55) < 1,
  )

  // 8/18-style: footer 资产净值 includes 债券期货合约名义本金 (~240M).
  const futures = XLSX.utils.book_new()
  const futuresSheet = XLSX.utils.aoa_to_sheet([
    ["SCQ403 金舆锡泰一号私募证券投资基金 产品估值表 日报 20260818"],
    ["华泰证券股份有限公司_金舆锡泰一号私募证券投资基金_专用表"],
    ["日期: 2026-08-18", "单位净值:1.0026"],
    ["科目代码", "科目名称", "币种", "汇率", "数量", "单位成本", "成本", "", "", "行情", "市值", "", "", "估值增值", ""],
    ["", "", "", "", "", "", "原币", "本币", "成本占比", "", "原币", "本币", "市值占比", "原币", "本币"],
    ["10020101", "银行存款_活期.华泰托管金舆锡泰一号私募证券投资基金", "CNY", 1, "", "", 5999600, 0, "", "", 5999600, 0, "", "", ""],
    ["1108", "其他交易性金融资产投资", "CNY", 1, "", "", 33007036.33, 0, "", "", 33007036.33, 0, "", "", ""],
    ["102102BFJ_0011", "结算备付金_期货期权备付金.华泰期货", "CNY", 1, "", "", 6675931.6, 0, "", "", 6675931.6, 0, "", "", ""],
    ["31021201TF2612CFX", "中金所_投机_卖方_债券期货_成本.国债2612", "CNY", 1, 80, "", 85284000, 0, "", "", 85284000, 0, "", "", ""],
    ["31021001TL2612CFX", "中金所_投机_买方_债券期货_成本.30年期国债2612", "CNY", 1, 60, "", 70128000, 0, "", "", 70128000, 0, "", "", ""],
    ["31021201T2609CFX", "中金所_投机_卖方_债券期货_成本.10年期国债2609", "CNY", 1, 30, "", 32881500, 0, "", "", 32881500, 0, "", "", ""],
    ["", "资产合计", "CNY", 1, "", "", 240501512.31, 0, "", "", 240501512.31, 0, "", "", ""],
    ["", "资产净值", "CNY", 1, "", "", 240501512.31, 0, "", "", 240501512.31, 0, "", "", ""],
    ["", "单位净值", "CNY", 1, "", "", "", "", "", "", 1.0026, 0, "", "", ""],
  ])
  XLSX.utils.book_append_sheet(futures, futuresSheet, "Sheet1")
  const futuresBuf = XLSX.write(futures, { type: "buffer", bookType: "xls" })
  const futuresParsed = extractValuationFromBuffer(
    Buffer.from(futuresBuf),
    "SCQ403_金舆锡泰一号私募证券投资基金_产品估值表_日报_20260818.xls",
    "SCQ403_金舆锡泰一号私募证券投资基金估值表20260818",
  )
  const expectedExFutures = 5999600 + 33007036.33 + 6675931.6
  assert("Huatai 锡泰 unit NAV 1.0026 with futures rows", futuresParsed?.unitNav === 1.0026)
  assert(
    "Huatai 锡泰 AUM excludes bond-futures notionals",
    futuresParsed?.netAssetValue != null
      && futuresParsed.netAssetValue < 100_000_000
      && Math.abs(futuresParsed.netAssetValue - expectedExFutures) < 1,
  )
}
