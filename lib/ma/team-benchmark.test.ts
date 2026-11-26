/**
 *   npx tsx --test lib/ma/team-benchmark.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveDefaultBenchmarkKey, teamBenchmarkOptionsForStrategy } from "./team-benchmark"

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

  it("uses a ChinaBond wealth index for bond strategies", () => {
    assert.equal(
      resolveDefaultBenchmarkKey({ strategyL1: "债券策略", strategyL2: "利率债", strategyL3: "套利" }),
      "CBA00601.CS",
    )
    assert.equal(
      resolveDefaultBenchmarkKey({ strategyL1: "债券策略", strategyL2: "信用债" }),
      "CBA02701.CS",
    )
    assert.equal(
      resolveDefaultBenchmarkKey({ strategyL1: "债券策略", strategyL2: "债券混合", strategyL3: "可转债" }),
      "000832.SH",
    )
    assert.equal(resolveDefaultBenchmarkKey({ strategyL1: "债券策略" }), "CBA00201.CS")
  })

  it("maps bond benchmark labels onto the stored series", () => {
    assert.equal(
      resolveDefaultBenchmarkKey({ teamBenchmark: "中债综合财富", strategyL1: "债券策略", strategyL2: "利率债" }),
      "CBA00201.CS",
    )
    assert.equal(resolveDefaultBenchmarkKey({ teamBenchmark: "上证国债" }), "000012.SH")
    assert.equal(resolveDefaultBenchmarkKey({ teamBenchmark: "中证全债" }), "H11001.CSI")
    assert.equal(resolveDefaultBenchmarkKey({ teamBenchmark: "上证企债" }), "000013.SH")
    assert.equal(resolveDefaultBenchmarkKey({ teamBenchmark: "十年国债ETF" }), "511260.SH")
    assert.equal(resolveDefaultBenchmarkKey({ teamBenchmark: "国债ETF" }), "511010.SH")
  })

  it("lists bond benchmarks first for a bond strategy", () => {
    const options = teamBenchmarkOptionsForStrategy("债券策略")
    assert.deepEqual(options.slice(0, 3), ["中债综合财富", "中债国债财富", "中债信用债财富"])
    assert.ok(options.includes("沪深300"))
    assert.equal(teamBenchmarkOptionsForStrategy("股票多头")[0], "沪深300")
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