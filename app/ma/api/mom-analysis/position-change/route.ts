import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"
import { getPrefix } from "@/lib/server/prod-utils"

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

async function _GET() {
  try {
    const dateRows = await query<{ dt: string }>(
      `SELECT DISTINCT "交易日期"::date::text AS dt
       FROM mom_position_details
       WHERE "交易日期" IS NOT NULL
        AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
        AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
        AND TRIM("账户"::text) NOT LIKE '%国信%'
        AND TRIM("账户"::text) <> '665300200077'
       ORDER BY dt DESC LIMIT 2`,
    )
    if (dateRows.length === 0) {
      return NextResponse.json({ ok: true, today: null, yesterday: null, products: [] })
    }
    const today     = dateRows[0].dt
    const yesterday = dateRows[1]?.dt ?? null

    const rows = await query<{ contract: string; date: string; signed_mv: string; net_lots: string }>(
      `SELECT
         UPPER(TRIM("合约"))        AS contract,
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
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'
       GROUP BY UPPER(TRIM("合约")), "交易日期"::date`,
      yesterday ? [today, yesterday] : [today],
    )

    const todayMap     = new Map<string, { mv: number; lots: number }>()
    const yesterdayMap = new Map<string, { mv: number; lots: number }>()

    for (const r of rows) {
      if (isOption(r.contract)) continue  // exclude options — they have separate display and distort lot counts
      const prod = getPrefix(r.contract)
      const map  = r.date === today ? todayMap : yesterdayMap
      const cur  = map.get(prod) ?? { mv: 0, lots: 0 }
      cur.mv   += toNum(r.signed_mv)
      cur.lots += Math.round(toNum(r.net_lots))
      map.set(prod, cur)
    }

    const allProds = new Set([...todayMap.keys(), ...yesterdayMap.keys()])
    const products = [...allProds]
      .map(prod => {
        const t = todayMap.get(prod)     ?? { mv: 0, lots: 0 }
        const y = yesterdayMap.get(prod) ?? { mv: 0, lots: 0 }
        return {
          prod,
          todayMv:       Math.round(t.mv),
          yesterdayMv:   Math.round(y.mv),
          deltaMv:       Math.round(t.mv - y.mv),
          todayLots:     t.lots,
          yesterdayLots: y.lots,
          deltaLots:     t.lots - y.lots,
        }
      })
      .filter(p => p.deltaMv !== 0 || p.deltaLots !== 0)
      .sort((a, b) => Math.abs(b.deltaMv) - Math.abs(a.deltaMv))

    return NextResponse.json({ ok: true, today, yesterday, products })
  } catch (e) {
    console.error("[position-change]", e)
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

export const GET = withMomCache("position-change", _GET)
