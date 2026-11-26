/**
 *   npx tsx --test lib/ma/xiaohe-weekly-rows.test.ts
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  chooseXiaoheMetrics,
  emptyXiaohePeriods,
  joinWeeklyRowSources,
  WEEKLY_ROW_SOURCE,
  hasXiaoheComparable,
  indexXiaoheCatalog,
  isXiaoheIndexName,
  matchXiaoheCatalog,
  imaDisplayName,
  mergeXiaoheComparable,
  mergeXiaoheOcrRows,
  parseImaRankGrid,
  parseXiaoheOcrGrid,
  xiaoheNameKey,
  xiaoheStrategyBucket,
  type XiaoheComparable,
} from "./xiaohe-weekly-rows"

function comparable(partial: Partial<XiaoheComparable> = {}): XiaoheComparable {
  return {
    ret: { ...emptyXiaohePeriods(), ...partial.ret },
    excess: { ...emptyXiaohePeriods(), ...partial.excess },
    excess_dd_6m: partial.excess_dd_6m ?? null,
    excess_dd_1y: partial.excess_dd_1y ?? null,
    sharpe_1y: partial.sharpe_1y ?? null,
    calmar_1y: partial.calmar_1y ?? null,
  }
}

describe("来源", () => {
  it("lists every source once, in a stable order", () => {
    assert.equal(
      joinWeeklyRowSources([WEEKLY_ROW_SOURCE.xiaohe, WEEKLY_ROW_SOURCE.pool, WEEKLY_ROW_SOURCE.pool]),
      "跟踪池/小荷公众号",
    )
    assert.equal(
      joinWeeklyRowSources([WEEKLY_ROW_SOURCE.public, WEEKLY_ROW_SOURCE.xiaohe, WEEKLY_ROW_SOURCE.pool]),
      "跟踪池/公募指增/小荷公众号",
    )
  })
})

describe("xiaohe strategy bucket", () => {
  it("strips tenure and returns glued onto the strategy label", () => {
    assert.equal(xiaoheStrategyBucket("300指增7.48"), "300指增")
    assert.equal(xiaoheStrategyBucket("300指增-0.78%12.95%"), "300指增")
    assert.equal(xiaoheStrategyBucket("A500指增1.96"), "A500指增")
    assert.equal(xiaoheStrategyBucket("1000指增3.87"), "1000指增")
    assert.equal(xiaoheStrategyBucket("500指增4.84"), "500指增")
  })

  it("drops a cell that merged two products", () => {
    assert.equal(xiaoheStrategyBucket("300指增3.921.41"), null)
    assert.equal(xiaoheStrategyBucket("量化CTA"), null)
    assert.equal(xiaoheStrategyBucket("债券"), null)
    assert.equal(xiaoheStrategyBucket("未分类"), null)
  })

  it("maps stock strategies onto weekly-review buckets", () => {
    assert.equal(xiaoheStrategyBucket("市场中性"), "量化中性")
    assert.equal(xiaoheStrategyBucket("量化择时"), "择时择股")
    assert.equal(xiaoheStrategyBucket("主观多头"), "主观多头")
    assert.equal(xiaoheStrategyBucket("量化股票"), "量化选股")
    assert.equal(xiaoheStrategyBucket("全指指增"), "中证全指指增")
    assert.equal(xiaoheStrategyBucket("红利指增"), "红利指增")
  })
})

describe("xiaohe name key", () => {
  it("treats the official suffix and a Chinese serial as the same product", () => {
    assert.equal(
      xiaoheNameKey("盛冠达沪深300指数增强2号"),
      xiaoheNameKey("盛冠达沪深300指数增强2号私募证券投资基金"),
    )
    assert.equal(xiaoheNameKey("玉数涵瑞二号"), xiaoheNameKey("玉数涵瑞2号"))
    assert.equal(xiaoheNameKey("子午300指数增强—号"), xiaoheNameKey("子午300指数增强一号"))
  })

  it("recognises benchmark rows", () => {
    assert.equal(isXiaoheIndexName("沪深300指数"), true)
    assert.equal(isXiaoheIndexName("盛冠达沪深300指数增强2号"), false)
  })
})

describe("口径", () => {
  it("keeps database excess and does not fill it with an absolute week return", () => {
    const database = comparable({ excess: { ...emptyXiaohePeriods(), ret_1m: 0.02 } })
    const absoluteWeek = comparable({ ret: { ...emptyXiaohePeriods(), ret_1w: 0.01 } })
    assert.equal(hasXiaoheComparable("excess", database), true)
    assert.equal(chooseXiaoheMetrics("excess", database, absoluteWeek), "database")
    assert.equal(chooseXiaoheMetrics("excess", comparable(), absoluteWeek), null)
  })

  it("fills only the empty column, and only from the same 口径", () => {
    const database = comparable({
      excess: { ...emptyXiaohePeriods(), ret_1m: 0.01 },
    })
    const published = comparable({
      ret: { ...emptyXiaohePeriods(), ret_1w: -0.03, ret_1y: 0.2 },
      excess: { ...emptyXiaohePeriods(), ret_1w: 0.027, ret_1y: -0.008 },
    })
    const merged = mergeXiaoheComparable("excess", database, published)
    assert.ok(Math.abs((merged?.excess.ret_1m ?? 0) - 0.01) < 1e-9)
    assert.ok(Math.abs((merged?.excess.ret_1w ?? 0) - 0.027) < 1e-9)
    assert.ok(Math.abs((merged?.excess.ret_1y ?? 0) + 0.008) < 1e-9)
    assert.equal(merged?.ret.ret_1w, null)
  })

  it("uses a published number only when it is the sheet's 口径", () => {
    const absoluteWeek = comparable({ ret: { ...emptyXiaohePeriods(), ret_1w: -0.0078 } })
    const excessWeek = comparable({ excess: { ...emptyXiaohePeriods(), ret_1w: 0.0076 } })
    assert.equal(chooseXiaoheMetrics("absolute", null, absoluteWeek), "published")
    assert.equal(chooseXiaoheMetrics("excess", null, excessWeek), "published")
    assert.equal(chooseXiaoheMetrics("excess", null, absoluteWeek), null)
    assert.equal(
      chooseXiaoheMetrics("absolute", comparable({ ret: { ...emptyXiaohePeriods(), ret_1y: 0.2 } }), absoluteWeek),
      "database",
    )
  })
})

describe("ocr sheet", () => {
  const absolute = [
    ["基金简称", "管理人", "管理规模", "策略", "近1周", "今年", "近1月"],
    ["", "", "", "存续时间", "成立以来收益最大回撤", "", "近3月近6月近1年近2年近3年"],
    ["玉数涵瑞沪深300指数增强二号", "玉数", "100亿以上", "300指增7.48", "41.34%-35.93%-0.78%", "12.95%", "-3.69%-8.72%-9.07%21.94%6.39%-13.90%"],
    ["沪深300指数", "沪深300指数", "", "300指增", "-1.54%", "-14.59%", "-5.27%-13.82%-18.51%-13.81%-0.56%10.83%"],
    ["星阔南山1号红利低波100指数增强A", "星阔", "10~20亿", "红利指增2.60", "30.31%-13.43%1.45%", "6.05%", "2.42%2.10%0.22%3.85%21.24%"],
  ]
  const excess = [
    ["产品名称", "管理人", "管理规模", "策略", "2025超额"],
    ["", "", "", "本周收益今年收益", "本周超额今年超额"],
    ["玉数涵瑞沪深300指数增强二号", "玉数", "100亿以上", "300指增-0.78%12.95%", "0.76%27.54%"],
    ["沪深300指数", "沪深300指数", "", "300指增-1.54%-14.59%", "0.00%"],
  ]

  it("reads absolute windows and leaves 今年以来 and tenure out", () => {
    const parsed = parseXiaoheOcrGrid(absolute)
    assert.equal(parsed.kind, "absolute")
    const row = parsed.rows[0]
    assert.ok(Math.abs((row?.ret.ret_1w ?? 0) + 0.0078) < 1e-9)
    assert.ok(Math.abs((row?.ret.ret_1m ?? 0) + 0.0369) < 1e-9)
    assert.ok(Math.abs((row?.ret.ret_3m ?? 0) + 0.0872) < 1e-9)
    assert.ok(Math.abs((row?.ret.ret_6m ?? 0) + 0.0907) < 1e-9)
    assert.ok(Math.abs((row?.ret.ret_1y ?? 0) - 0.2194) < 1e-9)
    assert.equal(row?.excess1w, null)
    const short = parsed.rows.find((item) => item.product.startsWith("星阔"))
    assert.ok(Math.abs((short?.ret.ret_1w ?? 0) - 0.0145) < 1e-9)
    assert.ok(Math.abs((short?.ret.ret_1m ?? 0) - 0.0242) < 1e-9)
    assert.ok(Math.abs((short?.ret.ret_1y ?? 0) - 0.0385) < 1e-9)
  })

  it("reads week excess and does not treat 今年超额 as 近一年", () => {
    const parsed = parseXiaoheOcrGrid(excess)
    assert.equal(parsed.kind, "excess")
    const row = parsed.rows[0]
    assert.ok(Math.abs((row?.ret.ret_1w ?? 0) + 0.0078) < 1e-9)
    assert.equal(row?.ret.ret_1y, null)
    assert.ok(Math.abs((row?.excess1w ?? 0) - 0.0076) < 1e-9)
  })

  it("repairs a lost decimal and a shifted excess cell", () => {
    const sheet = [
      ["基金简称", "管理人", "管理规模", "策略", "近1周", "今年", "近1月"],
      ["", "", "", "存续时间", "成立以来收益最大回撤", "", "近3月近6月近1年"],
      ["中证2000指数", "", "", "2000指增", "-13.68%", "", ""],
      ["量锐指数增强2000一号", "量锐", "", "2000指增2.59", "73.46%-27.70%-13.77%", "-12.41%", ""],
      ["茂源巴舍里耶2期", "茂源", "", "市场中性8.58", "73.80%-9.37%-080%", "-7.45%", ""],
    ]
    const excess = [
      ["产品名称", "管理人", "管理规模", "策略", "2025超额"],
      ["", "", "", "本周收益今年收益", "本周超额今年超额"],
      ["量锐指数增强2000一号", "量锐", "", "2000指增-13.77%-12.41%", "-.00-14.17%26.55%"],
      ["量锐指数增强2000一号", "量锐", "", "2000指增-13.77%-12.41%", "-0.09%14.17%26.55%"],
    ]
    const merged = mergeXiaoheOcrRows([
      ...parseXiaoheOcrGrid(sheet).rows,
      ...parseXiaoheOcrGrid(excess).rows,
    ])
    const liang = merged.find((row) => row.product.startsWith("量锐"))
    const mao = merged.find((row) => row.product.startsWith("茂源"))
    assert.ok(Math.abs((liang?.excess1w ?? 99) + 0.0009) < 1e-6)
    assert.ok(Math.abs((mao?.ret.ret_1w ?? 99) + 0.008) < 1e-6)
  })

  it("does not treat the A500 index as the 500 benchmark", () => {
    const absolute = parseXiaoheOcrGrid([
      ["基金简称", "管理人", "管理规模", "策略", "近1周", "今年", "近1月"],
      ["", "", "", "存续时间", "成立以来收益最大回撤", "", ""],
      ["中证A500指数", "", "", "500指增", "-3.08%", "", ""],
      ["中证500指数", "", "", "500指增", "-7.11%", "", ""],
      ["宽德九臻中证500指数增强臻享1号", "宽德", "", "500指增3.65", "35.82%-35.92%-11.16%", "", ""],
    ]).rows
    const excess = parseXiaoheOcrGrid([
      ["产品名称", "管理人", "管理规模", "策略", "2025超额"],
      ["", "", "", "本周收益今年收益", "本周超额今年超额"],
      ["宽德九臻中证500指数增强臻享1号", "宽德", "", "500指增-11.16%-26.85%", "-8.08%"],
      ["宽德九臻中证500指数增强臻享1号", "宽德", "", "500指增-11.16%-26.85%", "-4.05%-7.30%20.08%"],
    ]).rows
    const row = mergeXiaoheOcrRows([...absolute, ...excess]).find((item) => item.product.startsWith("宽德"))
    assert.ok(Math.abs((row?.excess1w ?? 99) + 0.0405) < 1e-6)
  })

  it("keeps a short month history and subtracts the index on the same window", () => {
    const absolute = parseXiaoheOcrGrid([
      ["基金简称", "管理人", "管理规模", "策略", "近1周", "今年", "近1月"],
      ["", "", "", "存续时间", "成立以来收益最大回撤", "", "近3月近6月近1年近2年近3年"],
      ["中证500指数", "", "", "500指增", "-2.00%", "-13.40%", "-8.85%-19.64%-26.41%-10.74%3.22%16.01%"],
      ["中证A500指数", "", "", "500指增", "-1.46%", "-14.18%", "-7.50%-17.01%-22.51%-13.13%-0.41%14.02%"],
      ["信弘中证500指数增强2号", "信弘", "", "500指增4.41", "69.24%-29.45%0.46%", "-14.85%", "-8.43%-14.09%-22.85%-15.72%39.09%46.01%"],
      ["正定中证A500指数增强2号", "正定", "", "A500指增1.84", "25.18%-21.53%-0.78%", "-6.62%", "-11.53%-18.45%-17.95%-4.59%"],
      ["九坤中证500指数增强专享20号", "九坤", "", "500指增2.98", "60.82%-26.22%0.03%", "-3.38%", "-10.67%-15.64%-19.21%-990%47.23%"],
    ]).rows
    const excess = parseXiaoheOcrGrid([
      ["产品名称", "管理人", "管理规模", "策略", "2025超额"],
      ["", "", "", "本周收益今年收益", "本周超额今年超额"],
      ["信弘中证500指数增强2号", "信弘", "", "500指增0.46%-14.85%", "2.46%1.00%"],
    ]).rows
    const merged = mergeXiaoheOcrRows([...absolute, ...excess])
    const xin = merged.find((row) => row.product.startsWith("信弘"))
    const zheng = merged.find((row) => row.product.startsWith("正定"))
    const jiu = merged.find((row) => row.product.startsWith("九坤"))
    assert.ok(Math.abs((xin?.excess1w ?? 0) - 0.0246) < 1e-9)
    assert.ok(Math.abs((xin?.excessWindows?.ret_1m ?? 0) - 0.0042) < 1e-9)
    assert.ok(Math.abs((xin?.excessWindows?.ret_1y ?? 0) - (-0.0498)) < 1e-9)
    assert.ok(Math.abs((zheng?.ret.ret_1m ?? 0) + 0.1153) < 1e-9)
    assert.ok(Math.abs((zheng?.excessWindows?.ret_1m ?? 0) + 0.0403) < 1e-9)
    assert.ok(Math.abs((jiu?.ret.ret_1y ?? 0) + 0.099) < 1e-9)
    assert.equal(merged.some((row) => row.product.includes("指数") && !row.product.includes("增强")), false)
  })

  it("merges the two files and drops the benchmark row", () => {
    const merged = mergeXiaoheOcrRows([
      ...parseXiaoheOcrGrid(absolute).rows,
      ...parseXiaoheOcrGrid(excess).rows,
    ])
    const row = merged.find((item) => item.product.startsWith("玉数"))
    assert.ok(Math.abs((row?.ret.ret_1w ?? 0) + 0.0078) < 1e-9)
    assert.ok(Math.abs((row?.ret.ret_1y ?? 0) - 0.2194) < 1e-9)
    assert.ok(Math.abs((row?.excess1w ?? 0) - 0.0076) < 1e-9)
    assert.equal(merged.some((item) => item.product === "沪深300指数"), false)
  })
})

describe("ima board", () => {
  it("keeps week excess separate from the absolute week return", () => {
    const rows = parseImaRankGrid([
      ["点睛业绩放送_500指增周度业绩榜（1116-1120）"],
      ["序号", "策略类型", "基金管理人", "管理规模", "净值日期", "近一周收益率", "近一周超额", "今年以来收益率", "今年以来超额"],
      [1, "500指增", "锋滔资产", "0-5亿", "2026-11-20", -0.0342, 0.0396, -0.0671, 0.1597],
    ])
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.manager, "锋滔资产")
    assert.equal(rows[0]?.ret1w, -0.0342)
    assert.equal(rows[0]?.excess1w, 0.0396)
    assert.equal(imaDisplayName(rows[0]!), "锋滔资产")
  })

  it("reads a shifted 基金经理 column and does not invent excess", () => {
    const rows = parseImaRankGrid([
      ["序号", "策略类型", "基金管理人", "基金经理", "管理规模", "净值日期", "近一周收益率", "今年以来收益率"],
      [1, "主观多头", "大禾投资", "胡鲁滨", "20-50亿", "2026-11-20", 0.0387, 0.192],
    ])
    assert.equal(rows[0]?.ret1w, 0.0387)
    assert.equal(rows[0]?.excess1w, null)
    assert.equal(imaDisplayName(rows[0]!), "大禾投资-胡鲁滨")
  })
})

describe("catalog match", () => {
  const indexed = indexXiaoheCatalog([
    { beian: "SSZ551", name: "盛冠达沪深300指数增强2号私募证券投资基金", manager: "海南盛冠达", key: xiaoheNameKey("盛冠达沪深300指数增强2号私募证券投资基金") },
    { beian: "SZQ543", name: "三亚知行通达汇智16号证券投资私募基金", manager: "深圳知行通达", key: xiaoheNameKey("三亚知行通达汇智16号证券投资私募基金") },
    { beian: "SAHX26", name: "聚宽中证2000增强一号", manager: "北京聚宽", key: xiaoheNameKey("聚宽中证2000增强一号") },
  ])

  it("matches an official name, a city prefix, and a missing 一号", () => {
    assert.equal(matchXiaoheCatalog("盛冠达沪深300指数增强2号", "盛冠达", indexed.byKey, indexed.suffixIndex)?.beian, "SSZ551")
    assert.equal(matchXiaoheCatalog("知行通达汇智16号", "知行通达", indexed.byKey, indexed.suffixIndex)?.beian, "SZQ543")
    assert.equal(matchXiaoheCatalog("聚宽中证2000增强", "聚宽", indexed.byKey, indexed.suffixIndex)?.beian, "SAHX26")
  })

  it("does not treat a benchmark as a product", () => {
    assert.equal(matchXiaoheCatalog("沪深300指数", "", indexed.byKey, indexed.suffixIndex), null)
  })
})
