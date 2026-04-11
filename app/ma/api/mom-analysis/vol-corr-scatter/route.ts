import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getPrefix(contract: string): string {
  return (contract.match(/^[A-Z]+/i)?.[0] ?? contract).toUpperCase()
}
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

const SECTOR_MAP: Record<string, string> = {
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

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
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

function cumulativeSeries(xs: number[]): number[] {
  let acc = 0
  return xs.map((x) => {
    acc += x
    return acc
  })
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const WINDOW = Math.max(5, Math.min(120, parseInt(searchParams.get("window") ?? "20", 10)))
  const CORR_WINDOW = Math.max(5, Math.min(504, parseInt(searchParams.get("corrWindow") ?? String(WINDOW), 10)))

  try {
    // 1. Get MV per product on latest date (to find active products)
    const mvRows = await query<{ contract: string; mv: string }>(
      `SELECT UPPER(TRIM("合约")) AS contract,
              SUM(
                CASE WHEN ${numExpr("买持仓")} > 0
                     THEN  ${numExpr("持仓市値")}
                     ELSE -${numExpr("持仓市値")}
                END
              )::text AS mv
       FROM mom_position_details
       WHERE "交易日期" = (SELECT MAX("交易日期") FROM mom_position_details)
         AND "合约" IS NOT NULL
       GROUP BY UPPER(TRIM("合约"))`,
    )

    // prod → net MV on latest date
    const prodMV = new Map<string, number>()
    for (const r of mvRows) {
      const prod = getPrefix(r.contract)
      prodMV.set(prod, (prodMV.get(prod) ?? 0) + toNum(r.mv))
    }
    const activeProds = [...prodMV.keys()].filter((p) => Math.abs(prodMV.get(p)!) > 1000)

    if (activeProds.length === 0) {
      return NextResponse.json({ ok: true, points: [], window: WINDOW })
    }

    // 2. Fetch actual PnL per product per date (close PnL + position PnL + fees)
    const [closeRows, posRows] = await Promise.all([
      query<{ date: string; contract: string; pnl: string }>(
        `SELECT "交易日期"::text AS date, UPPER(TRIM("合约")) AS contract,
                SUM(${numExpr("平仓盈亏")})::text AS pnl
         FROM mom_futures_trade_details
         WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
         GROUP BY "交易日期", UPPER(TRIM("合约")) ORDER BY 1`,
      ),
      query<{ date: string; contract: string; pnl: string }>(
        `SELECT "交易日期"::text AS date, UPPER(TRIM("合约")) AS contract,
                SUM(${numExpr("持仓盈亏")})::text AS pnl
         FROM mom_position_details
         WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
         GROUP BY "交易日期", UPPER(TRIM("合约")) ORDER BY 1`,
      ),
    ])
    let feeRows: { date: string; contract: string; fee: string; premium: string }[] = []
    try {
      feeRows = await query<{ date: string; contract: string; fee: string; premium: string }>(
        `SELECT trade_date::text AS date, UPPER(TRIM("合约")) AS contract,
                SUM(${numExpr("手续费")})::text AS fee,
                SUM(${numExpr("权利金收支")})::text AS premium
         FROM mom_trade_details
         WHERE trade_date IS NOT NULL AND "合约" IS NOT NULL
         GROUP BY trade_date, UPPER(TRIM("合约")) ORDER BY 1`,
      )
    } catch { /* optional */ }

    // prod → date → pnl
    const prodPnlMap = new Map<string, Map<string, number>>()
    const totalPnlMap = new Map<string, number>()
    const addPnl = (contract: string, date: string, pnl: number) => {
      const prod = getPrefix(contract)
      if (!prodPnlMap.has(prod)) prodPnlMap.set(prod, new Map())
      prodPnlMap.get(prod)!.set(date, (prodPnlMap.get(prod)!.get(date) ?? 0) + pnl)
      totalPnlMap.set(date, (totalPnlMap.get(date) ?? 0) + pnl)
    }
    for (const r of closeRows) addPnl(r.contract, r.date, toNum(r.pnl))
    for (const r of posRows)   addPnl(r.contract, r.date, toNum(r.pnl))
    for (const r of feeRows)   addPnl(r.contract, r.date, -toNum(r.fee) + toNum(r.premium))

    // All trading dates sorted, take last WINDOW
    const allTradingDates = [...totalPnlMap.keys()].sort()
    const lastDates = allTradingDates.slice(-WINDOW)

    // Portfolio PnL series
    const portPnl = lastDates.map((dt) => totalPnlMap.get(dt) ?? 0)
    const portCumPnl = cumulativeSeries(portPnl)

    // 3. Fetch market pct_change for volatility
    const akCodes = [...new Set(activeProds.map((p) => AKSHARE_CODE[p]).filter(Boolean))]
    const pctRows = await query<{ date: string; code: string; pct: string }>(
      `SELECT trade_date::text AS date, code, pct_change::text AS pct
       FROM raw_akshare_futures_daily
       WHERE code = ANY($1) AND pct_change IS NOT NULL
       ORDER BY trade_date`,
      [akCodes],
    )
    const pctByCode = new Map<string, Map<string, number>>()
    for (const r of pctRows) {
      if (!pctByCode.has(r.code)) pctByCode.set(r.code, new Map())
      pctByCode.get(r.code)!.set(r.date, toNum(r.pct) / 100)
    }
    const allMktDates = [...new Set(pctRows.map((r) => r.date))].sort()
    const lastMktDates = allMktDates.slice(-WINDOW)

    // 4. Build signed-weight portfolio market return series for MVC
    // w_i = signedNetMV_i / totalAbsMV  (positive = net long, negative = net short)
    const totalAbsMV = [...prodMV.values()].reduce((s, v) => s + Math.abs(v), 0)
    // portfolio market return on each mkt date = sum of w_i * r_i_t
    const portMktRet = lastMktDates.map((dt) => {
      let ret = 0
      for (const prod of activeProds) {
        const code = AKSHARE_CODE[prod]
        if (!code) continue
        const w = (prodMV.get(prod) ?? 0) / totalAbsMV   // signed weight
        ret += w * (pctByCode.get(code)?.get(dt) ?? 0)
      }
      return ret
    })
    const portMktVol = stdDev(portMktRet)  // portfolio vol from market returns

    // 5. Per product: vol, corr, mvc
    type Point = { prod: string; sector: string; vol: number; corr: number; mv: number; mvc: number }
    const points: Point[] = []

    for (const prod of activeProds) {
      const signedMV = prodMV.get(prod) ?? 0
      const netMV = Math.abs(signedMV)
      if (netMV < 1000) continue

      // Volatility: market return std dev over window
      const code = AKSHARE_CODE[prod]
      const mktRets = code
        ? lastMktDates.map((dt) => pctByCode.get(code)?.get(dt) ?? 0)
        : []
      const nonZeroRets = mktRets.filter((r) => r !== 0)
      if (nonZeroRets.length < 3) continue
      const vol = Math.round(stdDev(nonZeroRets) * 10000) / 100  // daily vol as %

      // Correlation: cumulative PnL path vs portfolio cumulative PnL path
      const prodPnl = lastDates.map((dt) => prodPnlMap.get(prod)?.get(dt) ?? 0)
      const prodCumPnl = cumulativeSeries(prodPnl)
      const corr = Math.round(pearsonCorr(prodCumPnl, portCumPnl) * 1000) / 1000

      // Marginal Volatility Contribution: mvc_i = w_i * σ_i * ρ(r_i, r_portfolio)
      // expressed as % of portfolio vol so all products sum to 100%
      const w = signedMV / totalAbsMV
      const mktCorrWithPort = portMktVol > 0 ? pearsonCorr(mktRets, portMktRet) : 0
      const mktSigma = stdDev(mktRets)
      const mvcRaw = w * mktSigma * mktCorrWithPort      // contribution to portMktVol
      const mvc = portMktVol > 0 ? Math.round(mvcRaw / portMktVol * 10000) / 100 : 0  // %

      const mv = Math.round(netMV / 10000) / 100  // 万

      points.push({ prod, sector: SECTOR_MAP[prod] ?? "其他", vol, corr, mv, mvc })
    }

    // 6. Pairwise correlation matrix — uses CORR_WINDOW (may differ from WINDOW)
    const corrMktDates = allMktDates.slice(-CORR_WINDOW)
    const matrixProds = points.map((p) => p.prod)
    const matrixRets = matrixProds.map((prod) => {
      const code = AKSHARE_CODE[prod]
      return code ? corrMktDates.map((dt) => pctByCode.get(code)?.get(dt) ?? 0) : []
    })
    const corrMatrixData: [number, number, number][] = []
    for (let i = 0; i < matrixProds.length; i++) {
      for (let j = 0; j < matrixProds.length; j++) {
        const c = i === j ? 1 : Math.round(pearsonCorr(matrixRets[i], matrixRets[j]) * 100) / 100
        corrMatrixData.push([j, i, c])  // [xIdx, yIdx, value] — yIdx=i so first prod is top row
      }
    }

    return NextResponse.json({ ok: true, points, corrMatrix: { prods: matrixProds, data: corrMatrixData }, window: WINDOW, corrWindow: CORR_WINDOW })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[vol-corr-scatter]", msg)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, points: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
