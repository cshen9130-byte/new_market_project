import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

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

const Z_TABLE:        Record<string, number> = { "90": 1.282,  "95": 1.6449, "99": 2.326 }
const T6_TABLE:       Record<string, number> = { "90": 1.440,  "95": 1.943,  "99": 3.143 }
const LAPLACE_TABLE:  Record<string, number> = { "90": 1.138,  "95": 1.629,  "99": 2.767 }
const LOGISTIC_TABLE: Record<string, number> = { "90": 1.211,  "95": 1.623,  "99": 2.532 }

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const confidence = searchParams.get("confidence") ?? "95"
  const volDays    = Math.max(5, Math.min(120, parseInt(searchParams.get("volDays")  ?? "20",  10)))
  const corrDays   = Math.max(5, Math.min(756, parseInt(searchParams.get("corrDays") ?? "252", 10)))
  const distModel  = searchParams.get("distModel") ?? "normal"

  const Z_SCORE = distModel === "t"        ? (T6_TABLE[confidence]       ?? 1.943)
                : distModel === "laplace"  ? (LAPLACE_TABLE[confidence]  ?? 1.629)
                : distModel === "logistic" ? (LOGISTIC_TABLE[confidence] ?? 1.623)
                :                            (Z_TABLE[confidence]        ?? 1.6449)

  try {
    // 1. Latest day positions: signed mv + net lots per contract (futures only)
    const mvRows = await query<{ contract: string; mv: string; lots: string }>(
      `SELECT UPPER(TRIM("合约")) AS contract,
              SUM(
                CASE WHEN ${numExpr("买持仓")} > 0
                     THEN  ${numExpr("持仓市値")}
                     ELSE -${numExpr("持仓市値")}
                END
              )::text AS mv,
              SUM(
                CASE WHEN ${numExpr("买持仓")} > 0
                     THEN  ${numExpr("买持仓")}
                     ELSE -${numExpr("卖持仓")}
                END
              )::text AS lots
       FROM mom_position_details
       WHERE "交易日期" = (
         SELECT MAX("交易日期") FROM mom_position_details WHERE "交易日期" IS NOT NULL
       )
         AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
         AND TRIM("合约") NOT LIKE '%-%-%'
       GROUP BY UPPER(TRIM("合约"))`,
    )

    // 2. Latest trading date
    const dateRow = await query<{ date: string }>(
      `SELECT MAX("交易日期")::text AS date FROM mom_position_details WHERE "交易日期" IS NOT NULL`,
    )
    const latestDate = dateRow[0]?.date ?? ""

    // 3. Aggregate to product prefix level
    const prodMvMap   = new Map<string, number>()
    const prodLotsMap = new Map<string, number>()
    for (const r of mvRows) {
      const prod = getPrefix(r.contract)
      prodMvMap.set(prod,   (prodMvMap.get(prod)   ?? 0) + toNum(r.mv))
      prodLotsMap.set(prod, (prodLotsMap.get(prod) ?? 0) + Math.round(toNum(r.lots)))
    }

    // Sort by abs(mv) descending — this order is shared with corrMatrix
    const activeProds = [...prodMvMap.keys()]
      .filter(p => Math.abs(prodMvMap.get(p)!) > 1000)
      .sort((a, b) => Math.abs(prodMvMap.get(b)!) - Math.abs(prodMvMap.get(a)!))

    if (activeProds.length === 0) {
      return NextResponse.json({ ok: true, date: latestDate, products: [], corrMatrix: [], zScore: Z_SCORE, confidence })
    }

    // 4. Fetch market pct_change for sigma + correlation
    const akCodes = [...new Set(activeProds.map(p => AKSHARE_CODE[p]).filter(Boolean))]
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
    const volDatesArr  = allMktDates.slice(-volDays)
    const corrDatesArr = allMktDates.slice(-corrDays)

    // 5. Correlation matrix (same order as activeProds)
    const retSeries = activeProds.map(prod => {
      const code = AKSHARE_CODE[prod]
      if (!code) return corrDatesArr.map(() => 0)
      const m = pctMap.get(code)
      return corrDatesArr.map(d => m?.get(d) ?? 0)
    })
    const N = activeProds.length
    const corrMatrix: number[][] = Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (__, j) =>
        i === j ? 1 : Math.round(pearsonCorr(retSeries[i], retSeries[j]) * 10000) / 10000
      )
    )

    // 6. Per-product sigma + build output
    const products = activeProds.map(prod => {
      const mv   = prodMvMap.get(prod)!
      const lots = prodLotsMap.get(prod) ?? 0
      // lotMv: absolute value per lot (always positive)
      const lotMv = Math.abs(lots) > 0
        ? Math.abs(mv) / Math.abs(lots)
        : Math.abs(mv)   // fallback: treat whole position as 1 lot

      const code = AKSHARE_CODE[prod]
      const m    = pctMap.get(code ?? "")
      const rets = volDatesArr.map(d => m?.get(d) ?? 0).filter(r => r !== 0)
      const sigma = stdDev(rets)

      return {
        prod,
        mv:    Math.round(mv),
        lots,
        sigma: Math.round(sigma * 1e6) / 1e6,
        lotMv: Math.round(lotMv),
      }
    })

    return NextResponse.json({
      ok: true,
      date: latestDate,
      products,
      corrMatrix,
      zScore: Z_SCORE,
      confidence,
      volDays,
      corrDays,
      distModel,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[var-sandbox]", msg)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, date: null, products: [], corrMatrix: [], zScore: Z_SCORE, confidence })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("var-sandbox", _GET)
