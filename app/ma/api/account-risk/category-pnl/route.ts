/**
 * account-risk/category-pnl
 *
 * Daily PnL that reconciles with NAV (equity path):
 *   平仓盈亏_t + (浮动盈亏_t − 浮动盈亏_{t-1}) − 手续费_t
 *
 * CFMMC 浮动盈亏 is a mark-to-open LEVEL, not a daily increment. Summing the
 * level across days fabricates large losses while 客户权益 (NAV) stays positive.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { getCategory, getSector, getSubSector, toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import { scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type AmtRow = { date: string; contract: string; amt: string }

export const GET = withCfmmcAccount(async function GET() {
  try {
    const closeParams: unknown[] = []
    const closeRows = await publicQuery(`
      SELECT trade_date::text AS date, UPPER(TRIM(instrument)) AS contract,
             SUM(COALESCE(realized_pl, 0))::text AS amt
      FROM public.cfmmc_trades
      WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
        AND ${scopeWhere(closeParams)}
      GROUP BY trade_date, UPPER(TRIM(instrument))
    `, closeParams)
    const posParams: unknown[] = []
    const positionRows = await publicQuery(`
      SELECT trade_date::text AS date, UPPER(TRIM(instrument)) AS contract,
             SUM(COALESCE(floating_pl, 0))::text AS amt
      FROM public.cfmmc_positions
      WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
        AND ${scopeWhere(posParams)}
      GROUP BY trade_date, UPPER(TRIM(instrument))
    `, posParams)
    const feeParams: unknown[] = []
    const feeRows = await publicQuery(`
      SELECT trade_date::text AS date, UPPER(TRIM(instrument)) AS contract,
             SUM(COALESCE(commission, 0))::text AS amt
      FROM public.cfmmc_trades
      WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
        AND ${scopeWhere(feeParams)}
      GROUP BY trade_date, UPPER(TRIM(instrument))
    `, feeParams)
    const dateParams: unknown[] = []
    const dateRows = await publicQuery(`
      SELECT trade_date::text AS date,
             SUM(COALESCE(client_equity, 0)) AS equity,
             SUM(COALESCE(deposit_wd, 0)) AS flow
      FROM public.cfmmc_daily_summary
      WHERE ${scopeWhere(dateParams)}
      GROUP BY trade_date
      ORDER BY date
    `, dateParams)

    const closeMap = new Map<string, number>()
    const floatMap = new Map<string, number>()
    const feeMap = new Map<string, number>()
    const contractsByDate = new Map<string, Set<string>>()

    const remember = (date: string, contract: string) => {
      if (!contractsByDate.has(date)) contractsByDate.set(date, new Set())
      contractsByDate.get(date)!.add(contract)
    }
    const put = (map: Map<string, number>, rows: AmtRow[]) => {
      for (const row of rows) {
        map.set(`${row.date}|${row.contract}`, toNum(row.amt))
        remember(row.date, row.contract)
      }
    }
    put(closeMap, closeRows.rows as AmtRow[])
    put(floatMap, positionRows.rows as AmtRow[])
    put(feeMap, feeRows.rows as AmtRow[])

    const allDates = [...new Set([
      ...(dateRows.rows as { date: string }[]).map((r) => r.date),
      ...contractsByDate.keys(),
    ])].sort()

    // Same yuan PnL NAV uses: first snapshot is the capital base (return 0 that day).
    const equityPnlByDate = new Map<string, number>()
    let prevEquity = 0
    for (const r of dateRows.rows as { date: string; equity: number | string; flow: number | string }[]) {
      const eq = toNum(r.equity)
      const flow = toNum(r.flow)
      equityPnlByDate.set(r.date, prevEquity > 0 ? eq - prevEquity - flow : 0)
      prevEquity = eq
    }

    const dayMap = new Map<string, number>()
    const sectorDayMap = new Map<string, number>()
    const subSectorDayMap = new Map<string, number>()
    const productDayMap = new Map<string, number>()

    const add = (date: string, contract: string, amount: number) => {
      if (amount === 0) return
      const cat = getCategory(contract)
      dayMap.set(`${date}|${cat}`, (dayMap.get(`${date}|${cat}`) ?? 0) + amount)
      const sec = getSector(contract)
      sectorDayMap.set(`${date}|${sec}`, (sectorDayMap.get(`${date}|${sec}`) ?? 0) + amount)
      const sub = getSubSector(contract)
      subSectorDayMap.set(`${date}|${sub}`, (subSectorDayMap.get(`${date}|${sub}`) ?? 0) + amount)
      const prod = getPrefix(contract)
      productDayMap.set(`${date}|${prod}`, (productDayMap.get(`${date}|${prod}`) ?? 0) + amount)
    }

    for (let i = 0; i < allDates.length; i++) {
      const date = allDates[i]
      const prev = i > 0 ? allDates[i - 1] : null
      const contracts = new Set<string>([
        ...(contractsByDate.get(date) ?? []),
        ...(prev ? contractsByDate.get(prev) ?? [] : []),
      ])
      for (const contract of contracts) {
        const close = closeMap.get(`${date}|${contract}`) ?? 0
        const fee = feeMap.get(`${date}|${contract}`) ?? 0
        const flToday = floatMap.get(`${date}|${contract}`) ?? 0
        // First snapshot: inherited 浮动盈亏 is already in 客户权益, not today's PnL.
        const flPrev = prev ? (floatMap.get(`${prev}|${contract}`) ?? 0) : flToday
        add(date, contract, close + (flToday - flPrev) - fee)
      }
    }

    const categories = ["股指", "国债", "商品"] as const

    // Scale contract attribution so 股指+国债+商品 = NAV yuan PnL each day.
    for (const date of allDates) {
      const attributed = categories.reduce((s, cat) => s + (dayMap.get(`${date}|${cat}`) ?? 0), 0)
      const target = equityPnlByDate.get(date) ?? 0
      if (Math.abs(attributed) > 0.5) {
        const factor = target / attributed
        for (const map of [dayMap, sectorDayMap, subSectorDayMap, productDayMap]) {
          for (const [k, v] of [...map.entries()]) {
            if (k.startsWith(`${date}|`)) map.set(k, v * factor)
          }
        }
      } else if (Math.abs(target) > 0.5) {
        dayMap.set(`${date}|商品`, (dayMap.get(`${date}|商品`) ?? 0) + target)
      }
    }

    type DailyRow = { date: string; pnl: number; cumPnl: number }

    const result: Record<string, DailyRow[]> = {}
    for (const cat of categories) {
      let cumPnl = 0
      let started = false
      result[cat] = []
      for (const date of allDates) {
        const pnl = dayMap.get(`${date}|${cat}`) ?? 0
        if (!started && pnl === 0) continue
        started = true
        cumPnl += pnl
        result[cat].push({ date, pnl: Math.round(pnl), cumPnl: Math.round(cumPnl) })
      }
    }

    let cumTotal = 0
    result["合计"] = allDates
      .map((date) => {
        const pnl = equityPnlByDate.get(date) ?? 0
        cumTotal += pnl
        return { date, pnl: Math.round(pnl), cumPnl: Math.round(cumTotal) }
      })
      .filter((row) => row.cumPnl !== 0 || row.pnl !== 0)

    const buildNamed = (map: Map<string, number>) => {
      const names = [...new Set([...map.keys()].map((k) => k.split("|")[1]))]
      const out: Record<string, DailyRow[]> = {}
      for (const name of names) {
        let cumPnl = 0
        let started = false
        const rows: DailyRow[] = []
        for (const date of allDates) {
          const pnl = map.get(`${date}|${name}`) ?? 0
          if (!started && pnl === 0) continue
          started = true
          cumPnl += pnl
          rows.push({ date, pnl: Math.round(pnl), cumPnl: Math.round(cumPnl) })
        }
        if (rows.length > 0) out[name] = rows
      }
      return out
    }

    return NextResponse.json({
      data: result,
      sectorData: buildNamed(sectorDayMap),
      subSectorData: buildNamed(subSectorDayMap),
      productData: buildNamed(productDayMap),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ data: {}, sectorData: {}, subSectorData: {}, productData: {} })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
})
