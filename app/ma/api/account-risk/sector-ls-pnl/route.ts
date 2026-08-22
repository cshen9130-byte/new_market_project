import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { getSector, toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import { andScope, scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET() {
  try {
    const latestParams: unknown[] = []
    const latestRow = await publicQuery(`SELECT MAX(trade_date)::text AS date FROM public.cfmmc_daily_summary WHERE ${scopeWhere(latestParams)}`, latestParams)
    const latestDate = (latestRow.rows[0] as { date: string | null } | undefined)?.date
    if (!latestDate) return NextResponse.json({ ok: true, sectorLS: [], productLS: [], latestDate: null })

    const prevParams: unknown[] = [latestDate]
    const prevRow = await publicQuery(`
      SELECT MAX(trade_date)::text AS date FROM public.cfmmc_daily_summary
      WHERE trade_date < $1::date
        ${andScope(prevParams)}
    `, prevParams)
    const prevDate = (prevRow.rows[0] as { date: string | null } | undefined)?.date

    const closeParams: unknown[] = [latestDate]
    const closeRows = await publicQuery(`
      SELECT UPPER(TRIM(instrument)) AS contract, TRIM(bs) AS direction,
             SUM(COALESCE(realized_pl, 0))::text AS pnl
      FROM public.cfmmc_trades
      WHERE trade_date = $1::date AND instrument IS NOT NULL
        ${andScope(closeParams)}
      GROUP BY UPPER(TRIM(instrument)), TRIM(bs)
    `, closeParams)
    const posParams: unknown[] = [prevDate ? [latestDate, prevDate] : [latestDate]]
    const posRows = await publicQuery(`
      SELECT UPPER(TRIM(instrument)) AS contract,
             CASE WHEN COALESCE(buy_lots, 0) > 0 OR bs = '买' THEN '买' ELSE '卖' END AS direction,
             SUM(COALESCE(floating_pl, 0))::text AS pnl,
             trade_date::text AS date
      FROM public.cfmmc_positions
      WHERE trade_date = ANY($1::date[]) AND instrument IS NOT NULL
        ${andScope(posParams)}
      GROUP BY UPPER(TRIM(instrument)),
               CASE WHEN COALESCE(buy_lots, 0) > 0 OR bs = '买' THEN '买' ELSE '卖' END,
               trade_date
    `, posParams)
    const feeParams: unknown[] = [latestDate]
    const feeRows = await publicQuery(`
      SELECT UPPER(TRIM(instrument)) AS contract, TRIM(bs) AS direction,
             SUM(COALESCE(commission, 0))::text AS fee
      FROM public.cfmmc_trades
      WHERE trade_date = $1::date AND instrument IS NOT NULL
        ${andScope(feeParams)}
      GROUP BY UPPER(TRIM(instrument)), TRIM(bs)
    `, feeParams)

    const longMap = new Map<string, number>()
    const shortMap = new Map<string, number>()
    const prodLongMap = new Map<string, number>()
    const prodShortMap = new Map<string, number>()
    const add = (contract: string, side: "long" | "short", amount: number) => {
      const sector = getSector(contract)
      const prod = getPrefix(contract)
      if (side === "long") {
        longMap.set(sector, (longMap.get(sector) ?? 0) + amount)
        prodLongMap.set(prod, (prodLongMap.get(prod) ?? 0) + amount)
      } else {
        shortMap.set(sector, (shortMap.get(sector) ?? 0) + amount)
        prodShortMap.set(prod, (prodShortMap.get(prod) ?? 0) + amount)
      }
    }

    for (const row of closeRows.rows as { contract: string; direction: string; pnl: string }[]) {
      const pnl = toNum(row.pnl)
      const dir = row.direction?.trim()
      if (dir === "卖") add(row.contract, "long", pnl)
      else if (dir === "买") add(row.contract, "short", pnl)
    }

    const todayFloat = new Map<string, number>()
    const prevFloat = new Map<string, number>()
    for (const row of posRows.rows as { contract: string; direction: string; pnl: string; date: string }[]) {
      const key = `${row.contract}|${row.direction?.trim()}`
      if (row.date === latestDate) todayFloat.set(key, toNum(row.pnl))
      else prevFloat.set(key, toNum(row.pnl))
    }
    const floatKeys = new Set([...todayFloat.keys(), ...prevFloat.keys()])
    for (const key of floatKeys) {
      const [contract, dir] = key.split("|")
      const delta = (todayFloat.get(key) ?? 0) - (prevFloat.get(key) ?? 0)
      if (dir === "买") add(contract, "long", delta)
      else add(contract, "short", delta)
    }

    for (const row of feeRows.rows as { contract: string; direction: string; fee: string }[]) {
      const fee = -toNum(row.fee)
      const dir = row.direction?.trim()
      if (dir === "买") add(row.contract, "long", fee)
      else add(row.contract, "short", fee)
    }

    const allSectors = new Set([...longMap.keys(), ...shortMap.keys()])
    const sectorLS = [...allSectors]
      .map((sector) => ({
        sector,
        long: Math.round(longMap.get(sector) ?? 0),
        short: Math.round(shortMap.get(sector) ?? 0),
      }))
      .filter((s) => s.long !== 0 || s.short !== 0)
    const allProds = new Set([...prodLongMap.keys(), ...prodShortMap.keys()])
    const productLS = [...allProds]
      .map((prod) => ({
        prod,
        long: Math.round(prodLongMap.get(prod) ?? 0),
        short: Math.round(prodShortMap.get(prod) ?? 0),
      }))
      .filter((p) => p.long !== 0 || p.short !== 0)

    return NextResponse.json({ ok: true, sectorLS, productLS, latestDate })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, sectorLS: [], latestDate: null, notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
