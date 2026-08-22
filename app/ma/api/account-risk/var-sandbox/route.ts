/**
 * account-risk/var-sandbox
 * Latest-day holdings from public.cfmmc_positions + market vol/corr from
 * public.raw_akshare_futures_daily. Same JSON shape as mom-analysis/var-sandbox.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { andScope, scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"
import { toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import {
  corrMatrixFor,
  isFuturesInstrument,
  loadVarMarketReturns,
  lookupClean,
  sigmaFromClean,
  zScoreFor,
} from "@/lib/server/account-risk-var"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const confidence = searchParams.get("confidence") ?? "95"
  const volDays = Math.max(5, Math.min(120, parseInt(searchParams.get("volDays") ?? "20", 10)))
  const corrDays = Math.max(5, Math.min(756, parseInt(searchParams.get("corrDays") ?? "252", 10)))
  const distModel = searchParams.get("distModel") ?? "normal"
  const Z_SCORE = zScoreFor(distModel, confidence)

  try {
    const dateParams: unknown[] = []
    const dateRow = await publicQuery(`SELECT MAX(trade_date)::text AS date FROM public.cfmmc_positions WHERE ${scopeWhere(dateParams)}`, dateParams)
    const latestDate = (dateRow.rows[0] as { date: string | null } | undefined)?.date ?? ""
    if (!latestDate) {
      return NextResponse.json({ ok: true, date: null, products: [], corrMatrix: [], zScore: Z_SCORE, confidence })
    }

    const mvParams: unknown[] = [latestDate]
    const mvRows = await publicQuery(`
      SELECT UPPER(TRIM(instrument)) AS contract,
             SUM(COALESCE(notional_mv, 0))::text AS mv,
             SUM(CASE
               WHEN COALESCE(buy_lots, 0) > 0 OR bs = '买' THEN COALESCE(buy_lots, lots, 0)
               ELSE -COALESCE(sell_lots, lots, 0)
             END)::text AS lots
      FROM public.cfmmc_positions
      WHERE trade_date = $1::date
        AND instrument IS NOT NULL AND TRIM(instrument) <> ''
        ${andScope(mvParams)}
      GROUP BY UPPER(TRIM(instrument))
    `, mvParams)

    const prodMvMap = new Map<string, number>()
    const prodLotsMap = new Map<string, number>()
    for (const r of mvRows.rows as { contract: string; mv: string; lots: string }[]) {
      if (!isFuturesInstrument(r.contract)) continue
      const prod = getPrefix(r.contract)
      prodMvMap.set(prod, (prodMvMap.get(prod) ?? 0) + toNum(r.mv))
      prodLotsMap.set(prod, (prodLotsMap.get(prod) ?? 0) + Math.round(toNum(r.lots)))
    }
    const activeProds = [...prodMvMap.keys()]
      .filter((p) => Math.abs(prodMvMap.get(p)!) > 1000)
      .sort((a, b) => Math.abs(prodMvMap.get(b)!) - Math.abs(prodMvMap.get(a)!))

    const { pctMap, allMktDates, cleanPctByCode } = await loadVarMarketReturns(activeProds, latestDate)
    const corrDatesArr = allMktDates.slice(-corrDays)
    const corrMatrix = corrMatrixFor(activeProds, pctMap, corrDatesArr)

    const products = activeProds.map((prod) => {
      const mv = prodMvMap.get(prod)!
      const lots = prodLotsMap.get(prod) ?? 0
      const lotMv = Math.abs(lots) > 0 ? Math.abs(mv) / Math.abs(lots) : Math.abs(mv)
      const sigma = sigmaFromClean(lookupClean(cleanPctByCode, prod), volDays)
      return { prod, mv: Math.round(mv), lots, sigma: Math.round(sigma * 1e6) / 1e6, lotMv: Math.round(lotMv) }
    })

    const acctParams: unknown[] = [latestDate]
    const acctRows = await publicQuery(`
      SELECT account_no AS account, UPPER(TRIM(instrument)) AS contract,
             SUM(COALESCE(notional_mv, 0))::text AS mv,
             SUM(COALESCE(allocated_margin, 0))::text AS margin
      FROM public.cfmmc_positions
      WHERE trade_date = $1::date
        AND instrument IS NOT NULL AND TRIM(instrument) <> ''
        ${andScope(acctParams)}
      GROUP BY account_no, UPPER(TRIM(instrument))
    `, acctParams)
    const acctProdMvMap = new Map<string, Map<string, number>>()
    const acctMarginMap = new Map<string, number>()
    for (const r of acctRows.rows as { account: string; contract: string; mv: string; margin: string }[]) {
      if (!isFuturesInstrument(r.contract)) continue
      const prod = getPrefix(r.contract)
      if (!acctProdMvMap.has(r.account)) acctProdMvMap.set(r.account, new Map())
      acctProdMvMap.get(r.account)!.set(prod, (acctProdMvMap.get(r.account)!.get(prod) ?? 0) + toNum(r.mv))
      acctMarginMap.set(r.account, (acctMarginMap.get(r.account) ?? 0) + toNum(r.margin))
    }
    const accounts = [...acctMarginMap.entries()].map(([account, marginUsed]) => ({
      account,
      marginUsed: Math.round(marginUsed),
      prodContribs: [...(acctProdMvMap.get(account) ?? new Map()).entries()]
        .map(([prod, mv]) => ({ prod, mv: Math.round(mv) })),
    }))

    return NextResponse.json({
      ok: true, date: latestDate, products, accounts, corrMatrix,
      zScore: Z_SCORE, confidence, volDays, corrDays, distModel,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, date: null, products: [], corrMatrix: [], zScore: Z_SCORE, confidence })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
