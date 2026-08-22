import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import { andScope, scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isOption(contract: string): boolean {
  return /^[A-Z]+\d+-?[CP]-?\d+$/i.test(contract)
}

export const GET = withCfmmcAccount(async function GET() {
  try {
    const dateParams: unknown[] = []
    const dateRows = await publicQuery(`
      SELECT DISTINCT trade_date::text AS dt
      FROM public.cfmmc_positions
      WHERE trade_date IS NOT NULL AND ${scopeWhere(dateParams)}
      ORDER BY dt DESC LIMIT 2
    `, dateParams)
    if (dateRows.rows.length === 0) {
      return NextResponse.json({ ok: true, today: null, yesterday: null, rows: [] })
    }
    const today = (dateRows.rows[0] as { dt: string }).dt
    const yesterday = (dateRows.rows[1] as { dt: string } | undefined)?.dt ?? null

    const posParams: unknown[] = [yesterday ? [today, yesterday] : [today]]
    const rows = await publicQuery(`
      SELECT UPPER(TRIM(instrument)) AS contract, account_no AS account, trade_date::text AS date,
             SUM(COALESCE(notional_mv, 0))::text AS signed_mv,
             SUM(CASE
               WHEN COALESCE(buy_lots, 0) > 0 OR bs = '买' THEN COALESCE(buy_lots, lots, 0)
               ELSE -COALESCE(sell_lots, lots, 0)
             END)::text AS net_lots
      FROM public.cfmmc_positions
      WHERE trade_date = ANY($1::date[])
        ${andScope(posParams)}
      GROUP BY UPPER(TRIM(instrument)), account_no, trade_date
    `, posParams)

    const todayMap = new Map<string, { mv: number; lots: number }>()
    const yesterdayMap = new Map<string, { mv: number; lots: number }>()
    for (const r of rows.rows as { contract: string; account: string; date: string; signed_mv: string; net_lots: string }[]) {
      const prod = getPrefix(r.contract)
      const opt = isOption(r.contract)
      const k = `${prod}||${r.account}||${opt}`
      const map = r.date === today ? todayMap : yesterdayMap
      const cur = map.get(k) ?? { mv: 0, lots: 0 }
      cur.mv += toNum(r.signed_mv)
      cur.lots += Math.round(toNum(r.net_lots))
      map.set(k, cur)
    }
    const allKeys = new Set([...todayMap.keys(), ...yesterdayMap.keys()])
    const result = [...allKeys].map((k) => {
      const [prod, account, optStr] = k.split("||")
      const t = todayMap.get(k) ?? { mv: 0, lots: 0 }
      const y = yesterdayMap.get(k) ?? { mv: 0, lots: 0 }
      return {
        prod, account, isOpt: optStr === "true",
        todayLots: t.lots, yesterdayLots: y.lots, deltaLots: t.lots - y.lots,
        todayMv: Math.round(t.mv), yesterdayMv: Math.round(y.mv), deltaMv: Math.round(t.mv - y.mv),
      }
    }).sort((a, b) => a.prod !== b.prod ? a.prod.localeCompare(b.prod) : Math.abs(b.deltaLots) - Math.abs(a.deltaLots))

    return NextResponse.json({ ok: true, today, yesterday, rows: result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
})
