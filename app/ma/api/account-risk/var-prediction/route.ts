/**
 * account-risk/var-prediction
 * Historical 1-day VaR vs next-day |PnL| from public.cfmmc_* + market futures
 * prices. Same JSON shape as mom-analysis/var-prediction.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import { scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"
import {
  corrMatrixFor,
  floorIndex,
  isFuturesInstrument,
  loadVarMarketReturns,
  lookupClean,
  normDate,
  stdDev,
  zScoreFor,
} from "@/lib/server/account-risk-var"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const confidence = searchParams.get("confidence") ?? "95"
  const volDays = Math.max(2, Math.min(120, parseInt(searchParams.get("volDays") ?? "20", 10)))
  const corrDays = Math.max(2, Math.min(756, parseInt(searchParams.get("corrDays") ?? "252", 10)))
  const distModel = searchParams.get("distModel") ?? "normal"
  const prodsParam = searchParams.get("prods")
  const prodsFilter = prodsParam
    ? new Set(prodsParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean))
    : null

  try {
    const VOL_WINDOW = volDays
    const CORR_WINDOW = corrDays
    const Z_SCORE = zScoreFor(distModel, confidence)

    const mvParams: unknown[] = []
    const dateParams: unknown[] = []
    const closeParams: unknown[] = []
    const floatParams: unknown[] = []
    const feeParams: unknown[] = []
    const [mvResult, dateResult, closeResult, floatResult, feeResult] = await Promise.all([
      publicQuery(`
        SELECT trade_date::text AS date, UPPER(TRIM(instrument)) AS contract,
               SUM(COALESCE(notional_mv, 0))::text AS mv
        FROM public.cfmmc_positions
        WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
          AND ${scopeWhere(mvParams)}
        GROUP BY trade_date, UPPER(TRIM(instrument))
        ORDER BY 1
      `, mvParams),
      publicQuery(`
        SELECT trade_date::text AS date,
               SUM(COALESCE(client_equity, 0)) AS equity,
               SUM(COALESCE(deposit_wd, 0)) AS flow
        FROM public.cfmmc_daily_summary
        WHERE ${scopeWhere(dateParams)}
        GROUP BY trade_date
        ORDER BY date
      `, dateParams),
      publicQuery(`
        SELECT trade_date::text AS date, UPPER(TRIM(instrument)) AS contract,
               SUM(COALESCE(realized_pl, 0))::text AS amt
        FROM public.cfmmc_trades
        WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
          AND ${scopeWhere(closeParams)}
        GROUP BY trade_date, UPPER(TRIM(instrument))
      `, closeParams),
      publicQuery(`
        SELECT trade_date::text AS date, UPPER(TRIM(instrument)) AS contract,
               SUM(COALESCE(floating_pl, 0))::text AS amt
        FROM public.cfmmc_positions
        WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
          AND ${scopeWhere(floatParams)}
        GROUP BY trade_date, UPPER(TRIM(instrument))
      `, floatParams),
      publicQuery(`
        SELECT trade_date::text AS date, UPPER(TRIM(instrument)) AS contract,
               SUM(COALESCE(commission, 0))::text AS amt
        FROM public.cfmmc_trades
        WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
          AND ${scopeWhere(feeParams)}
        GROUP BY trade_date, UPPER(TRIM(instrument))
      `, feeParams),
    ])

    const prodMvMap = new Map<string, Map<string, number>>()
    const prodPnlMap = new Map<string, Map<string, number>>()
    const contractsByDate = new Map<string, Set<string>>()
    const closeMap = new Map<string, number>()
    const floatMap = new Map<string, number>()
    const feeMap = new Map<string, number>()

    const remember = (date: string, contract: string) => {
      const d = normDate(date)
      if (!contractsByDate.has(d)) contractsByDate.set(d, new Set())
      contractsByDate.get(d)!.add(contract)
    }

    for (const r of mvResult.rows as { date: string; contract: string; mv: string }[]) {
      if (!isFuturesInstrument(r.contract)) continue
      const d = normDate(r.date)
      const prod = getPrefix(r.contract)
      if (!prodMvMap.has(prod)) prodMvMap.set(prod, new Map())
      prodMvMap.get(prod)!.set(d, (prodMvMap.get(prod)!.get(d) ?? 0) + toNum(r.mv))
      remember(d, r.contract)
    }
    for (const r of closeResult.rows as { date: string; contract: string; amt: string }[]) {
      if (!isFuturesInstrument(r.contract)) continue
      closeMap.set(`${normDate(r.date)}|${r.contract}`, toNum(r.amt))
      remember(r.date, r.contract)
    }
    for (const r of floatResult.rows as { date: string; contract: string; amt: string }[]) {
      if (!isFuturesInstrument(r.contract)) continue
      floatMap.set(`${normDate(r.date)}|${r.contract}`, toNum(r.amt))
      remember(r.date, r.contract)
    }
    for (const r of feeResult.rows as { date: string; contract: string; amt: string }[]) {
      if (!isFuturesInstrument(r.contract)) continue
      feeMap.set(`${normDate(r.date)}|${r.contract}`, toNum(r.amt))
      remember(r.date, r.contract)
    }

    const equityPnlByDate = new Map<string, number>()
    let prevEquity = 0
    for (const r of dateResult.rows as { date: string; equity: number | string; flow: number | string }[]) {
      const d = normDate(r.date)
      const eq = toNum(r.equity)
      const flow = toNum(r.flow)
      equityPnlByDate.set(d, prevEquity > 0 ? eq - prevEquity - flow : 0)
      prevEquity = eq
    }

    const allDates = [...new Set([
      ...[...equityPnlByDate.keys()],
      ...contractsByDate.keys(),
    ])].sort()

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
        const flPrev = prev ? (floatMap.get(`${prev}|${contract}`) ?? 0) : flToday
        const prod = getPrefix(contract)
        if (!prodPnlMap.has(prod)) prodPnlMap.set(prod, new Map())
        prodPnlMap.get(prod)!.set(date, (prodPnlMap.get(prod)!.get(date) ?? 0) + close + (flToday - flPrev) - fee)
      }
    }

    const allProds = [...new Set([...prodMvMap.keys(), ...prodPnlMap.keys()])]
      .filter(p => !prodsFilter || prodsFilter.has(p))

    const totalPnlMap = prodsFilter
      ? (() => {
          const m = new Map<string, number>()
          for (const prod of allProds) {
            for (const [date, pnl] of (prodPnlMap.get(prod) ?? [])) {
              m.set(date, (m.get(date) ?? 0) + pnl)
            }
          }
          return m
        })()
      : equityPnlByDate

    const tradingDates = [...new Set([
      ...allDates,
      ...[...totalPnlMap.keys()],
    ])].sort()

    if (tradingDates.length < 2) {
      return NextResponse.json({ ok: true, data: [], notEnoughData: true, breachRate: null })
    }

    const VOL_USED = Math.min(VOL_WINDOW, Math.max(2, tradingDates.length - 1))

    const lastBookDate = tradingDates[tradingDates.length - 1]
    const { pctMap, allMktDates, cleanPctByCode } = await loadVarMarketReturns(allProds, lastBookDate)
    const corrDates = allMktDates.slice(-CORR_WINDOW)
    const corrMatrix = corrMatrixFor(allProds, pctMap, corrDates)
    const N = allProds.length

    const computePositionVar = (d: string): number => {
      const day = normDate(d)
      const mi = floorIndex(allMktDates, day)
      if (mi < 1) return 0

      const dollarVols = allProds.map(prod => {
        const mvD = prodMvMap.get(prod)?.get(day) ?? 0
        if (Math.abs(mvD) < 1000) return 0
        const cleanRets = lookupClean(cleanPctByCode, prod)
        const rets = (mi >= VOL_USED
          ? cleanRets.slice(mi - VOL_USED, mi)
          : cleanRets.slice(0, mi)).filter(r => r !== 0)
        return stdDev(rets) * mvD
      })

      let portVar = 0
      for (let i = 0; i < N; i++) {
        if (dollarVols[i] === 0) continue
        for (let j = 0; j < N; j++) {
          if (dollarVols[j] === 0) continue
          portVar += dollarVols[i] * dollarVols[j] * corrMatrix[i][j]
        }
      }
      return portVar > 0 ? Math.round(Z_SCORE * Math.sqrt(portVar)) : 0
    }

    const results: { date: string; var: number; actual: number }[] = []
    const startDi = tradingDates.length <= VOL_WINDOW + 1 ? 0 : VOL_USED
    for (let di = startDi; di < tradingDates.length - 1; di++) {
      const d = tradingDates[di]
      const dNext = tradingDates[di + 1]
      let varValue: number
      if (distModel === "kde") {
        const histPnl = tradingDates
          .slice(Math.max(0, di - CORR_WINDOW), di)
          .map(dt => totalPnlMap.get(dt) ?? 0)
          .sort((a, b) => a - b)
        if (histPnl.length < 2) continue
        const alpha = 1 - parseInt(confidence, 10) / 100
        const idx = Math.max(0, Math.floor(alpha * histPnl.length) - 1)
        varValue = Math.abs(Math.round(histPnl[idx] ?? 0))
      } else {
        varValue = computePositionVar(d)
      }
      const actualAbs = Math.abs(Math.round(totalPnlMap.get(dNext) ?? 0))
      if (varValue > 0 || actualAbs > 0) {
        results.push({ date: dNext, var: varValue, actual: actualAbs })
      }
    }

    const lastD = tradingDates[tradingDates.length - 1]
    const nextDayVar = distModel !== "kde" ? computePositionVar(lastD) : 0
    const valid = results.filter(r => r.var > 0)
    const breaches = valid.filter(r => r.actual > r.var).length
    const breachRate = valid.length > 0 ? breaches / valid.length : 0

    return NextResponse.json({
      ok: true,
      data: results.slice(-180),
      nextDayVar,
      breachRate: Math.round(breachRate * 1000) / 10,
      params: { confidence, volDays: VOL_USED, corrDays: CORR_WINDOW, distModel, requestedVolDays: VOL_WINDOW },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, data: [], notYetRun: true, breachRate: null })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
