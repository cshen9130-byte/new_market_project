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

    // Aggregate by date + asset class
    type DayEntry = { long: Record<string, number>; short: Record<string, number> }
    const dateMap = new Map<string, DayEntry>()

    for (const r of rows) {
      const prefix = getPrefix(r.contract)
      const cat = getCat(prefix)
      const longMv = toNum(r.long_mv)
      const shortMv = toNum(r.short_mv)
      if (longMv === 0 && shortMv === 0) continue

      if (!dateMap.has(r.date)) {
        dateMap.set(r.date, { long: {}, short: {} })
      }
      const entry = dateMap.get(r.date)!
      entry.long[cat] = (entry.long[cat] ?? 0) + longMv
      entry.short[cat] = (entry.short[cat] ?? 0) + shortMv
    }

    const cats = ["商品", "股指", "国债"]
    const series = Array.from(dateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, entry]) => {
        const longTotal = cats.reduce((s, c) => s + (entry.long[c] ?? 0), 0)
        const shortTotal = cats.reduce((s, c) => s + (entry.short[c] ?? 0), 0)
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
        }
      })

    return NextResponse.json({ ok: true, series })
  } catch (e) {
    console.error("category-exposure error", e)
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
