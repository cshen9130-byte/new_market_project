import assert from "node:assert/strict"
import test from "node:test"
import { atmIvSpikeDesk, atmIvSpikeHref, atmIvSpikeHrefForDedupe, atmIvSpikeMessage, atmIvSpikes, barsWithSessionCloses } from "./index-atm-iv-spike"

function bars(values: number[]): { date: string; value: number }[] {
  return values.map((value, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    value,
  }))
}

test("ordinary moves and an old spike stay quiet", () => {
  assert.equal(atmIvSpikes({ product: "IH", name: "上证50", bars: bars([14, 15, 16, 15, 14, 16]) }), null)
  assert.equal(atmIvSpikes({
    product: "IH",
    name: "上证50",
    bars: bars([40, 12, 13, 14, 15, 16, 17]),
  }), null)
  assert.equal(atmIvSpikes({
    product: "IH",
    name: "上证50",
    bars: bars([10, 25, 20, 18, 16, 15]),
  }), null)
})

test("a synthetic daily print does not alert when the session close did not spike", () => {
  const bars = [
    { date: "2026-11-11", value: 28.23 },
    { date: "2026-11-12", value: 28.61 },
    { date: "2026-11-13", value: 29.21 },
    { date: "2026-11-16", value: 32.74 },
    { date: "2026-11-17", value: 34.33 },
    { date: "2026-11-18", value: 66.22 },
  ]
  const closes = new Map<string, number>([
    ["2026-11-11", 28.23],
    ["2026-11-12", 28.61],
    ["2026-11-13", 29.21],
    ["2026-11-16", 32.74],
    ["2026-11-17", 34.33],
    ["2026-11-18", 34.6],
  ])
  const raw = atmIvSpikes({ product: "IM", name: "中证1000", bars })
  assert.equal(raw?.peakDate, "2026-11-18")
  assert.equal(raw?.peak, 66.22)
  assert.equal(atmIvSpikes({
    product: "IM",
    name: "中证1000",
    bars: barsWithSessionCloses(bars, closes),
  }), null)
})

test("a 5-day jump above 15 points names the peak and opens the IV charts", () => {
  const spike = atmIvSpikes({
    product: "IM",
    name: "中证1000",
    bars: bars([20, 22, 48, 30, 24, 21]),
  })
  assert.equal(spike?.peakDate, "2026-11-03")
  assert.equal(spike?.baseDate, "2026-11-01")
  const message = spike ? atmIvSpikeMessage(spike) : null
  assert.equal(message?.title, "2026-11-03 中证1000平值隐含波动率尖峰")
  assert.match(message?.body ?? "", /日线近 5 个交易日 QVIX 最高 48\.00%/)
  assert.match(message?.body ?? "", /高出 28\.00 个点/)
  assert.equal(message?.href, atmIvSpikeHref("IM"))
  assert.equal(atmIvSpikeDesk(message?.href ?? "")?.product, "IM")
  assert.equal(atmIvSpikeDesk("view=pro&product=nope&desk=season"), null)
  assert.equal(message?.dedupeKey, "index_atm_iv_spike:IM:2026-11-03")
  assert.equal(atmIvSpikeHrefForDedupe("index_atm_iv_spike:IC:2026-11-18"), atmIvSpikeHref("IC"))
  assert.equal(atmIvSpikeHrefForDedupe("other:IC:2026-11-18"), null)
})
