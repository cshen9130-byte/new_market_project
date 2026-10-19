import { analyzeInteriorNavGap } from "../lib/server/nav-interior-gap.ts"
import { diagnoseInteriorNavGap } from "../lib/server/nav-gap-cause.ts"

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function weekdays(start, end) {
  const out = []
  const cursor = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cursor <= last) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

const chart = [...weekdays("2026-03-02", "2026-03-31"), ...weekdays("2026-07-01", "2026-07-15")]
const stats = analyzeInteriorNavGap(chart)
assert(stats.gapped, "March-to-July hole should exceed 1/10")
assert(stats.holes.length >= 1, "the hole is listed")
assert(stats.holes.some((hole) => hole.from <= "2026-03-31" && hole.to >= "2026-07-01"), "hole spans the empty stretch")

const sourceGap = diagnoseInteriorNavGap(chart, [{
  key: "fof99",
  label: "火富牛",
  dates: chart,
}])
assert(sourceGap.cause === "source", "a hole already in the raw feed is a source gap")
assert(sourceGap.cause_label === "源数据缺失", "source label")
assert(sourceGap.cause_detail.includes("各原始源同样没有"), "source detail names the empty stretch")
assert(sourceGap.holes[0].missing >= sourceGap.holes.at(-1).missing, "widest hole is first")
assert(sourceGap.source_count === 1, "the overlapping feed is counted")

const filled = diagnoseInteriorNavGap(chart, [{
  key: "fof99",
  label: "火富牛",
  dates: weekdays("2026-03-02", "2026-07-15"),
}])
assert(filled.cause === "rules", "dates the chart dropped are a calculation gap")
assert(filled.cause_label === "计算或修正导致", "rules label")
assert(filled.cause_detail.includes("火富牛"), "rules detail names the feed that still has the dates")
assert(filled.cause_detail.includes("未采用"), "rules detail says the chart did not use them")

const partial = diagnoseInteriorNavGap(chart, [{
  key: "fof99",
  label: "火富牛",
  dates: [...chart, ...weekdays("2026-04-01", "2026-04-30")],
}])
assert(partial.cause === "source", "a few source dates that leave the series over 1/10 stay a source gap")
assert(partial.cause_detail.includes("补上后仍超过一成"), "partial fill is called out")

const smooth = diagnoseInteriorNavGap(weekdays("2026-03-02", "2026-03-31"), [{
  key: "fof99",
  label: "火富牛",
  dates: weekdays("2026-03-02", "2026-03-31"),
}])
assert(smooth.cause === "unknown", "a complete series is not diagnosed as a gap")
assert(smooth.cause_detail === "未发现中间缺失", "complete series detail")

const unread = diagnoseInteriorNavGap(chart, [])
assert(unread.cause === "unknown", "no raw feed cannot choose a cause")
assert(unread.cause_detail.includes("没有读到原始净值"), "unread detail")
assert(unread.holes.length >= 1, "the hole is still shown when the cause is unknown")

console.log("nav gap cause ok")
