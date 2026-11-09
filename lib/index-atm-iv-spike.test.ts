import assert from "node:assert/strict"
import test from "node:test"
import { INDEX_ATM_IV_SPIKE_HREF, atmIvSpikeMessage, atmIvSpikes } from "./index-atm-iv-spike"

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
  assert.match(message?.body ?? "", /最高 48\.00%/)
  assert.match(message?.body ?? "", /高出 28\.00 个点/)
  assert.equal(message?.href, INDEX_ATM_IV_SPIKE_HREF)
  assert.equal(message?.dedupeKey, "index_atm_iv_spike:IM:2026-11-03")
})
