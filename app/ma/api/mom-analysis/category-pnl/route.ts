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

    for (const row of closeRows) {
      const cat = getCategory(row.contract)
      const key = `${row.date}|${cat}`
      dayMap.set(key, (dayMap.get(key) ?? 0) + toNum(row.pnl))
    }
    for (const row of positionRows) {
      const cat = getCategory(row.contract)
      const key = `${row.date}|${cat}`
      dayMap.set(key, (dayMap.get(key) ?? 0) + toNum(row.pnl))
    }
    for (const row of tradeRows) {
      const cat = getCategory(row.contract)
      const key = `${row.date}|${cat}`
      // 手续费 is a cost (negative), 权利金收支 can be positive or negative
      dayMap.set(key, (dayMap.get(key) ?? 0) - toNum(row.fee) + toNum(row.premium))
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

    return NextResponse.json({ data: result })
  } catch (err) {
    console.error("[category-pnl] error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
