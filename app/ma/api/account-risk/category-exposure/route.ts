/**
 * account-risk/category-exposure
 * Long/short 持仓市値 from public.cfmmc_positions.notional_mv.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { ALL_PRODS, SECTORS, SUB_SECTORS, getCategory, getSector, getSubSector, toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import { scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET() {
  try {
    const posParams: unknown[] = []
    const posRes = await publicQuery(`
      SELECT trade_date::text AS date,
             UPPER(TRIM(instrument)) AS contract,
             COALESCE(buy_lots, 0) AS buy_lots,
             COALESCE(sell_lots, 0) AS sell_lots,
             COALESCE(lots, 0) AS lots,
             bs,
             COALESCE(notional_mv, 0) AS notional_mv
      FROM public.cfmmc_positions
      WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
        AND ${scopeWhere(posParams)}
    `, posParams)
    const eqParams: unknown[] = []
    const eqRes = await publicQuery(`
      SELECT trade_date::text AS date, SUM(COALESCE(client_equity, 0)) AS equity
      FROM public.cfmmc_daily_summary
      WHERE ${scopeWhere(eqParams)}
      GROUP BY trade_date
    `, eqParams)
    const equityMap = new Map<string, number>()
    for (const r of eqRes.rows as { date: string; equity: number | string }[]) {
      const v = toNum(r.equity)
      if (v > 0) equityMap.set(r.date, v)
    }

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

    for (const r of posRes.rows as {
      date: string; contract: string; buy_lots: number | string; sell_lots: number | string
      lots: number | string; bs: string | null; notional_mv: number | string
    }[]) {
      const prefix = getPrefix(r.contract)
      const cat = getCategory(r.contract)
      const sector = getSector(prefix)
      const subSector = getSubSector(prefix)
      const mv = toNum(r.notional_mv)
      const buy = toNum(r.buy_lots) || (r.bs === "买" ? toNum(r.lots) : 0)
      const sell = toNum(r.sell_lots) || (r.bs === "卖" ? toNum(r.lots) : 0)
      const longMv = buy > 0 ? Math.abs(mv) : 0
      const shortMv = sell > 0 ? Math.abs(mv) : 0
      if (longMv === 0 && shortMv === 0) continue

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
      .sort((a, b) => String(a[0] ?? "").localeCompare(String(b[0] ?? "")))
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
          long商品: Math.round(entry.long["商品"] ?? 0),
          long股指: Math.round(entry.long["股指"] ?? 0),
          long国债: Math.round(entry.long["国债"] ?? 0),
          short商品: -Math.round(entry.short["商品"] ?? 0),
          short股指: -Math.round(entry.short["股指"] ?? 0),
          short国债: -Math.round(entry.short["国债"] ?? 0),
          net: Math.round(longTotal - shortTotal),
          equity: equityMap.get(date) ?? 0,
          ...sectorFields,
          ...subSectorFields,
          ...productFields,
        }
      })

    return NextResponse.json({ ok: true, series })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) return NextResponse.json({ ok: true, series: [] })
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
