import assert from "node:assert/strict"
import test from "node:test"
import { INDEX_QUARTER_BASIS_HREF, INDEX_QUARTER_BASIS_LIMIT, indexQuarterBasisMessage } from "./index-quarter-basis"

const quiet = [
  { product: "IH", name: "上证50", date: "2026-11-06", value: -6.08 },
  { product: "IF", name: "沪深300", date: "2026-11-06", value: -6.51 },
  { product: "IC", name: "中证500", date: "2026-11-06", value: -7.89 },
  { product: "IM", name: "中证1000", date: "2026-11-06", value: -8.27 },
]

test("a day stays quiet when every near-quarter basis is at or below -5", () => {
  assert.equal(indexQuarterBasisMessage(quiet), null)
  assert.equal(indexQuarterBasisMessage([
    { product: "IF", name: "沪深300", date: "2026-11-06", value: INDEX_QUARTER_BASIS_LIMIT },
  ]), null)
  assert.equal(indexQuarterBasisMessage([]), null)
})

test("one near-quarter print above -5 names that index and opens the quarter charts", () => {
  const message = indexQuarterBasisMessage([
    ...quiet,
    { product: "IF", name: "沪深300", date: "2026-11-09", value: -4.2 },
    { product: "IH", name: "上证50", date: "2026-11-06", value: -1 },
  ])
  assert.equal(message?.date, "2026-11-09")
  assert.equal(message?.title, "2026-11-09 近季年化基差高于 -5%")
  assert.match(message?.body ?? "", /沪深300（IF）近季 -4\.20%。/)
  assert.doesNotMatch(message?.body ?? "", /上证50/)
  assert.equal(message?.href, INDEX_QUARTER_BASIS_HREF)
})

test("a positive basis is included", () => {
  const message = indexQuarterBasisMessage([
    { product: "IC", name: "中证500", date: "2026-11-09", value: 1.25 },
  ])
  assert.match(message?.body ?? "", /中证500（IC）近季 \+1\.25%。/)
})
