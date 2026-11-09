import assert from "node:assert/strict"
import test from "node:test"
import { buildMomSignals, type SleevePct } from "./ma/quant-vs-subjective-signals"
import { briefingDecisionHits, momDecisionSignalMessage } from "./mom-decision-signal"

function sleeve(risk: number): SleevePct {
  return { riskPctGroup: risk, equityPctGroup: 0, riskPctBook: 0, equityPctBook: 0 }
}

test("the latest briefing marks a shared heavy position as 加码", () => {
  const hits = briefingDecisionHits({
    date: "2026-11-06",
    sectors: [{ key: "能源化工", name: "能源化工", quant: sleeve(10), subjective: sleeve(10) }],
    products: [{ key: "MA", name: "甲醇", sector: "能源化工", quant: sleeve(9), subjective: sleeve(9) }],
    quantShare: 40,
    quantAccounts: 4,
    subjectiveAccounts: 6,
  })
  assert.equal(hits.find((hit) => hit.name === "能源化工")?.action, "加码")
  assert.equal(hits.find((hit) => hit.name === "甲醇(MA)")?.action, "加码")
  const message = momDecisionSignalMessage({ date: "2026-11-06", hits, actions: ["加码"] })
  assert.match(message?.title ?? "", /决策信号出现加码/)
  assert.match(message?.body ?? "", /板块 能源化工 的建议是加码/)
  assert.match(message?.body ?? "", /品种 甲醇\(MA\) 的建议是加码/)
  assert.equal(message?.href, "/ma/dashboard/mom-analysis/trader-analysis?tab=quant-vs-subjective")
})

test("a report without 加码 stays quiet until the account adds that suggestion", () => {
  const hits = [
    { level: "sector" as const, name: "农产", action: "观望" },
    { level: "product" as const, name: "生猪(LH)", action: "补风格" },
  ]
  assert.equal(momDecisionSignalMessage({ date: "2026-11-06", hits, actions: ["加码"] }), null)
  const wider = momDecisionSignalMessage({ date: "2026-11-06", hits, actions: ["加码", "观望"] })
  assert.match(wider?.body ?? "", /农产 的建议是观望/)
  assert.equal(wider?.body.includes("生猪"), false)
})

test("buildMomSignals agrees that a light same-direction book is not 加码", () => {
  const signals = buildMomSignals(
    [{ key: "农产", name: "农产", quant: sleeve(2), subjective: sleeve(2) }],
    [],
    "risk",
    40,
    4,
    6,
    undefined,
    { includeNeutral: true, limit: 0 },
  )
  assert.equal(signals.find((signal) => signal.key === "农产")?.action, "中性")
})
