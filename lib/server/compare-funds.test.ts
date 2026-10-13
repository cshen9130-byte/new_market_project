import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildCompareReport,
  distinctFundFamilies,
  groupByTeamStrategy,
  incompleteWindows,
  nameBindsToQuery,
  parseCompareSubject,
  passageNamesFund,
  shareClassParentCandidates,
} from "./compare-funds"

describe("share-class parent codes", () => {
  it("binds SB595C to SSB595 and not to SB5957", () => {
    const hit = shareClassParentCandidates("SB595C")
    assert.equal(hit?.letter, "C")
    assert.equal(hit?.parents[0], "SSB595")
    assert.equal(hit?.parents.includes("SB5957"), false)
    assert.equal(shareClassParentCandidates("SB5957"), null)
    assert.equal(shareClassParentCandidates("SGE516"), null)
  })

  it("reads C类 as a share of the base name", () => {
    const parsed = parseCompareSubject("众量资产聚宝19号C类")
    assert.equal(parsed.shareClass, "C")
    assert.equal(parsed.baseName, "众量资产聚宝19号")
    assert.equal(parsed.registerCode, null)
  })
})

describe("name binding", () => {
  it("accepts 聚宝19号 and rejects 聚宝4号", () => {
    assert.equal(nameBindsToQuery("众量资产聚宝19号C类", "众量资产聚宝19号私募证券投资基金", null), true)
    assert.equal(nameBindsToQuery("众量资产聚宝19号", "聚宝19号", null), true)
    assert.equal(nameBindsToQuery("众量资产聚宝19号C类", "众量资产聚宝4号", null), false)
    assert.equal(nameBindsToQuery("诚奇浦江CTA1号", "诚奇浦江CTA10号", null), false)
    assert.equal(nameBindsToQuery("诚奇浦江CTA1号", "诚奇浦江CTA1号", null), true)
  })
})

describe("incomplete windows", () => {
  it("marks long windows for a fund that is only two weeks old", () => {
    const windows = incompleteWindows("2026-09-28", "2026-10-12")
    assert.deepEqual(windows, ["ret_1m", "ret_3m", "ret_6m", "ret_1y", "sharpe_1y", "calmar_1y"])
  })

  it("leaves a five-year fund unmarked", () => {
    assert.deepEqual(incompleteWindows("2021-10-15", "2026-10-09"), [])
  })

  it("marks 3m, 6m and 1y when the fund is about six weeks old", () => {
    const windows = incompleteWindows("2026-08-26", "2026-10-09")
    assert.ok(windows.includes("ret_3m"))
    assert.ok(windows.includes("ret_6m"))
    assert.ok(windows.includes("ret_1y"))
    assert.equal(windows.includes("ret_1w"), false)
    assert.equal(windows.includes("ret_1m"), false)
  })
})

describe("strategy groups", () => {
  it("refuses a same-strategy ranking when the three funds differ", () => {
    const grouped = groupByTeamStrategy([
      { register_number: "SGE516", strategy_l1: null, strategy_l2: null, strategy_l3: null },
      { register_number: "SEJ748", strategy_l1: "股票对冲", strategy_l2: "股票市场中性", strategy_l3: "300中性、高频" },
      { register_number: "SSB595", strategy_l1: "期货策略", strategy_l2: "量化期货", strategy_l3: "时序" },
    ])
    assert.equal(grouped.same_strategy, false)
    assert.equal(grouped.groups.length, 3)
    assert.ok(grouped.groups.some((group) => group.strategy === "未填写" && group.register_numbers.includes("SGE516")))
  })

  it("treats two empty strategy fields as not the same strategy", () => {
    const grouped = groupByTeamStrategy([
      { register_number: "A", strategy_l1: null, strategy_l2: null, strategy_l3: null },
      { register_number: "B", strategy_l1: "", strategy_l2: null, strategy_l3: null },
    ])
    assert.equal(grouped.same_strategy, false)
  })
})

describe("notes and report", () => {
  it("keeps a note only when it names that fund", () => {
    assert.equal(passageNamesFund("诚奇浦江CTA1号近一年表现平稳", ["诚奇浦江CTA1号"], "SSB595"), true)
    assert.equal(passageNamesFund("备案号 SSB595", ["诚奇浦江CTA1号"], "SSB595"), true)
    assert.equal(passageNamesFund("聚宝4号是高频中性", ["众量资产聚宝19号"], "SEJ748"), false)
  })

  it("does not invent a track record when strategies differ", () => {
    const report = buildCompareReport({
      same_strategy: false,
      groups: [
        { strategy: "未填写", register_numbers: ["SGE516"] },
        { strategy: "股票对冲 / 股票市场中性 / 300中性、高频", register_numbers: ["SEJ748"] },
        { strategy: "期货策略 / 量化期货 / 时序", register_numbers: ["SSB595"] },
      ],
      bindings: [{
        query: "众量资产聚宝19号C类",
        register_number: "SEJ748",
        fund_name: "众量资产聚宝19号",
        match: "name",
        match_score: 1,
        share_class: "C",
        nav_loaded: true,
        nav_scope: "parent",
      }],
      funds: [{
        register_number: "SGE516",
        fund_name: "君翊驭风七号",
        manager: "常州君翊投资管理有限公司",
        strategy: "未填写",
        strategy_l1: null,
        strategy_l2: null,
        strategy_l3: null,
        inception_date: "2026-09-28",
        latest_nav: 1,
        latest_nav_date: "2026-10-12",
        share_class: null,
        nav_scope: "self",
        metrics: {
          ret_1w: 0,
          ret_1m: 0,
          ret_3m: 0,
          ret_6m: 0,
          ret_1y: 0,
          sharpe_1y: null,
          calmar_1y: null,
        },
        incomplete_windows: ["ret_1m", "ret_3m", "ret_6m", "ret_1y", "sharpe_1y", "calmar_1y"],
      }],
      notes: [],
    })
    assert.match(report, /未做同策略排序/)
    assert.doesNotMatch(report, /10\.68/)
    assert.doesNotMatch(report, /配置权重/)
    assert.match(report, /SEJ748/)
    assert.match(report, /不是单独的C类净值序列/)
    assert.match(report, /0 未满/)
    assert.doesNotMatch(report, /## 投资笔记/)
  })
})

describe("families", () => {
  it("keeps 诚奇 and 涵崧 apart", () => {
    assert.equal(distinctFundFamilies(["SSB595", "SB5957"]).length, 2)
    assert.equal(distinctFundFamilies(["SALF51", "ALF51"]).length, 1)
  })
})
