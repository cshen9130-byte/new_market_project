/**
 * Sector weighted-vol / marginal-vol timeseries for 单账户.
 * Positions from public.cfmmc_* ; market returns from raw_akshare / CFMMC settle.
 */
import { publicQuery } from "@/lib/db"
import { scopeWhere } from "@/lib/server/account-risk-scope"
import { getCategory, getSector, getSubSector, toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"
import {
  floorIndex,
  isFuturesInstrument,
  loadVarMarketReturns,
  lookupClean,
  lookupPct,
  normDate,
  pearsonCorr,
  stdDev,
  type MarketReturns,
} from "@/lib/server/account-risk-var"

export type SectorVolPayload = {
  ok: true
  dates: string[]
  catData: Record<string, number[]>
  sectorData: Record<string, number[]>
  subSectorData: Record<string, number[]>
}

type ProdMvByDate = Map<string, Map<string, number>>

async function loadProdMvByDate(): Promise<{
  prodMvByDate: ProdMvByDate
  tradingDates: string[]
  allProds: string[]
}> {
  const params: unknown[] = []
  const mvRows = await publicQuery(`
    SELECT trade_date::text AS date, UPPER(TRIM(instrument)) AS contract,
           SUM(COALESCE(notional_mv, 0))::text AS mv
    FROM public.cfmmc_positions
    WHERE instrument IS NOT NULL AND TRIM(instrument) <> ''
      AND ${scopeWhere(params)}
    GROUP BY trade_date, UPPER(TRIM(instrument))
    ORDER BY 1
  `, params)
  const prodMvByDate: ProdMvByDate = new Map()
  const dates = new Set<string>()
  for (const r of mvRows.rows as { date: string; contract: string; mv: string }[]) {
    if (!isFuturesInstrument(r.contract)) continue
    const d = normDate(r.date)
    const prod = getPrefix(r.contract)
    dates.add(d)
    if (!prodMvByDate.has(prod)) prodMvByDate.set(prod, new Map())
    const m = prodMvByDate.get(prod)!
    m.set(d, (m.get(d) ?? 0) + toNum(r.mv))
  }
  return {
    prodMvByDate,
    tradingDates: [...dates].sort(),
    allProds: [...prodMvByDate.keys()],
  }
}

function emptyPayload(): SectorVolPayload {
  return { ok: true, dates: [], catData: {}, sectorData: {}, subSectorData: {} }
}

function toColumnar(
  rows: { date: string; cat: Record<string, number>; sector: Record<string, number>; sub: Record<string, number> }[],
): SectorVolPayload {
  const allCats = [...new Set(rows.flatMap(r => Object.keys(r.cat)))]
  const allSectors = [...new Set(rows.flatMap(r => Object.keys(r.sector)))]
  const allSubs = [...new Set(rows.flatMap(r => Object.keys(r.sub)))]
  const catData: Record<string, number[]> = {}
  const sectorData: Record<string, number[]> = {}
  const subSectorData: Record<string, number[]> = {}
  for (const g of allCats) catData[g] = rows.map(r => r.cat[g] ?? 0)
  for (const g of allSectors) sectorData[g] = rows.map(r => r.sector[g] ?? 0)
  for (const g of allSubs) subSectorData[g] = rows.map(r => r.sub[g] ?? 0)
  return { ok: true, dates: rows.map(r => r.date), catData, sectorData, subSectorData }
}

function activeProdsOn(prodMvByDate: ProdMvByDate, date: string): { prod: string; mv: number }[] {
  const out: { prod: string; mv: number }[] = []
  for (const [prod, byDate] of prodMvByDate) {
    const mv = byDate.get(date) ?? 0
    if (Math.abs(mv) >= 1000) out.push({ prod, mv })
  }
  return out
}

/** 边际波动率% — same MCR formula as VaR sandbox pies, rolled to 大类/板块/细分. */
export async function buildVarSectorTimeseries(volDays: number, corrDays: number): Promise<SectorVolPayload> {
  const { prodMvByDate, tradingDates, allProds } = await loadProdMvByDate()
  if (tradingDates.length === 0) return emptyPayload()

  const lastBook = tradingDates[tradingDates.length - 1]
  const market = await loadVarMarketReturns(allProds, lastBook)
  if (market.allMktDates.length < 2) return emptyPayload()

  const rows: { date: string; cat: Record<string, number>; sector: Record<string, number>; sub: Record<string, number> }[] = []

  for (const date of tradingDates) {
    const mktIdx = floorIndex(market.allMktDates, date)
    if (mktIdx < 2) continue
    const volWin = Math.min(volDays, mktIdx)
    const corrWin = Math.min(corrDays, mktIdx)
    if (volWin < 2) continue

    const prodMvs = activeProdsOn(prodMvByDate, date)
    if (prodMvs.length === 0) continue
    const N = prodMvs.length
    const corrDates = market.allMktDates.slice(mktIdx - corrWin, mktIdx)

    const dv = prodMvs.map(({ prod, mv }) => {
      const clean = lookupClean(market.cleanPctByCode, prod)
      const rets = clean.slice(mktIdx - volWin, mktIdx).filter(r => r !== 0)
      return stdDev(rets) * mv
    })

    const retSeries = prodMvs.map(({ prod }) => corrDates.map(d => lookupPct(market.pctMap, prod, d)))
    const corrMat: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
    for (let i = 0; i < N; i++) {
      corrMat[i][i] = 1
      for (let j = i + 1; j < N; j++) {
        const c = pearsonCorr(retSeries[i], retSeries[j])
        corrMat[i][j] = c
        corrMat[j][i] = c
      }
    }

    const catMcr: Record<string, number> = {}
    const sectorMcr: Record<string, number> = {}
    const subMcr: Record<string, number> = {}
    let totalMcr = 0
    for (let i = 0; i < N; i++) {
      if (dv[i] === 0) continue
      let covSum = 0
      for (let j = 0; j < N; j++) covSum += dv[j] * corrMat[i][j]
      const mcr = Math.abs(dv[i] * covSum)
      if (mcr < 1) continue
      const { prod } = prodMvs[i]
      const cat = getCategory(prod)
      const sector = getSector(prod)
      const sub = getSubSector(prod)
      catMcr[cat] = (catMcr[cat] ?? 0) + mcr
      sectorMcr[sector] = (sectorMcr[sector] ?? 0) + mcr
      subMcr[sub] = (subMcr[sub] ?? 0) + mcr
      totalMcr += mcr
    }
    if (totalMcr === 0) continue

    const cat: Record<string, number> = {}
    const sector: Record<string, number> = {}
    const sub: Record<string, number> = {}
    for (const [k, v] of Object.entries(catMcr)) cat[k] = Math.round(v / totalMcr * 10000) / 100
    for (const [k, v] of Object.entries(sectorMcr)) sector[k] = Math.round(v / totalMcr * 10000) / 100
    for (const [k, v] of Object.entries(subMcr)) sub[k] = Math.round(v / totalMcr * 10000) / 100
    rows.push({ date, cat, sector, sub })
  }

  return rows.length === 0 ? emptyPayload() : toColumnar(rows)
}

function sectorWeightedDv(
  prodMvs: { prod: string; mv: number }[],
  lookbackDates: string[],
  market: MarketReturns,
  getGroup: (prod: string) => string,
): Record<string, number> {
  const groups = new Map<string, { prod: string; absMv: number }[]>()
  for (const { prod, mv } of prodMvs) {
    const g = getGroup(prod)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push({ prod, absMv: Math.abs(mv) })
  }
  const out: Record<string, number> = {}
  for (const [sector, items] of groups) {
    const totalAbs = items.reduce((s, x) => s + x.absMv, 0)
    if (totalAbs < 1000) continue
    const rets = lookbackDates.map(d => {
      let r = 0
      for (const { prod, absMv } of items) r += (absMv / totalAbs) * lookupPct(market.pctMap, prod, d)
      return r
    })
    if (rets.filter(r => r !== 0).length < 3) continue
    const dv = stdDev(rets) * totalAbs
    if (dv >= 1) out[sector] = dv
  }
  return out
}

/** 加权波动率% — intra-sector MV-weighted return vol, as share of total. */
export async function buildMarginalVolTimeseries(volDays: number): Promise<SectorVolPayload> {
  const { prodMvByDate, tradingDates, allProds } = await loadProdMvByDate()
  if (tradingDates.length === 0) return emptyPayload()

  const lastBook = tradingDates[tradingDates.length - 1]
  const market = await loadVarMarketReturns(allProds, lastBook)
  if (market.allMktDates.length < 2) return emptyPayload()

  const rows: { date: string; cat: Record<string, number>; sector: Record<string, number>; sub: Record<string, number> }[] = []

  for (const date of tradingDates) {
    const mktIdx = floorIndex(market.allMktDates, date)
    if (mktIdx < 2) continue
    const volWin = Math.min(volDays, mktIdx)
    if (volWin < 3) continue
    const lookback = market.allMktDates.slice(mktIdx - volWin, mktIdx)
    const prodMvs = activeProdsOn(prodMvByDate, date)
    if (prodMvs.length === 0) continue

    const catDv = sectorWeightedDv(prodMvs, lookback, market, getCategory)
    const sectorDv = sectorWeightedDv(prodMvs, lookback, market, getSector)
    const subDv = sectorWeightedDv(prodMvs, lookback, market, getSubSector)
    const totalCat = Object.values(catDv).reduce((s, v) => s + v, 0)
    const totalSector = Object.values(sectorDv).reduce((s, v) => s + v, 0)
    const totalSub = Object.values(subDv).reduce((s, v) => s + v, 0)
    if (totalSector === 0) continue

    const cat: Record<string, number> = {}
    const sector: Record<string, number> = {}
    const sub: Record<string, number> = {}
    for (const [k, v] of Object.entries(catDv)) cat[k] = totalCat > 0 ? Math.round(v / totalCat * 10000) / 100 : 0
    for (const [k, v] of Object.entries(sectorDv)) sector[k] = Math.round(v / totalSector * 10000) / 100
    for (const [k, v] of Object.entries(subDv)) sub[k] = totalSub > 0 ? Math.round(v / totalSub * 10000) / 100 : 0
    rows.push({ date, cat, sector, sub })
  }

  return rows.length === 0 ? emptyPayload() : toColumnar(rows)
}
