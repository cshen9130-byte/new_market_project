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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const WINDOW = Math.max(5, Math.min(120, parseInt(searchParams.get("window") ?? "20", 10)))

  try {
    // 1. Get MV per product (to find which products are actively held)
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

    // 2. Fetch market returns for all active products
    const akCodes = [...new Set(activeProds.map((p) => AKSHARE_CODE[p]).filter(Boolean))]
    const pctRows = await query<{ date: string; code: string; pct: string }>(
      `SELECT trade_date::text AS date, code, pct_change::text AS pct
       FROM raw_akshare_futures_daily
       WHERE code = ANY($1) AND pct_change IS NOT NULL
       ORDER BY trade_date`,
      [akCodes],
    )

    // code → sorted array of returns
    const pctByCode = new Map<string, { date: string; ret: number }[]>()
    for (const r of pctRows) {
      if (!pctByCode.has(r.code)) pctByCode.set(r.code, [])
      pctByCode.get(r.code)!.push({ date: r.date, ret: toNum(r.pct) / 100 })
    }

    // All market dates sorted
    const allDates = [...new Set(pctRows.map((r) => r.date))].sort()
    const last20Dates = allDates.slice(-WINDOW)

    // 3. Build portfolio return series over last WINDOW days
    //    Portfolio daily return = weighted average of product returns by net MV
    const totalMV = activeProds.reduce((s, p) => s + Math.abs(prodMV.get(p)!), 0)

    const portRets: number[] = last20Dates.map((dt) => {
      let r = 0
      for (const prod of activeProds) {
        const code = AKSHARE_CODE[prod]
        if (!code) continue
        const entry = pctByCode.get(code)?.find((e) => e.date === dt)
        const weight = (prodMV.get(prod) ?? 0) / totalMV  // signed weight
        r += (entry?.ret ?? 0) * weight
      }
      return r
    })

    // 4. Per product: vol + corr to portfolio
    type Point = {
      prod: string; sector: string; vol: number; corr: number; mv: number
    }
    const points: Point[] = []

    for (const prod of activeProds) {
      const code = AKSHARE_CODE[prod]
      if (!code) continue
      const codeMap = new Map(pctByCode.get(code)?.map((e) => [e.date, e.ret]) ?? [])
      const rets = last20Dates.map((dt) => codeMap.get(dt) ?? 0)

      const nonZero = rets.filter((r) => r !== 0)
      if (nonZero.length < 3) continue

      const vol  = Math.round(stdDev(nonZero) * 10000) / 100          // as % annualized-like, stored as decimal×100
      const corr = Math.round(pearsonCorr(rets, portRets) * 1000) / 1000
      const mv   = Math.round(Math.abs(prodMV.get(prod) ?? 0) / 10000) / 100  // 万

      points.push({
        prod,
        sector: SECTOR_MAP[prod] ?? "其他",
        vol,
        corr,
        mv,
      })
    }

    return NextResponse.json({ ok: true, points, window: WINDOW })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[vol-corr-scatter]", msg)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, points: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
