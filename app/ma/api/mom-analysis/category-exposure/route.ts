import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getPrefix(contract: string): string {
  return (contract.match(/^[A-Z]+/i)?.[0] ?? contract).toUpperCase()
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

const CAT_MAP: Record<string, string> = {
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}
function getCat(prefix: string): string {
  return CAT_MAP[prefix] ?? "商品"
}

const SECTOR_MAP: Record<string, string> = {
  // 农产
  C: "农产", CS: "农产", WH: "农产", PM: "农产", RR: "农产", RI: "农产", JR: "农产", LR: "农产",
  A: "农产", B: "农产", M: "农产", Y: "农产", RM: "农产", OI: "农产", RS: "农产", PK: "农产", P: "农产",
  SR: "农产", CF: "农产", CY: "农产", LG: "农产", SP: "农产", OP: "农产",
  // 生鲜
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  // 贵金属
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  // 有色
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  // 新能源
  LC: "新能源", PS: "新能源", SI: "新能源",
  // 黑色
  I: "黑色", SF: "黑色", SM: "黑色", RB: "黑色", HC: "黑色", SS: "黑色", WR: "黑色",
  JM: "黑色", J: "黑色", ZC: "黑色", FG: "黑色", BB: "黑色", FB: "黑色",
  // 能源化工
  SC: "能源化工", FU: "能源化工", LU: "能源化工", PG: "能源化工", BU: "能源化工",
  TA: "能源化工", EG: "能源化工", PF: "能源化工", PR: "能源化工",
  PL: "能源化工", PP: "能源化工", L: "能源化工",
  BZ: "能源化工", PX: "能源化工", EB: "能源化工",
  RU: "能源化工", BR: "能源化工", NR: "能源化工",
  SA: "能源化工", SH: "能源化工", V: "能源化工",
  UR: "能源化工", MA: "能源化工",
  // 航运
  EC: "航运",
  // 股指
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  // 国债
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}
const SECTORS = ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债", "其他"]
function getSector(prefix: string): string {
  return SECTOR_MAP[prefix] ?? "其他"
}

const SUB_SECTOR_MAP: Record<string, string> = {
  // 谷物
  C: "谷物", CS: "谷物", WH: "谷物", PM: "谷物", RR: "谷物", RI: "谷物", JR: "谷物", LR: "谷物",
  // 油脂油料
  A: "油脂油料", B: "油脂油料", M: "油脂油料", Y: "油脂油料", RM: "油脂油料", OI: "油脂油料", RS: "油脂油料", PK: "油脂油料", P: "油脂油料",
  // 软商品
  SR: "软商品", CF: "软商品", CY: "软商品",
  // 林业
  LG: "林业", SP: "林业", OP: "林业",
  // 生鲜
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  // 贵金属
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  // 有色
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  // 新能源
  LC: "新能源", PS: "新能源", SI: "新能源",
  // 原材
  I: "原材", SF: "原材", SM: "原材",
  // 成材
  RB: "成材", HC: "成材", SS: "成材", WR: "成材",
  // 煤炭
  JM: "煤炭", J: "煤炭", ZC: "煤炭",
  // 建材
  FG: "建材", BB: "建材", FB: "建材",
  // 油品
  SC: "油品", FU: "油品", LU: "油品", PG: "油品", BU: "油品",
  // 聚酯
  TA: "聚酯", EG: "聚酯", PF: "聚酯", PR: "聚酯",
  // 烯烃
  PL: "烯烃", PP: "烯烃", L: "烯烃",
  // 芳烃
  BZ: "芳烃", PX: "芳烃", EB: "芳烃",
  // 橡胶
  RU: "橡胶", BR: "橡胶", NR: "橡胶",
  // 盐化工
  SA: "盐化工", SH: "盐化工", V: "盐化工",
  // 煤化工
  UR: "煤化工", MA: "煤化工",
  // 航运
  EC: "航运",
  // 股指
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  // 国债
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}
const SUB_SECTORS = ["谷物","油脂油料","软商品","林业","生鲜","贵金属","有色","新能源","原材","成材","煤炭","建材","油品","聚酯","烯烃","芳烃","橡胶","盐化工","煤化工","航运","股指","国债","其他"]
function getSubSector(prefix: string): string {
  return SUB_SECTOR_MAP[prefix] ?? "其他"
}

const ALL_PRODS = [
  "C","CS","WH","PM","RR","RI","JR","LR",
  "A","B","M","Y","RM","OI","RS","PK","P",
  "SR","CF","CY","LG","SP","OP",
  "AP","CJ","LH","JD",
  "AU","AG","PT","PD",
  "CU","BC","AL","AO","AD","ZN","PB","NI","SN",
  "LC","PS","SI",
  "I","SF","SM","RB","HC","SS","WR",
  "JM","J","ZC","FG","BB","FB",
  "SC","FU","LU","PG","BU",
  "TA","EG","PF","PR","PL","PP","L",
  "BZ","PX","EB","RU","BR","NR",
  "SA","SH","V","UR","MA","EC",
  "IH","IF","IC","IM","MO",
  "TS","TF","T","TL",
]

export async function GET() {
  try {
    const rows = await query<{
      date: string
      contract: string
      long_mv: string
      short_mv: string
    }>(
      `SELECT
         "交易日期"::date::text AS date,
         UPPER(TRIM("合约"))    AS contract,
         SUM(
           CASE WHEN ${numExpr("买持仓")} > 0
                THEN ${numExpr("持仓市値")}
                ELSE 0
           END
         )::text AS long_mv,
         SUM(
           CASE WHEN ${numExpr("卖持仓")} > 0
                THEN ${numExpr("持仓市値")}
                ELSE 0
           END
         )::text AS short_mv
       FROM mom_position_details
       WHERE "交易日期" IS NOT NULL
         AND "合约" IS NOT NULL
       GROUP BY "交易日期"::date, UPPER(TRIM("合约"))
       ORDER BY "交易日期"::date`,
    )

    // Daily account equity (客户权益) from mom_daily_reports — the true 净资本
    const equityRows = await query<{ date: string; equity: string }>(
      `SELECT
         "交易日期"::date::text AS date,
         SUM(${numExpr("客户权益")})::text AS equity
       FROM mom_daily_reports
       WHERE "交易日期" IS NOT NULL
       GROUP BY "交易日期"::date
       ORDER BY "交易日期"::date`,
    )
    const equityMap = new Map<string, number>()
    for (const r of equityRows) {
      const v = toNum(r.equity)
      if (v > 0) equityMap.set(r.date, v)
    }

    // Aggregate by date + asset class + sector
    type DayEntry = {
      long: Record<string, number>
      short: Record<string, number>
      slong: Record<string, number>
      sshort: Record<string, number>
      sslong: Record<string, number>
      ssshort: Record<string, number>
      plong: Record<string, number>
      pshort: Record<string, number>
    }
    const dateMap = new Map<string, DayEntry>()

    for (const r of rows) {
      const prefix = getPrefix(r.contract)
      const cat = getCat(prefix)
      const sector = getSector(prefix)
      const longMv = toNum(r.long_mv)
      const shortMv = toNum(r.short_mv)
      if (longMv === 0 && shortMv === 0) continue

      const subSector = getSubSector(prefix)
      if (!dateMap.has(r.date)) {
        dateMap.set(r.date, { long: {}, short: {}, slong: {}, sshort: {}, sslong: {}, ssshort: {}, plong: {}, pshort: {} })
      }
      const entry = dateMap.get(r.date)!
      entry.long[cat] = (entry.long[cat] ?? 0) + longMv
      entry.short[cat] = (entry.short[cat] ?? 0) + shortMv
      entry.slong[sector] = (entry.slong[sector] ?? 0) + longMv
      entry.sshort[sector] = (entry.sshort[sector] ?? 0) + shortMv
      entry.sslong[subSector] = (entry.sslong[subSector] ?? 0) + longMv
      entry.ssshort[subSector] = (entry.ssshort[subSector] ?? 0) + shortMv
      entry.plong[prefix] = (entry.plong[prefix] ?? 0) + longMv
      entry.pshort[prefix] = (entry.pshort[prefix] ?? 0) + shortMv
    }

    const cats = ["商品", "股指", "国债"]
    const series = Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, entry]) => {
        const longTotal = cats.reduce((s, c) => s + (entry.long[c] ?? 0), 0)
        const shortTotal = cats.reduce((s, c) => s + (entry.short[c] ?? 0), 0)
        const sectorFields: Record<string, number> = {}
        for (const s of SECTORS) {
          sectorFields[`long_s_${s}`] = Math.round(entry.slong[s] ?? 0)
          sectorFields[`short_s_${s}`] = -Math.round(entry.sshort[s] ?? 0)
        }
        const subSectorFields: Record<string, number> = {}
        for (const ss of SUB_SECTORS) {
          subSectorFields[`long_ss_${ss}`] = Math.round(entry.sslong[ss] ?? 0)
          subSectorFields[`short_ss_${ss}`] = -Math.round(entry.ssshort[ss] ?? 0)
        }
        const productFields: Record<string, number> = {}
        for (const p of ALL_PRODS) {
          productFields[`long_p_${p}`] = Math.round(entry.plong[p] ?? 0)
          productFields[`short_p_${p}`] = -Math.round(entry.pshort[p] ?? 0)
        }
        return {
          date,
          // long per category (positive)
          long商品: Math.round(entry.long["商品"] ?? 0),
          long股指: Math.round(entry.long["股指"] ?? 0),
          long国债: Math.round(entry.long["国债"] ?? 0),
          // short per category (negative — below axis)
          short商品: -Math.round(entry.short["商品"] ?? 0),
          short股指: -Math.round(entry.short["股指"] ?? 0),
          short国债: -Math.round(entry.short["国债"] ?? 0),
          // net
          net: Math.round(longTotal - shortTotal),
          // daily account equity as denominator for ratio chart
          equity: equityMap.get(date) ?? 0,
          ...sectorFields,
          ...subSectorFields,
          ...productFields,
        }
      })

    return NextResponse.json({ ok: true, series })
  } catch (e) {
    console.error("category-exposure error", e)
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
