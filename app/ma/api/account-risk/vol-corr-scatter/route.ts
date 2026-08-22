/**
 * account-risk/vol-corr-scatter
 * Product vol bars, MVC bars, and correlation heatmap for 日间风控.
 * Same JSON as mom-analysis/vol-corr-scatter. Reads cfmmc_* + market prices.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { getSector, toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import { andScope, scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"
import {
  isFuturesInstrument,
  loadVarMarketReturns,
  lookupClean,
  lookupPct,
  pearsonCorr,
  sigmaFromClean,
  stdDev,
} from "@/lib/server/account-risk-var"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const WINDOW = Math.max(5, Math.min(120, parseInt(searchParams.get("window") ?? "20", 10)))
  const CORR_WINDOW = Math.max(5, Math.min(504, parseInt(searchParams.get("corrWindow") ?? String(WINDOW), 10)))

  try {
    const dateParams: unknown[] = []
    const dateRow = await publicQuery(`SELECT MAX(trade_date)::text AS date FROM public.cfmmc_positions WHERE ${scopeWhere(dateParams)}`, dateParams)
    const latestDate = (dateRow.rows[0] as { date: string | null } | undefined)?.date ?? ""
    if (!latestDate) {
      return NextResponse.json({ ok: true, points: [], corrMatrix: null, window: WINDOW, notEnoughData: true })
    }

    const mvParams: unknown[] = [latestDate]
    const mvRows = await publicQuery(`
      SELECT UPPER(TRIM(instrument)) AS contract,
             SUM(COALESCE(notional_mv, 0))::text AS mv
      FROM public.cfmmc_positions
      WHERE trade_date = $1::date
        AND instrument IS NOT NULL AND TRIM(instrument) <> ''
        ${andScope(mvParams)}
      GROUP BY UPPER(TRIM(instrument))
    `, mvParams)

    const prodMV = new Map<string, number>()
    for (const r of mvRows.rows as { contract: string; mv: string }[]) {
      if (!isFuturesInstrument(r.contract)) continue
      const prod = getPrefix(r.contract)
      prodMV.set(prod, (prodMV.get(prod) ?? 0) + toNum(r.mv))
    }
    const activeProds = [...prodMV.keys()]
      .filter(p => Math.abs(prodMV.get(p)!) > 1000)
      .sort((a, b) => Math.abs(prodMV.get(b)!) - Math.abs(prodMV.get(a)!))

    if (activeProds.length === 0) {
      return NextResponse.json({ ok: true, points: [], corrMatrix: null, window: WINDOW })
    }

    const market = await loadVarMarketReturns(activeProds, latestDate)
    if (market.allMktDates.length < 3) {
      return NextResponse.json({ ok: true, points: [], corrMatrix: null, window: WINDOW, notEnoughData: true })
    }

    const lastMktDates = market.allMktDates.slice(-WINDOW)
    const totalAbsMV = [...prodMV.values()].reduce((s, v) => s + Math.abs(v), 0)

    const portMktRet = lastMktDates.map(dt => {
      let ret = 0
      for (const prod of activeProds) {
        const w = (prodMV.get(prod) ?? 0) / totalAbsMV
        ret += w * lookupPct(market.pctMap, prod, dt)
      }
      return ret
    })
    const portMktVol = stdDev(portMktRet)

    const points: { prod: string; sector: string; vol: number; corr: number; mv: number; mvc: number }[] = []
    for (const prod of activeProds) {
      const signedMV = prodMV.get(prod) ?? 0
      const netMV = Math.abs(signedMV)
      if (netMV < 1000) continue
      const mktRets = lastMktDates.map(dt => lookupPct(market.pctMap, prod, dt))
      const nonZero = mktRets.filter(r => r !== 0)
      if (nonZero.length < 3) continue
      const vol = Math.round(sigmaFromClean(lookupClean(market.cleanPctByCode, prod), WINDOW) * 10000) / 100
      const w = signedMV / totalAbsMV
      const mktCorrWithPort = portMktVol > 0 ? pearsonCorr(mktRets, portMktRet) : 0
      const mktSigma = stdDev(mktRets)
      const mvcRaw = w * mktSigma * mktCorrWithPort
      const mvc = portMktVol > 0 ? Math.round(mvcRaw / portMktVol * 10000) / 100 : 0
      points.push({
        prod,
        sector: getSector(prod),
        vol,
        corr: 0,
        mv: Math.round(netMV / 10000) / 100,
        mvc,
      })
    }

    const corrMktDates = market.allMktDates.slice(-CORR_WINDOW)
    const matrixProds = points.map(p => p.prod)
    const matrixRets = matrixProds.map(prod => corrMktDates.map(dt => lookupPct(market.pctMap, prod, dt)))
    const corrMatrixData: [number, number, number][] = []
    for (let i = 0; i < matrixProds.length; i++) {
      for (let j = 0; j < matrixProds.length; j++) {
        const c = i === j ? 1 : Math.round(pearsonCorr(matrixRets[i], matrixRets[j]) * 100) / 100
        corrMatrixData.push([j, i, c])
      }
    }

    return NextResponse.json({
      ok: true,
      points,
      corrMatrix: { prods: matrixProds, data: corrMatrixData },
      window: WINDOW,
      corrWindow: CORR_WINDOW,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, points: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
