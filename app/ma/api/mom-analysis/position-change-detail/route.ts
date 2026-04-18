import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isOption(contract: string): boolean {
  return /^[A-Z]+\d+-?[CP]-?\d+$/i.test(contract)
}
function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}
const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

export async function GET() {
  try {
    const dateRows = await query<{ dt: string }>(
      `SELECT DISTINCT "交易日期"::date::text AS dt
       FROM mom_position_details
       WHERE "交易日期" IS NOT NULL
       ORDER BY dt DESC LIMIT 2`,
    )
    if (dateRows.length === 0) {
      return NextResponse.json({ ok: true, today: null, yesterday: null, rows: [] })
    }
    const today     = dateRows[0].dt
    const yesterday = dateRows[1]?.dt ?? null

    const rows = await query<{ contract: string; account: string; date: string; signed_mv: string; net_lots: string }>(
      `SELECT
         UPPER(TRIM("合约"))        AS contract,
         "账户"                    AS account,
         "交易日期"::date::text     AS date,
         SUM(
           CASE WHEN ${numExpr("买持仓")} > 0
                THEN  ${numExpr("持仓市値")}
                ELSE -${numExpr("持仓市値")}
           END
         )::text AS signed_mv,
         SUM(
           CASE WHEN ${numExpr("买持仓")} > 0
                THEN  ${numExpr("买持仓")}
                ELSE -${numExpr("卖持仓")}
           END
         )::text AS net_lots
       FROM mom_position_details
       WHERE "交易日期"::date IN ($1::date${yesterday ? ", $2::date" : ""})
       GROUP BY UPPER(TRIM("合约")), "账户", "交易日期"::date`,
      yesterday ? [today, yesterday] : [today],
    )

    // Aggregate by prod prefix + account + isOpt (keep options separate from futures)
    const todayMap     = new Map<string, { mv: number; lots: number }>()
    const yesterdayMap = new Map<string, { mv: number; lots: number }>()

    for (const r of rows) {
      const prod  = (r.contract.match(/^[A-Z]+/i)?.[0] ?? r.contract).toUpperCase()
      const opt   = isOption(r.contract)
      const k     = `${prod}||${r.account}||${opt}`
      const map  = r.date === today ? todayMap : yesterdayMap
      const cur  = map.get(k) ?? { mv: 0, lots: 0 }
      cur.mv   += toNum(r.signed_mv)
      cur.lots += Math.round(toNum(r.net_lots))
      map.set(k, cur)
    }

    const allKeys = new Set([...todayMap.keys(), ...yesterdayMap.keys()])
    const result = [...allKeys].map(k => {
      const [prod, account, optStr] = k.split("||")
      const t = todayMap.get(k)     ?? { mv: 0, lots: 0 }
      const y = yesterdayMap.get(k) ?? { mv: 0, lots: 0 }
      return {
        prod,
        account,
        isOpt: optStr === "true",
        todayLots:     t.lots,
        yesterdayLots: y.lots,
        deltaLots:     t.lots - y.lots,
        todayMv:       Math.round(t.mv),
        yesterdayMv:   Math.round(y.mv),
        deltaMv:       Math.round(t.mv - y.mv),
      }
    }).sort((a, b) => {
      if (a.prod !== b.prod) return a.prod.localeCompare(b.prod)
      return Math.abs(b.deltaLots) - Math.abs(a.deltaLots)
    })

    return NextResponse.json({ ok: true, today, yesterday, rows: result })
  } catch (e) {
    console.error("[position-change-detail]", e)
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
