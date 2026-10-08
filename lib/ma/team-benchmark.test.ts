/**
 *   npx tsx --test lib/ma/team-benchmark.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveDefaultBenchmarkKey } from "./team-benchmark"

describe("resolveDefaultBenchmarkKey", () => {
  it("uses CSI 1000 for a 1000 index-enhancement product", () => {
    assert.equal(
      resolveDefaultBenchmarkKey({
        strategyL1: "股票多头",
        strategyL2: "指数增强",
        strategyL3: "1000指增",
        productName: "芬德-环翼量化指增1号",
      }),
      "IM",
    )
  })

  it("keeps an explicit team benchmark ahead of the strategy label", () => {
    assert.equal(
      resolveDefaultBenchmarkKey({
        teamBenchmark: "沪深300",
        strategyL1: "股票多头",
        strategyL3: "1000指增",
      }),
      "IF",
    )
  })

  it("does not treat A500 index enhancement as CSI 500", () => {
    assert.equal(
      resolveDefaultBenchmarkKey({
        strategyL1: "股票多头",
        strategyL3: "A500指增",
      }),
      "000510.SH",
    )
  })

  it("uses CSI 500 for 500 index enhancement and CSI 300 for plain equity", () => {
    assert.equal(
      resolveDefaultBenchmarkKey({ strategyL1: "股票多头", strategyL3: "500指增" }),
      "IC",
    )
    assert.equal(
      resolveDefaultBenchmarkKey({ strategyL1: "股票多头", productName: "某某价值1号" }),
      "IF",
    )
  })
})