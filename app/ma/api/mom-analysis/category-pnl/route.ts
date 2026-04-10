import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Category classification by product code prefix (strip trailing digits from 合约)
const STOCK_INDEX = new Set(["IH", "IF", "IC", "IM", "MO"])
const BOND = new Set(["TS", "TF", "T", "TL"])

function getCategory(contract: string): "股指" | "国债" | "商品" {
  // Strip trailing digits to get product prefix, e.g. "IF2412" -> "IF"
  const prefix = contract.replace(/\d+$/, "").toUpperCase()
  if (STOCK_INDEX.has(prefix)) return "股指"
  if (BOND.has(prefix)) return "国债"
  return "商品"
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

function getSector(contract: string): string {
  const prefix = contract.replace(/\d+$/, "").toUpperCase()
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

function getSubSector(contract: string): string {
  const prefix = contract.replace(/\d+$/, "").toUpperCase()
  return SUB_SECTOR_MAP[prefix] ?? "其他"
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const productCode = searchParams.get("product_code") || null
    const accountFilter = productCode
      ? `AND UPPER(TRIM("账户")) LIKE UPPER('%' || $1 || '%')`
      : ""
    const params = productCode ? [productCode] : []

    // ── 1. 平仓盈亏 from mom_futures_trade_details (期货成交明细) ─────────────
    // NOTE: mom_close_details (平仓明细) totals do NOT match mom_daily_reports.
    //       mom_futures_trade_details.平仓盈亏 summed by date exactly matches
    //       the mom_daily_reports.平仓盈亏 summary cell, so use this source.
    //       mom_futures_trade_details uses Chinese columns: "账户", "交易日期", "合约"
    const closeRows = await query<{ date: string; contract: string; pnl: string }>(
      `SELECT "交易日期"::text AS date,
              UPPER(TRIM("合约"))  AS contract,
              SUM(${numExpr("平仓盈亏")})::text AS pnl
       FROM mom_futures_trade_details
       WHERE "交易日期" IS NOT NULL
         AND "合约" IS NOT NULL
         ${accountFilter}
       GROUP BY "交易日期", UPPER(TRIM("合约"))
       ORDER BY 1`,
      params.length ? params : undefined,
    )

    // ── 2. 持仓盈亏 from mom_position_details ──────────────────────────
    const positionRows = await query<{ date: string; contract: string; pnl: string }>(
      `SELECT "交易日期"::text AS date,
              UPPER(TRIM("合约"))  AS contract,
              SUM(${numExpr("持仓盈亏")})::text AS pnl
       FROM mom_position_details
       WHERE "交易日期" IS NOT NULL
         AND "合约" IS NOT NULL
         ${accountFilter}
       GROUP BY "交易日期", UPPER(TRIM("合约"))
       ORDER BY 1`,
      params.length ? params : undefined,
    )

    // ── 3. 手续费 + 权利金收支 from mom_trade_details ──────────────────
    // NOTE: mom_trade_details uses English column names: account, trade_date
    const tradeAccountFilter = productCode
      ? `AND UPPER(TRIM(account)) LIKE UPPER('%' || $1 || '%')`
      : ""
    const tradeRows = await query<{ date: string; contract: string; fee: string; premium: string }>(
      `SELECT trade_date::text AS date,
              UPPER(TRIM("合约"))  AS contract,
              SUM(${numExpr("手续费")})::text      AS fee,
              SUM(${numExpr("权利金收支")})::text  AS premium
       FROM mom_trade_details
       WHERE trade_date IS NOT NULL
         AND "合约" IS NOT NULL
         ${tradeAccountFilter}
       GROUP BY trade_date, UPPER(TRIM("合约"))
       ORDER BY 1`,
      params.length ? params : undefined,
    )

    // ── Aggregate into category × date map ────────────────────────────
    // key: "date|category"  value: total pnl
    const dayMap = new Map<string, number>()
    const sectorDayMap = new Map<string, number>()
    const subSectorDayMap = new Map<string, number>()
    const productDayMap = new Map<string, number>()

    for (const row of closeRows) {
      const cat = getCategory(row.contract)
      const key = `${row.date}|${cat}`
      dayMap.set(key, (dayMap.get(key) ?? 0) + toNum(row.pnl))
      const sec = getSector(row.contract)
      sectorDayMap.set(`${row.date}|${sec}`, (sectorDayMap.get(`${row.date}|${sec}`) ?? 0) + toNum(row.pnl))
      const sub = getSubSector(row.contract)
      subSectorDayMap.set(`${row.date}|${sub}`, (subSectorDayMap.get(`${row.date}|${sub}`) ?? 0) + toNum(row.pnl))
      const prod = row.contract.replace(/\d+$/, "").toUpperCase()
      productDayMap.set(`${row.date}|${prod}`, (productDayMap.get(`${row.date}|${prod}`) ?? 0) + toNum(row.pnl))
    }
    for (const row of positionRows) {
      const cat = getCategory(row.contract)
      const key = `${row.date}|${cat}`
      dayMap.set(key, (dayMap.get(key) ?? 0) + toNum(row.pnl))
      const sec = getSector(row.contract)
      sectorDayMap.set(`${row.date}|${sec}`, (sectorDayMap.get(`${row.date}|${sec}`) ?? 0) + toNum(row.pnl))
      const sub = getSubSector(row.contract)
      subSectorDayMap.set(`${row.date}|${sub}`, (subSectorDayMap.get(`${row.date}|${sub}`) ?? 0) + toNum(row.pnl))
      const prod = row.contract.replace(/\d+$/, "").toUpperCase()
      productDayMap.set(`${row.date}|${prod}`, (productDayMap.get(`${row.date}|${prod}`) ?? 0) + toNum(row.pnl))
    }
    for (const row of tradeRows) {
      const cat = getCategory(row.contract)
      const key = `${row.date}|${cat}`
      // 手续费 is a cost (negative), 权利金收支 can be positive or negative
      dayMap.set(key, (dayMap.get(key) ?? 0) - toNum(row.fee) + toNum(row.premium))
      const sec = getSector(row.contract)
      sectorDayMap.set(`${row.date}|${sec}`, (sectorDayMap.get(`${row.date}|${sec}`) ?? 0) - toNum(row.fee) + toNum(row.premium))
      const sub = getSubSector(row.contract)
      subSectorDayMap.set(`${row.date}|${sub}`, (subSectorDayMap.get(`${row.date}|${sub}`) ?? 0) - toNum(row.fee) + toNum(row.premium))
      const prod = row.contract.replace(/\d+$/, "").toUpperCase()
      productDayMap.set(`${row.date}|${prod}`, (productDayMap.get(`${row.date}|${prod}`) ?? 0) - toNum(row.fee) + toNum(row.premium))
    }

    // ── Build sorted series per category ─────────────────────────────
    type DailyRow = { date: string; pnl: number; cumPnl: number }
    const categories = ["股指", "国债", "商品"] as const

    const allDates = [...new Set([...dayMap.keys()].map((k) => k.split("|")[0]))].sort()

    const result: Record<string, DailyRow[]> = {}
    for (const cat of categories) {
      let cumPnl = 0
      result[cat] = allDates
        .map((date) => {
          const pnl = dayMap.get(`${date}|${cat}`) ?? 0
          cumPnl += pnl
          return { date, pnl: Math.round(pnl), cumPnl: Math.round(cumPnl) }
        })
        .filter((_, i) => {
          // trim leading zeros — only start from first date with any activity for this cat
          const hasSeen = result[cat] && result[cat].some((r) => r.pnl !== 0)
          const pnl = dayMap.get(`${allDates[i]}|${cat}`) ?? 0
          return hasSeen || pnl !== 0
        })
    }

    // 合计: sum of all three categories from detail tables
    let cumTotal = 0
    result["合计"] = allDates
      .map((date) => {
        const pnl = categories.reduce((s, cat) => s + (dayMap.get(`${date}|${cat}`) ?? 0), 0)
        cumTotal += pnl
        return { date, pnl: Math.round(pnl), cumPnl: Math.round(cumTotal) }
      })
      .filter((row) => row.cumPnl !== 0 || row.pnl !== 0)

    // ── Build sector series ───────────────────────────────────────────
    const sectorResult: Record<string, DailyRow[]> = {}
    const sectors = [...new Set([...sectorDayMap.keys()].map((k) => k.split("|")[1]))]
    for (const sec of sectors) {
      let cumPnl = 0
      let started = false
      const rows: DailyRow[] = []
      for (const date of allDates) {
        const pnl = sectorDayMap.get(`${date}|${sec}`) ?? 0
        if (!started && pnl === 0) continue
        started = true
        cumPnl += pnl
        rows.push({ date, pnl: Math.round(pnl), cumPnl: Math.round(cumPnl) })
      }
      if (rows.length > 0) sectorResult[sec] = rows
    }

    // ── Build sub-sector series ──────────────────────────────────────
    const subSectorResult: Record<string, DailyRow[]> = {}
    const subSectors = [...new Set([...subSectorDayMap.keys()].map((k) => k.split("|")[1]))]
    for (const sub of subSectors) {
      let cumPnl = 0
      let started = false
      const rows: DailyRow[] = []
      for (const date of allDates) {
        const pnl = subSectorDayMap.get(`${date}|${sub}`) ?? 0
        if (!started && pnl === 0) continue
        started = true
        cumPnl += pnl
        rows.push({ date, pnl: Math.round(pnl), cumPnl: Math.round(cumPnl) })
      }
      if (rows.length > 0) subSectorResult[sub] = rows
    }

    // ── Build product series ─────────────────────────────────────────
    const productResult: Record<string, DailyRow[]> = {}
    const products = [...new Set([...productDayMap.keys()].map((k) => k.split("|")[1]))]
    for (const prod of products) {
      let cumPnl = 0
      let started = false
      const rows: DailyRow[] = []
      for (const date of allDates) {
        const pnl = productDayMap.get(`${date}|${prod}`) ?? 0
        if (!started && pnl === 0) continue
        started = true
        cumPnl += pnl
        rows.push({ date, pnl: Math.round(pnl), cumPnl: Math.round(cumPnl) })
      }
      if (rows.length > 0) productResult[prod] = rows
    }

    return NextResponse.json({ data: result, sectorData: sectorResult, subSectorData: subSectorResult, productData: productResult })
  } catch (err) {
    console.error("[category-pnl] error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
