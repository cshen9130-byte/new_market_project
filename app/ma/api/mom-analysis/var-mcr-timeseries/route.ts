import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"
import { getPrefix } from "@/lib/server/prod-utils"
import { PROD_SECTOR } from "@/lib/ma/prod-sector"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Same recommended caps as the VaR contribution report (percent). */
export const PRODUCT_SOFT = 30
export const PRODUCT_HARD = 50
export const SECTOR_SOFT = 50
export const SECTOR_HARD = 65

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

const asDate = (v: string): string => (v ?? "").slice(0, 10)

/**
 * Same contract→akshare map as /var-sandbox. Keep in lockstep so the
 * historical series uses the identical market series as the live pies.
 */
const AKSHARE_CODE: Record<string, string> = {
  A: "A0.DCE",   AD: "AD0.SHF", AG: "AG0.SHF", AL: "AL0.SHF", AO: "AO0.SHF", AP: "AP0.CZC",
  AU: "AU0.SHF", B: "B0.DCE",   BB: "BB0.DCE", BC: "BCM.INE", BR: "BR0.SHF", BU: "BU0.SHF",
  BZ: "BZ0.DCE", C: "C0.DCE",   CF: "CF0.CZC", CJ: "CJ0.CZC", CS: "CS0.DCE", CU: "CU0.SHF",
  CY: "CY0.CZC", EB: "EB0.DCE", EC: "ECM.INE", EG: "EG0.DCE", FB: "FB0.DCE", FG: "FG0.CZC",
  FU: "FU0.SHF", HC: "HC0.SHF", I: "I0.DCE",   IC: "IC0.CFE", IF: "IF0.CFE", IH: "IH0.CFE",
  IM: "IM0.CFE", J: "J0.DCE",   JD: "JD0.DCE", JM: "JM0.DCE", JR: "JR0.CZC", L: "L0.DCE",
  LC: "LCM.GFE", LG: "LG0.DCE", LH: "LH0.DCE", LR: "LR0.CZC", LU: "LUM.INE", M: "M0.DCE",
  MA: "MA0.CZC", NI: "NI0.SHF", NR: "NRM.INE", OI: "OI0.CZC", OP: "OP0.SHF", P: "P0.DCE",
  PB: "PB0.SHF", PD: "PDM.GFE", PF: "PF0.CZC", PG: "PG0.DCE", PK: "PK0.CZC", PL: "PL0.CZC",
  PM: "PM0.CZC", PP: "PP0.DCE", PR: "PR0.CZC", PS: "PSM.GFE", PT: "PTM.GFE", PX: "PX0.CZC",
  RB: "RB0.SHF", RI: "RI0.CZC", RM: "RM0.CZC", RR: "RR0.DCE", RS: "RS0.CZC", RU: "RU0.SHF",
  SA: "SA0.CZC", SC: "SCM.INE", SF: "SF0.CZC", SH: "SH0.CZC", SI: "SIM.GFE", SM: "SM0.CZC",
  SN: "SN0.SHF", SP: "SP0.SHF", SR: "SR0.CZC", SS: "SS0.SHF", TA: "TA0.CZC", T: "T0.CFE",
  TF: "TF0.CFE", TL: "TL0.CFE", TS: "TS0.CFE", UR: "UR0.CZC", V: "V0.DCE",   WH: "WH0.CZC",
  WR: "WR0.SHF", Y: "Y0.DCE",   ZC: "ZC0.CZC", ZN: "ZN0.SHF",
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/**
 * Zero out contract-rollover spike returns so .filter(r=>r!==0) excludes them.
 * Uses rolling MAD: excludes returns > max(6%, median_abs + 12*MAD*1.4826).
 * Identical to /var-sandbox.
 */
function zeroRolloverSpikes(rets: number[]): number[] {
  if (rets.length < 2) return [...rets]
  const MIN_THRESHOLD = 0.06, K = 12, LOOKBACK = 40
  const out = [...rets]
  for (let i = LOOKBACK; i < rets.length; i++) {
    const win = rets.slice(i - LOOKBACK, i).map(Math.abs).sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    const devs = win.map(v => Math.abs(v - med)).sort((a, b) => a - b)
    const mad = devs[Math.floor(devs.length / 2)]
    const thr = Math.max(MIN_THRESHOLD, med + K * mad * 1.4826)
    if (Math.abs(rets[i]) > thr) out[i] = 0
  }
  return out
}

function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length
  if (n < 3) return 0
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let num = 0, sx = 0, sy = 0
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my
    num += xi * yi; sx += xi * xi; sy += yi * yi
  }
  const denom = Math.sqrt(sx * sy)
  return denom < 1e-10 ? 0 : num / denom
}

/** Binary search: last index i such that arr[i] <= target, or -1 if none */
function floorIndex(arr: string[], target: string): number {
  let lo = 0, hi = arr.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= target) { idx = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return idx
}

const ACCOUNT_FILTER = `
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'
         AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
         AND TRIM("合约") NOT LIKE '%-%-%'`

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const volDays  = Math.max(5, Math.min(120, parseInt(searchParams.get("volDays")  ?? "20",  10)))
  const corrDays = Math.max(5, Math.min(756, parseInt(searchParams.get("corrDays") ?? "252", 10)))

  try {
    // 1. Signed MV per contract per date — same account/contract filters as /var-sandbox
    const mvRows = await query<{ date: string; contract: string; mv: string }>(
      `SELECT "交易日期"::text AS date, UPPER(TRIM("合约")) AS contract,
              SUM(
                CASE WHEN ${numExpr("买持仓")} > 0
                     THEN  ${numExpr("持仓市値")}
                     ELSE -${numExpr("持仓市値")}
                END
              )::text AS mv
       FROM mom_position_details
       WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
       ${ACCOUNT_FILTER}
       GROUP BY "交易日期", UPPER(TRIM("合约"))
       ORDER BY 1`,
    )

    if (mvRows.length === 0) {
      return NextResponse.json({
        ok: true, dates: [], productData: {}, sectorData: {},
        maxProductShare: [], maxSectorShare: [],
        distanceProduct: [], distanceSector: [],
        productSoft: PRODUCT_SOFT, productHard: PRODUCT_HARD,
        sectorSoft: SECTOR_SOFT, sectorHard: SECTOR_HARD,
        volDays, corrDays, window: "inclusive",
      })
    }

    const prodMvByDate = new Map<string, Map<string, number>>()
    for (const r of mvRows) {
      const prod = getPrefix(r.contract)
      const date = asDate(r.date)
      if (!prod || !date) continue
      if (!prodMvByDate.has(prod)) prodMvByDate.set(prod, new Map())
      const m = prodMvByDate.get(prod)!
      m.set(date, (m.get(date) ?? 0) + toNum(r.mv))
    }

    const tradingDates = [...new Set(mvRows.map(r => asDate(r.date)).filter(Boolean))].sort()
    const allProds = [...prodMvByDate.keys()]

    const akCodes = [...new Set(allProds.map(p => AKSHARE_CODE[p]).filter(Boolean))]
    if (akCodes.length === 0) {
      return NextResponse.json({
        ok: true, dates: [], productData: {}, sectorData: {},
        maxProductShare: [], maxSectorShare: [],
        distanceProduct: [], distanceSector: [],
        productSoft: PRODUCT_SOFT, productHard: PRODUCT_HARD,
        sectorSoft: SECTOR_SOFT, sectorHard: SECTOR_HARD,
        volDays, corrDays, window: "inclusive",
      })
    }

    const pctRows = await query<{ date: string; code: string; pct: string }>(
      `SELECT trade_date::text AS date, code, pct_change::text AS pct
       FROM raw_akshare_futures_daily
       WHERE code = ANY($1) AND pct_change IS NOT NULL
       ORDER BY trade_date`,
      [akCodes],
    )

    const pctMap = new Map<string, Map<string, number>>()
    for (const r of pctRows) {
      const date = asDate(r.date)
      if (!pctMap.has(r.code)) pctMap.set(r.code, new Map())
      pctMap.get(r.code)!.set(date, toNum(r.pct) / 100)
    }

    const allMktDates = [...new Set(pctRows.map(r => asDate(r.date)).filter(Boolean))].sort()
    const neededHistory = Math.max(volDays, corrDays)

    // Precompute rollover-cleaned return series per code (same indices as allMktDates)
    const cleanPctByCode = new Map<string, number[]>()
    for (const code of akCodes) {
      const m = pctMap.get(code)
      cleanPctByCode.set(code, zeroRolloverSpikes(allMktDates.map(d => m?.get(d) ?? 0)))
    }

    // 3. For each trading date compute product + sector MCR shares.
    //    Inclusive window (含当日): slice(mktIdx - n + 1, mktIdx + 1) matches
    //    /var-sandbox on the latest date, where the sandbox uses slice(-n).
    //    MCR formula (same as VaR sandbox pies and lib/mom-var-concentration):
    //      dv[i] = sigma[i] * mv[i]
    //      mcr[i] = |dv[i] * Σⱼ(dv[j] * corr[i,j])|
    type RowData = {
      date: string
      product: Record<string, number>
      sector: Record<string, number>
      maxProductShare: number
      maxSectorShare: number
    }
    const rows: RowData[] = []

    for (const date of tradingDates) {
      const mktIdx = floorIndex(allMktDates, date)
      // Need `neededHistory` points inclusive of mktIdx
      if (mktIdx < neededHistory - 1) continue

      const volStart  = mktIdx - volDays + 1
      const corrStart = mktIdx - corrDays + 1
      const corrDatesArr = allMktDates.slice(corrStart, mktIdx + 1)

      const prodMvs: { prod: string; mv: number }[] = []
      for (const [prod, mvByDate] of prodMvByDate) {
        const mv = mvByDate.get(date) ?? 0
        if (Math.abs(mv) >= 1000) prodMvs.push({ prod, mv })
      }
      if (prodMvs.length === 0) continue

      const N = prodMvs.length

      const sigmas = prodMvs.map(({ prod }) => {
        const code = AKSHARE_CODE[prod]
        const cleanRets = cleanPctByCode.get(code ?? "") ?? []
        const rets = cleanRets.slice(volStart, mktIdx + 1).filter(r => r !== 0)
        return stdDev(rets)
      })

      const dv = prodMvs.map(({ mv }, i) => sigmas[i] * mv)

      // Correlation uses the raw (uncleaned) pct series, same as /var-sandbox
      const retSeries = prodMvs.map(({ prod }) => {
        const code = AKSHARE_CODE[prod]
        const m = pctMap.get(code ?? "")
        return corrDatesArr.map(d => m?.get(d) ?? 0)
      })

      const corrMat: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
      for (let i = 0; i < N; i++) {
        corrMat[i][i] = 1
        for (let j = i + 1; j < N; j++) {
          const c = pearsonCorr(retSeries[i], retSeries[j])
          corrMat[i][j] = c
          corrMat[j][i] = c
        }
      }

      const productMcr: Record<string, number> = {}
      const sectorMcr: Record<string, number> = {}
      let totalMcr = 0

      for (let i = 0; i < N; i++) {
        if (dv[i] === 0) continue
        let covSum = 0
        for (let j = 0; j < N; j++) covSum += dv[j] * corrMat[i][j]
        const mcr = Math.abs(dv[i] * covSum)
        if (mcr < 1) continue

        const { prod } = prodMvs[i]
        const sector = PROD_SECTOR[prod] ?? "其他"
        productMcr[prod] = (productMcr[prod] ?? 0) + mcr
        sectorMcr[sector] = (sectorMcr[sector] ?? 0) + mcr
        totalMcr += mcr
      }

      if (totalMcr === 0) continue

      const productPct: Record<string, number> = {}
      const sectorPct: Record<string, number> = {}
      let maxProductShare = 0
      let maxSectorShare = 0
      for (const [k, v] of Object.entries(productMcr)) {
        const pct = Math.round(v / totalMcr * 10000) / 100
        productPct[k] = pct
        if (pct > maxProductShare) maxProductShare = pct
      }
      for (const [k, v] of Object.entries(sectorMcr)) {
        const pct = Math.round(v / totalMcr * 10000) / 100
        sectorPct[k] = pct
        if (pct > maxSectorShare) maxSectorShare = pct
      }

      rows.push({ date, product: productPct, sector: sectorPct, maxProductShare, maxSectorShare })
    }

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true, dates: [], productData: {}, sectorData: {},
        maxProductShare: [], maxSectorShare: [],
        distanceProduct: [], distanceSector: [],
        productSoft: PRODUCT_SOFT, productHard: PRODUCT_HARD,
        sectorSoft: SECTOR_SOFT, sectorHard: SECTOR_HARD,
        volDays, corrDays, window: "inclusive",
      })
    }

    const allProductKeys = [...new Set(rows.flatMap(r => Object.keys(r.product)))]
    const allSectorKeys = [...new Set(rows.flatMap(r => Object.keys(r.sector)))]

    const productData: Record<string, number[]> = {}
    const sectorData: Record<string, number[]> = {}
    for (const k of allProductKeys) productData[k] = rows.map(r => r.product[k] ?? 0)
    for (const k of allSectorKeys) sectorData[k] = rows.map(r => r.sector[k] ?? 0)

    const maxProductShare = rows.map(r => r.maxProductShare)
    const maxSectorShare = rows.map(r => r.maxSectorShare)
    const round1 = (v: number) => Math.round(v * 10) / 10

    return NextResponse.json({
      ok: true,
      dates: rows.map(r => r.date),
      productData,
      sectorData,
      maxProductShare,
      maxSectorShare,
      distanceProduct: maxProductShare.map(v => round1(PRODUCT_SOFT - v)),
      distanceSector: maxSectorShare.map(v => round1(SECTOR_SOFT - v)),
      productSoft: PRODUCT_SOFT,
      productHard: PRODUCT_HARD,
      sectorSoft: SECTOR_SOFT,
      sectorHard: SECTOR_HARD,
      volDays,
      corrDays,
      window: "inclusive",
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[var-mcr-timeseries]", msg)
    if (msg.includes("does not exist")) {
      return NextResponse.json({
        ok: true, dates: [], productData: {}, sectorData: {},
        maxProductShare: [], maxSectorShare: [],
        distanceProduct: [], distanceSector: [],
        productSoft: PRODUCT_SOFT, productHard: PRODUCT_HARD,
        sectorSoft: SECTOR_SOFT, sectorHard: SECTOR_HARD,
        volDays, corrDays, window: "inclusive",
      })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("var-mcr-timeseries", _GET)
