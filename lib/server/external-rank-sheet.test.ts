/**
 *   npx tsx --test lib/server/external-rank-sheet.test.ts
 */
import assert from "node:assert/strict"
import { readFile } from "fs/promises"
import { describe, it } from "node:test"
import path from "path"
import * as XLSX from "xlsx"
import {
  buildExternalRankComparison,
  managerMatchKey,
  parseExternalRankWorkbook,
  resolveRankClass,
  selectParsedClass,
  type PoolRankProduct,
} from "./external-rank-sheet"

function workbook(rows: unknown[][], name = "主观多头(20250930)"): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, name)
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer
}

const HEADER = ["序号", "策略类型", "基金管理人", "管理规模", "净值日期", "今年以来收益率 (截止0930）", "今年以来最大回撤 (截止0930）", "近一周收益率"]

describe("dianjing workbook", () => {
  it("reads manager rows as decimals and a year-to-date window", () => {
    const parsed = parseExternalRankWorkbook(workbook([
      [],
      ["点睛业绩放送_主观股票策略今年来业绩排行榜（截止20250930）"],
      HEADER,
      [1, "主观多头", "北京禧悦私募", "5-10亿", "2025-09-30", 1.5912, 0.2442, -0.0012],
      [2, "主观多头", "龙航资产", "10-20亿", "2025-09-30", 1.2402, 0.1539, 0.0182],
    ]), "点睛业绩放送_主观多头管理人业绩榜（今年来截止930）.xlsx")

    assert.equal(parsed.as_of, "2025-09-30")
    assert.equal(parsed.window, "ytd")
    assert.deepEqual(parsed.classes, ["主观多头"])
    assert.equal(parsed.rows[0].manager, "北京禧悦私募")
    assert.equal(parsed.rows[0].ytd, 1.5912)
    assert.equal(parsed.rows[0].ytd_drawdown, 0.2442)
    assert.equal(parsed.rows[0].ret_1w, -0.0012)
    assert.equal(parsed.rows[0].aum, "5-10亿")
  })

  it("treats a percent-point column as percent", () => {
    const parsed = parseExternalRankWorkbook(workbook([
      HEADER,
      [1, "主观多头", "复胜资产", "100亿以上", "2025-09-30", 159.12, 24.42, -0.12],
      [2, "主观多头", "久期投资", "100亿以上", "2025-09-30", 73.99, 16.58, 4.49],
    ]))
    assert.ok(Math.abs((parsed.rows[0].ytd ?? 0) - 1.5912) < 1e-9)
    assert.ok(Math.abs((parsed.rows[1].ret_1w ?? 0) - 0.0449) < 1e-9)
  })

  it("asks for a class when one file mixes CTA styles", () => {
    const parsed = parseExternalRankWorkbook(workbook([
      ["序号", "策略类型", "基金管理人", "今年以来收益率"],
      [1, "量化CTA", "甲资产", 0.2],
      [2, "主观CTA", "乙资产", 0.1],
    ], "CTA"), "点睛业绩放送_量化+主观CTA（截止20250930）.xlsx")
    assert.deepEqual(parsed.classes.sort(), ["主观CTA", "量化CTA"])
    assert.throws(() => selectParsedClass(parsed, null), /多个策略/)
    const picked = selectParsedClass(parsed, "量化CTA")
    assert.equal(picked.rows.length, 1)
    assert.equal(picked.rows[0].manager, "甲资产")
  })
})

describe("manager keys", () => {
  it("strips the legal suffix and a city in parentheses", () => {
    assert.equal(managerMatchKey("北京禧悦私募基金管理有限公司"), "北京禧悦")
    assert.equal(managerMatchKey("北京禧悦私募"), "北京禧悦")
    assert.equal(managerMatchKey("壹点纳锦(泉州)私募"), "壹点纳锦")
    assert.equal(managerMatchKey("龙航资产"), "龙航")
  })

  it("maps loose class names", () => {
    assert.equal(resolveRankClass("主观多头"), "主观多头")
    assert.equal(resolveRankClass("量化股票策略"), "量化股票")
    assert.equal(resolveRankClass("500指增"), "500指增")
    assert.equal(resolveRankClass("主观期货"), "主观CTA")
  })
})

describe("comparison", () => {
  const pool: PoolRankProduct[] = [
    {
      beian_hao: "S00001",
      name: "禧悦一号",
      manager: "北京禧悦私募基金管理有限公司",
      bucket: "主观多头",
      l1: "股票多头",
      l2: "主观多头",
      l3: null,
      ytd: 0.4,
      ret_1w: 0.01,
    },
    {
      beian_hao: "S00002",
      name: "复胜价值",
      manager: "上海复胜资产管理有限公司",
      bucket: "主观多头",
      l1: "股票多头",
      l2: "主观多头",
      l3: null,
      ytd: 0.8,
      ret_1w: 0.02,
    },
    {
      beian_hao: "S00003",
      name: "池内独有",
      manager: "青骊投资",
      bucket: "主观多头",
      l1: "股票多头",
      l2: "主观多头",
      l3: null,
      ytd: 0.1,
      ret_1w: null,
    },
  ]

  it("splits overlap, candidates, and names it will not guess", () => {
    const parsed = parseExternalRankWorkbook(workbook([
      HEADER,
      [1, "主观多头", "北京禧悦私募", "5-10亿", "2025-09-30", 1.5912, 0.2442, -0.0012],
      [2, "主观多头", "泽源", "10-20亿", "2025-09-30", 0.84, 0.1, 0.01],
      [3, "主观多头", "新思哲投资", "50-100亿", "2025-09-30", 0.6, 0.09, 0.02],
    ]))
    const poolWithNearName: PoolRankProduct[] = [
      ...pool,
      {
        beian_hao: "S00004",
        name: "泽源精选",
        manager: "深圳泽源私募",
        bucket: "主观多头",
        l1: "股票多头",
        l2: "主观多头",
        l3: null,
        ytd: 0.2,
        ret_1w: 0,
      },
    ]
    const result = buildExternalRankComparison(parsed.rows, "主观多头", poolWithNearName, 30, "ytd", parsed.as_of)

    assert.equal(result.returns_are_percent, true)
    assert.equal(result.both.length, 1)
    assert.equal(result.both[0].manager, "北京禧悦私募")
    assert.equal(result.both[0].our_manager, "北京禧悦私募基金管理有限公司")
    assert.equal(result.both[0].their_return, 159.12)
    assert.equal(result.both[0].our_return, 40)
    assert.equal(result.both[0].match_confidence, 1)
    assert.equal(result.external_only.length, 1)
    assert.equal(result.external_only[0].manager, "新思哲投资")
    assert.equal(result.needs_review.length, 1)
    assert.equal(result.needs_review[0].manager, "泽源")
    assert.equal(result.needs_review[0].candidates[0].manager, "深圳泽源私募")
    assert.ok(result.pool_only.some((row) => row.manager === "青骊投资"))
    assert.ok(result.pool_only.some((row) => row.manager === "上海复胜资产管理有限公司"))
  })
})

describe("desktop sample", () => {
  it("parses the subjective-long board when the file is on this machine", async () => {
    const desktop = "C:\\Users\\Administrator\\Desktop"
    const { readdir, stat } = await import("fs/promises")
    const names = await readdir(desktop).catch(() => [] as string[])
    let target = ""
    for (const name of names) {
      if (!name.endsWith(".xlsx")) continue
      const full = path.join(desktop, name)
      const info = await stat(full)
      if (info.size === 65066) target = full
    }
    if (!target) return
    const parsed = parseExternalRankWorkbook(await readFile(target), path.basename(target))
    assert.equal(parsed.as_of, "2025-09-30")
    assert.equal(parsed.classes[0], "主观多头")
    assert.ok(parsed.rows.length >= 25)
    assert.equal(parsed.rows[0].rank, 1)
    assert.equal(parsed.rows[0].manager, "北京禧悦私募")
    assert.ok((parsed.rows[0].ytd ?? 0) > 1)
  })
})
