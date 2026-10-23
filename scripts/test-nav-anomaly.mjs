import { analyzeNavAnomaly, anomalyScanStart, chartNavLevel, clipRowsOnOrAfterInception, hasNavAnomaly, navAnomalyHit } from "../lib/server/nav-anomaly.ts"
import { diagnoseNavAnomaly } from "../lib/server/nav-anomaly-cause.ts"

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function daily(start, values) {
  const [y, m, d] = start.split("-").map((n) => parseInt(n, 10))
  const out = []
  const cursor = new Date(Date.UTC(y, m - 1, d))
  for (const value of values) {
    const iso = cursor.toISOString().slice(0, 10)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) out.push({ date: iso, value })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const smooth = daily("2026-03-02", [1, 1.005, 1.01, 1.012, 1.008, 1.015, 1.02, 1.018, 1.022, 1.025])
assert(!hasNavAnomaly(smooth), "smooth daily series should pass")

const jump = [
  { date: "2026-03-02", value: 1 },
  { date: "2026-03-03", value: 1.4 },
  { date: "2026-03-04", value: 1.41 },
]
assert(analyzeNavAnomaly(jump).reason === "jump", "40% next-day step is a jump")
assert(analyzeNavAnomaly(jump).snippet.some((p) => p.date === "2026-03-03"), "jump snippet includes the flagged date")
assert(analyzeNavAnomaly(jump).snippet.length >= 2, "jump snippet includes the step")

const shareClass = [
  { date: "2026-03-02", value: 1.09 },
  { date: "2026-03-03", value: 1.45 },
  { date: "2026-03-04", value: 1.46 },
]
assert(hasNavAnomaly(shareClass), "A/B level splice 1.09 → 1.45 should flag")

const mild = [
  { date: "2026-03-02", value: 1 },
  { date: "2026-03-03", value: 1.2 },
  { date: "2026-03-04", value: 1.22 },
]
assert(!hasNavAnomaly(mild), "20% step that stays should not flag")

const spike = [
  { date: "2026-03-02", value: 1 },
  { date: "2026-03-03", value: 1.2 },
  { date: "2026-03-04", value: 1.01 },
]
assert(analyzeNavAnomaly(spike).reason === "spike", "15%+ V shape should flag")
assert(analyzeNavAnomaly(spike).snippet.some((p) => p.date === "2026-03-03"), "spike snippet includes the flagged date")

const smallSpike = [
  { date: "2026-03-02", value: 1 },
  { date: "2026-03-03", value: 1.1 },
  { date: "2026-03-04", value: 1.01 },
]
assert(!hasNavAnomaly(smallSpike), "10% V shape should not flag")

const quietDates = [
  "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
  "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13",
]
const quietSpike = quietDates.map((date, i) => ({
  date,
  value: i === 4 ? 1.1913 : 1.2948 + (i % 3) * 0.0001,
}))
const quietHit = analyzeNavAnomaly(quietSpike)
assert(quietHit.reason === "spike", "8% round trip on a quiet series should flag")
assert(quietHit.date === "2026-03-06", "quiet spike date is the dipped print")

const quietBlip = quietDates.map((date, i) => ({
  date,
  value: i === 4 ? 1.245 : 1.2948,
}))
assert(!hasNavAnomaly(quietBlip), "4% round trip stays under the 5% floor")

const volatile = quietDates.map((date, i) => ({
  date,
  value: i % 2 === 0 ? 1 : 1.08,
}))
assert(!hasNavAnomaly(volatile), "8% round trips are ordinary when every step is that large")

const weekly = [
  { date: "2026-03-06", value: 1 },
  { date: "2026-03-13", value: 1.02 },
  { date: "2026-03-20", value: 1.01 },
  { date: "2026-03-27", value: 1.45 },
]
assert(analyzeNavAnomaly(weekly).reason === "jump", "weekly 45% step should flag")

const weeklyMild = [
  { date: "2026-03-06", value: 1 },
  { date: "2026-03-13", value: 1.02 },
  { date: "2026-03-20", value: 1.05 },
  { date: "2026-03-27", value: 1.2 },
]
assert(!hasNavAnomaly(weeklyMild), "weekly 20% step should not flag")

const hole = daily("2026-03-02", [1, 1.002, 1.004, 1.003, 1.006, 1.008, 1.01, 1.009, 1.011, 1.012])
hole.push({ date: "2026-06-01", value: hole[hole.length - 1].value * 1.4 })
assert(!hasNavAnomaly(hole), "40% across a multi-month hole should not flag")

const doubled = [
  { date: "2026-03-02", value: 1 },
  { date: "2026-03-03", value: 1.01 },
  { date: "2026-03-16", value: 2.2 },
]
assert(analyzeNavAnomaly(doubled).reason === "jump", "doubling within a month should flag")

const oldJump = [
  { date: "2026-01-05", value: 1 },
  { date: "2026-01-06", value: 1.8 },
  { date: "2026-03-02", value: 1.1 },
  { date: "2026-03-03", value: 1.11 },
  { date: "2026-03-04", value: 1.12 },
]
assert(!hasNavAnomaly(oldJump, "2026-03-01"), "jump before 运作日 should be ignored")
assert(hasNavAnomaly(oldJump), "same jump counts when the window includes it")

assert(chartNavLevel({ adjusted: "1.12", cumulative: "1.05", unit: "0.80" }) === 1.12, "复权 wins")
assert(chartNavLevel({ adjusted: "", cumulative: "1.05", unit: "0.80" }) === 1.05, "累计 is next")
assert(chartNavLevel({ adjusted: "0", cumulative: "", unit: "0.80" }) === 0.8, "单位 is last")

const dividend = [
  { date: "2026-03-02", adjusted: "1.10", unit: "1.10" },
  { date: "2026-03-03", adjusted: "1.11", unit: "0.80" },
  { date: "2026-03-04", adjusted: "1.12", unit: "0.81" },
].map((row) => ({ date: row.date, value: chartNavLevel(row) }))
assert(!hasNavAnomaly(dividend), "dividend drop in 单位净值 should not flag when 复权 is smooth")

const sourceJump = [
  { date: "2026-03-02", value: 1, field: "adjusted" },
  { date: "2026-03-03", value: 1.4, field: "adjusted" },
  { date: "2026-03-04", value: 1.41, field: "adjusted" },
]
const sourceHit = navAnomalyHit(sourceJump)
const sourceDiag = diagnoseNavAnomaly(sourceJump, [{
  key: "fof99",
  label: "火富牛",
  points: sourceJump,
}], sourceHit)
assert(sourceDiag.cause === "source", "jump already in one feed is source data")
assert(sourceDiag.source_count === 1, "one feed on the chart")
assert(sourceDiag.cause_label === "源数据异常", "source label")

const smoothA = [
  { date: "2026-03-02", value: 1, field: "adjusted" },
  { date: "2026-03-03", value: 1.01, field: "adjusted" },
]
const smoothB = [
  { date: "2026-03-04", value: 1.5, field: "adjusted" },
  { date: "2026-03-05", value: 1.51, field: "adjusted" },
]
const spliced = [...smoothA, ...smoothB]
const spliceHit = navAnomalyHit(spliced)
const spliceDiag = diagnoseNavAnomaly(spliced, [
  { key: "fof99", label: "火富牛", points: smoothA },
  { key: "email_nav_table", label: "邮件净值表", points: smoothB },
], spliceHit)
assert(spliceDiag.cause === "rules", "splice of two smooth feeds is our merge")
assert(spliceDiag.source_count === 2, "both feeds are used")
assert(spliceDiag.cause_detail.includes("火富牛") && spliceDiag.cause_detail.includes("邮件净值表"), "splice names both feeds")

const rewritten = [
  { date: "2026-03-02", value: 1, field: "unit" },
  { date: "2026-03-03", value: 1.01, field: "unit" },
  { date: "2026-03-04", value: 1.02, field: "unit" },
]
const charted = [
  { date: "2026-03-02", value: 1 },
  { date: "2026-03-03", value: 1.45 },
  { date: "2026-03-04", value: 1.46 },
]
const rewriteHit = navAnomalyHit(charted)
const rewriteDiag = diagnoseNavAnomaly(charted, [{
  key: "email_nav_table",
  label: "邮件净值表",
  points: rewritten,
}], rewriteHit)
assert(rewriteDiag.cause === "rules", "rechained level that is not in the raw column is a calculation")
assert(rewriteDiag.cause_label === "计算或修正导致", "rules label")

const mixedFields = [
  { date: "2026-03-02", value: 1, field: "adjusted" },
  { date: "2026-03-03", value: 1.4, field: "unit" },
]
const mixedChart = [
  { date: "2026-03-02", value: 1 },
  { date: "2026-03-03", value: 1.4 },
]
const mixedHit = navAnomalyHit(mixedChart)
const mixedDiag = diagnoseNavAnomaly(mixedChart, [{
  key: "fof99",
  label: "火富牛",
  points: mixedFields,
}], mixedHit)
assert(mixedDiag.cause === "rules", "复权 and 单位 on different days do not count as one raw step")

const parentBackedChart = [
  { date: "2023-09-14", value: 0.5874 },
  { date: "2023-09-15", value: 1 },
  { date: "2023-09-18", value: 1 },
]
const parentBackedHit = navAnomalyHit(parentBackedChart)
const parentBackedDiag = diagnoseNavAnomaly(parentBackedChart, [{
  key: "fof99",
  label: "火富牛",
  points: [
    { date: "2023-09-14", value: 0.5874, field: "unit" },
    { date: "2023-09-14", value: 0.5874, field: "adjusted" },
    { date: "2023-09-15", value: 1, field: "unit" },
    { date: "2023-09-15", value: 0.5874, field: "adjusted" },
  ],
}], parentBackedHit)
assert(parentBackedDiag.cause === "source", "parent unit step copied onto a share class is source data")
assert(parentBackedDiag.cause_label === "源数据异常", "parent unit step label")

const scaledEmail = [
  { date: "2024-02-02", value: 1.2367, field: "unit" },
  { date: "2024-02-02", value: 1.3367, field: "cumulative" },
  { date: "2024-02-08", value: 0.9214, field: "unit" },
  { date: "2024-02-08", value: 1.0214, field: "cumulative" },
]
const scaledChart = [
  { date: "2024-02-02", value: 1.389048 },
  { date: "2024-02-08", value: 1.034906 },
]
const scaledHit = navAnomalyHit(scaledChart)
assert(scaledHit, "scaled unit series is still a jump")
const scaledDiag = diagnoseNavAnomaly(scaledChart, [{
  key: "email_other",
  label: "邮件净值",
  points: scaledEmail,
}], scaledHit)
assert(scaledDiag.cause === "source", "fixed 复权 scale of a raw unit jump is source data")
assert(scaledDiag.cause_label === "源数据异常", "scaled unit jump label")
assert(scaledDiag.cause_detail.includes("邮件净值"), "scaled unit jump names the email feed")

const cumulativeOnly = diagnoseNavAnomaly(scaledChart, [{
  key: "email_other",
  label: "邮件净值",
  points: scaledEmail.filter((point) => point.field === "cumulative"),
}], scaledHit)
assert(cumulativeOnly.cause === "rules", "累计 return that differs from the chart stays a calculation")

const emptyDiag = diagnoseNavAnomaly(charted, [], rewriteHit)
assert(emptyDiag.cause === "unknown", "no raw feeds stays unknown")

const snd172Prefix = [
  { date: "2020-11-06", value: 2.170941 },
  { date: "2020-11-13", value: 2.16499 },
  { date: "2020-11-20", value: 1 },
  { date: "2020-11-27", value: 0.9998 },
]
assert(analyzeNavAnomaly(snd172Prefix).reason === "jump", "SND172 splice is a jump before the inception window")
assert(anomalyScanStart(snd172Prefix, null, "2020-11-17") === "2020-11-17", "scan starts at 成立日")
assert(navAnomalyHit(snd172Prefix, anomalyScanStart(snd172Prefix, null, "2020-11-17")) == null, "成立日 window drops the pre-inception splice")
assert(anomalyScanStart(snd172Prefix, "2020-12-01", "2020-11-17") === "2020-12-01", "运作日 after 成立日 still wins")
const laterJump = [
  ...snd172Prefix,
  { date: "2020-12-04", value: 1.5 },
  { date: "2020-12-11", value: 1.51 },
]
assert(
  navAnomalyHit(laterJump, anomalyScanStart(laterJump, null, "2020-11-17"))?.date === "2020-12-04",
  "a jump after 成立日 is still flagged",
)
const clipped = clipRowsOnOrAfterInception([
  { price_date: "2018-08-24" },
  { price_date: "2020-11-13" },
  { price_date: "2020-11-20" },
  { price_date: "2020-11-27" },
], "2020-11-17")
assert(clipped.length === 2 && clipped[0].price_date === "2020-11-20", "chart drops the prefix and keeps the fund's own prints")
assert(
  clipRowsOnOrAfterInception([{ price_date: "2020-01-01" }], "2030-01-01")[0].price_date === "2020-01-01",
  "a 成立日 that would blank the series is ignored",
)

console.log("nav-anomaly ok")
