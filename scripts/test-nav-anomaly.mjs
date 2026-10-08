import { analyzeNavAnomaly, chartNavLevel, hasNavAnomaly } from "../lib/server/nav-anomaly.ts"

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

console.log("nav-anomaly ok")
