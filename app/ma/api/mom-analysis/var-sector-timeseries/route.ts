import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"
import { getPrefix } from "@/lib/server/prod-utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

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

const PROD_CAT: Record<string, string> = {
  C:"商品",CS:"商品",WH:"商品",PM:"商品",RR:"商品",RI:"商品",JR:"商品",LR:"商品",
  A:"商品",B:"商品",M:"商品",Y:"商品",RM:"商品",OI:"商品",RS:"商品",PK:"商品",P:"商品",
  SR:"商品",CF:"商品",CY:"商品",LG:"商品",SP:"商品",OP:"商品",
  AP:"商品",CJ:"商品",LH:"商品",JD:"商品",
  AU:"商品",AG:"商品",PT:"商品",PD:"商品",
  CU:"商品",BC:"商品",AL:"商品",AO:"商品",AD:"商品",ZN:"商品",PB:"商品",NI:"商品",SN:"商品",
  LC:"商品",PS:"商品",SI:"商品",
  I:"商品",SF:"商品",SM:"商品",RB:"商品",HC:"商品",SS:"商品",WR:"商品",
  JM:"商品",J:"商品",ZC:"商品",FG:"商品",BB:"商品",FB:"商品",
  SC:"商品",FU:"商品",LU:"商品",PG:"商品",BU:"商品",
  TA:"商品",EG:"商品",PF:"商品",PR:"商品",PL:"商品",PP:"商品",L:"商品",
  BZ:"商品",PX:"商品",EB:"商品",
  RU:"商品",BR:"商品",NR:"商品",
  SA:"商品",SH:"商品",V:"商品",UR:"商品",MA:"商品",
  EC:"商品",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}

const PROD_SECTOR: Record<string, string> = {
  C:"农产",CS:"农产",WH:"农产",PM:"农产",RR:"农产",RI:"农产",JR:"农产",LR:"农产",
  A:"农产",B:"农产",M:"农产",Y:"农产",RM:"农产",OI:"农产",RS:"农产",PK:"农产",P:"农产",
  SR:"农产",CF:"农产",CY:"农产",LG:"农产",SP:"农产",OP:"农产",
  AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
  AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
  CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
  LC:"新能源",PS:"新能源",SI:"新能源",
  I:"黑色",SF:"黑色",SM:"黑色",RB:"黑色",HC:"黑色",SS:"黑色",WR:"黑色",
  JM:"黑色",J:"黑色",ZC:"黑色",FG:"黑色",BB:"黑色",FB:"黑色",
  SC:"能源化工",FU:"能源化工",LU:"能源化工",PG:"能源化工",BU:"能源化工",
  TA:"能源化工",EG:"能源化工",PF:"能源化工",PR:"能源化工",PL:"能源化工",PP:"能源化工",L:"能源化工",
  BZ:"能源化工",PX:"能源化工",EB:"能源化工",
  RU:"能源化工",BR:"能源化工",NR:"能源化工",
  SA:"能源化工",SH:"能源化工",V:"能源化工",UR:"能源化工",MA:"能源化工",
  EC:"航运",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}

const PROD_SUB_SECTOR: Record<string, string> = {
  C:"谷物",CS:"谷物",WH:"谷物",PM:"谷物",RR:"谷物",RI:"谷物",JR:"谷物",LR:"谷物",
  A:"油脂油料",B:"油脂油料",M:"油脂油料",Y:"油脂油料",RM:"油脂油料",OI:"油脂油料",RS:"油脂油料",PK:"油脂油料",P:"油脂油料",
  SR:"软商品",CF:"软商品",CY:"软商品",
  LG:"林业",SP:"林业",OP:"林业",
  AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
  AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
  CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
  LC:"新能源",PS:"新能源",SI:"新能源",
  I:"原材",SF:"原材",SM:"原材",
  RB:"成材",HC:"成材",SS:"成材",WR:"成材",
  JM:"煤炭",J:"煤炭",ZC:"煤炭",
  FG:"建材",BB:"建材",FB:"建材",
  SC:"油品",FU:"油品",LU:"油品",PG:"油品",BU:"油品",
  TA:"聚酯",EG:"聚酯",PF:"聚酯",PR:"聚酯",
  PL:"烯烃",PP:"烯烃",L:"烯烃",
  BZ:"芳烃",PX:"芳烃",EB:"芳烃",
  RU:"橡胶",BR:"橡胶",NR:"橡胶",
  SA:"盐化工",SH:"盐化工",V:"盐化工",
  UR:"煤化工",MA:"煤化工",
  EC:"航运",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/**
 * Zero out contract-rollover spike returns so .filter(r=>r!==0) excludes them.
 * Uses rolling MAD: excludes returns > max(6%, median_abs + 12*MAD*1.4826).
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

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const volDays  = Math.max(5, Math.min(120, parseInt(searchParams.get("volDays")  ?? "20",  10)))
  const corrDays = Math.max(5, Math.min(756, parseInt(searchParams.get("corrDays") ?? "252", 10)))

  try {
    // 1. Fetch signed MV per contract per date
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
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'
         AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
         AND TRIM("合约") NOT LIKE '%-%-%'
       GROUP BY "交易日期", UPPER(TRIM("合约"))
       ORDER BY 1`,
    )

    if (mvRows.length === 0) {
      return NextResponse.json({ ok: true, dates: [], catData: {}, sectorData: {}, subSectorData: {} })
    }

    // Aggregate to product prefix level (signed mv)
    const prodMvByDate = new Map<string, Map<string, number>>()
    for (const r of mvRows) {
      const prod = getPrefix(r.contract)
      if (!prodMvByDate.has(prod)) prodMvByDate.set(prod, new Map())
      const m = prodMvByDate.get(prod)!
      m.set(r.date, (m.get(r.date) ?? 0) + toNum(r.mv))
    }

    const tradingDates = [...new Set(mvRows.map(r => r.date))].sort()
    const allProds = [...prodMvByDate.keys()]

    // 2. Fetch pct_change for all products
    const akCodes = [...new Set(allProds.map(p => AKSHARE_CODE[p]).filter(Boolean))]
    if (akCodes.length === 0) {
      return NextResponse.json({ ok: true, dates: [], catData: {}, sectorData: {}, subSectorData: {} })
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
      if (!pctMap.has(r.code)) pctMap.set(r.code, new Map())
      pctMap.get(r.code)!.set(r.date, toNum(r.pct) / 100)
    }

    const allMktDates = [...new Set(pctRows.map(r => r.date))].sort()
    const neededHistory = Math.max(volDays, corrDays)

    // Precompute rollover-cleaned return series per code (same indices as allMktDates)
    const cleanPctByCode = new Map<string, number[]>()
    for (const code of akCodes) {
      const m = pctMap.get(code)
      cleanPctByCode.set(code, zeroRolloverSpikes(allMktDates.map(d => m?.get(d) ?? 0)))
    }

    // 3. For each trading date compute sector-level MCR proportions
    //    MCR formula (same as VaR sandbox pie chart):
    //      dv[i] = sigma[i] * mv[i]  (signed dollar vol)
    //      mcr[i] = |dv[i] * Σⱼ(dv[j] * corr[i,j])|
    //    This exactly matches the "板块边际波动贡献占比" pie in 日间风控VaR沙盒
    type RowData = {
      date: string
      cat: Record<string, number>
      sector: Record<string, number>
      sub: Record<string, number>
    }
    const rows: RowData[] = []

    for (const date of tradingDates) {
      const mktIdx = floorIndex(allMktDates, date)
      if (mktIdx < neededHistory) continue

      const volDatesArr  = allMktDates.slice(mktIdx - volDays,  mktIdx)
      const corrDatesArr = allMktDates.slice(mktIdx - corrDays, mktIdx)

      // Collect active products on this date
      const prodMvs: { prod: string; mv: number }[] = []
      for (const [prod, mvByDate] of prodMvByDate) {
        const mv = mvByDate.get(date) ?? 0
        if (Math.abs(mv) >= 1000) prodMvs.push({ prod, mv })
      }
      if (prodMvs.length === 0) continue

      const N = prodMvs.length

      // Compute sigma per product (rolling volDays window, rollover spikes excluded)
      const sigmas = prodMvs.map(({ prod }) => {
        const code = AKSHARE_CODE[prod]
        const cleanRets = cleanPctByCode.get(code ?? "") ?? []
        const rets = cleanRets.slice(mktIdx - volDays, mktIdx).filter(r => r !== 0)
        return stdDev(rets)
      })

      // dv[i] = sigma[i] * mv[i] (signed)
      const dv = prodMvs.map(({ mv }, i) => sigmas[i] * mv)

      // Return series for correlation (rolling corrDays window)
      const retSeries = prodMvs.map(({ prod }) => {
        const code = AKSHARE_CODE[prod]
        const m = pctMap.get(code ?? "")
        return corrDatesArr.map(d => m?.get(d) ?? 0)
      })

      // Build upper-triangular correlation matrix (reuse for both [i][j] and [j][i])
      const corrMat: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
      for (let i = 0; i < N; i++) {
        corrMat[i][i] = 1
        for (let j = i + 1; j < N; j++) {
          const c = pearsonCorr(retSeries[i], retSeries[j])
          corrMat[i][j] = c
          corrMat[j][i] = c
        }
      }

      // mcr[i] = |dv[i] * (Corr × dv)[i]|  — identical to sandbox prodMcrData formula
      const catMcr:    Record<string, number> = {}
      const sectorMcr: Record<string, number> = {}
      const subMcr:    Record<string, number> = {}
      let totalMcr = 0

      for (let i = 0; i < N; i++) {
        if (dv[i] === 0) continue
        let covSum = 0
        for (let j = 0; j < N; j++) covSum += dv[j] * corrMat[i][j]
        const mcr = Math.abs(dv[i] * covSum)
        if (mcr < 1) continue

        const { prod } = prodMvs[i]
        const cat    = PROD_CAT[prod]        ?? "其他"
        const sector = PROD_SECTOR[prod]     ?? "其他"
        const sub    = PROD_SUB_SECTOR[prod] ?? "其他"

        catMcr[cat]       = (catMcr[cat]       ?? 0) + mcr
        sectorMcr[sector] = (sectorMcr[sector] ?? 0) + mcr
        subMcr[sub]       = (subMcr[sub]       ?? 0) + mcr
        totalMcr += mcr
      }

      if (totalMcr === 0) continue

      const catPct:    Record<string, number> = {}
      const sectorPct: Record<string, number> = {}
      const subPct:    Record<string, number> = {}

      for (const [k, v] of Object.entries(catMcr))    catPct[k]    = Math.round(v / totalMcr * 10000) / 100
      for (const [k, v] of Object.entries(sectorMcr)) sectorPct[k] = Math.round(v / totalMcr * 10000) / 100
      for (const [k, v] of Object.entries(subMcr))    subPct[k]    = Math.round(v / totalMcr * 10000) / 100

      rows.push({ date, cat: catPct, sector: sectorPct, sub: subPct })
    }

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, dates: [], catData: {}, sectorData: {}, subSectorData: {} })
    }

    // 4. Convert to columnar format
    const allCats    = [...new Set(rows.flatMap(r => Object.keys(r.cat)))]
    const allSectors = [...new Set(rows.flatMap(r => Object.keys(r.sector)))]
    const allSubs    = [...new Set(rows.flatMap(r => Object.keys(r.sub)))]

    const catData:       Record<string, number[]> = {}
    const sectorData:    Record<string, number[]> = {}
    const subSectorData: Record<string, number[]> = {}

    for (const g of allCats)    catData[g]       = rows.map(r => r.cat[g]    ?? 0)
    for (const g of allSectors) sectorData[g]    = rows.map(r => r.sector[g] ?? 0)
    for (const g of allSubs)    subSectorData[g] = rows.map(r => r.sub[g]    ?? 0)

    return NextResponse.json({
      ok: true,
      dates: rows.map(r => r.date),
      catData,
      sectorData,
      subSectorData,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, dates: [], catData: {}, sectorData: {}, subSectorData: {} })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("var-sector-timeseries", _GET)
