import { query as defaultQuery } from "@/lib/db"
import { getPrefix } from "@/lib/server/prod-utils"
import {
  assemblePositionVarDay,
  floorIndex,
  pearsonCorr,
  stdDev,
  zeroRolloverSpikes,
  type PositionVarDay,
} from "@/lib/server/mom-position-var-math"

type RunQuery = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>

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

/** MOM book only. 国信 / 监控中心单账户 never enter this series. */
export const MOM_BOOK_ACCOUNT_SQL = `
  AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
  AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
  AND TRIM("账户"::text) NOT LIKE '%国信%'
  AND TRIM("账户"::text) <> '665300200077'`

export type MomPositionVarShares = {
  dates: string[]
  catData: Record<string, number[]>
  sectorData: Record<string, number[]>
  subSectorData: Record<string, number[]>
}

const EMPTY_SHARES: MomPositionVarShares = {
  dates: [],
  catData: {},
  sectorData: {},
  subSectorData: {},
}

function sharesFrom(days: PositionVarDay[]): MomPositionVarShares {
  if (days.length === 0) return EMPTY_SHARES
  const allCats = [...new Set(days.flatMap((day) => Object.keys(day.cat)))]
  const allSectors = [...new Set(days.flatMap((day) => Object.keys(day.sector)))]
  const allSubs = [...new Set(days.flatMap((day) => Object.keys(day.sub)))]
  const catData: Record<string, number[]> = {}
  const sectorData: Record<string, number[]> = {}
  const subSectorData: Record<string, number[]> = {}
  for (const name of allCats) catData[name] = days.map((day) => day.cat[name] ?? 0)
  for (const name of allSectors) sectorData[name] = days.map((day) => day.sector[name] ?? 0)
  for (const name of allSubs) subSectorData[name] = days.map((day) => day.sub[name] ?? 0)
  return {
    dates: days.map((day) => day.date),
    catData,
    sectorData,
    subSectorData,
  }
}

/**
 * Parametric position VaR for each MOM settlement date.
 * Share series match /ma/api/mom-analysis/var-sector-timeseries.
 * `fromDate` skips earlier settlement dates after prices are loaded; the share
 * series then covers only the computed dates.
 */
export async function computeMomPositionVarHistory(opts: {
  volDays: number
  corrDays: number
  accountSql?: string
  sleeveSql?: string
  params?: unknown[]
  fromDate?: string | null
  runQuery?: RunQuery
  zScore?: number
}): Promise<{ shares: MomPositionVarShares; days: PositionVarDay[] }> {
  const runQuery = opts.runQuery ?? defaultQuery
  const volDays = opts.volDays
  const corrDays = opts.corrDays
  const accountSql = opts.accountSql ?? ""
  const sleeveSql = opts.sleeveSql ?? ""
  const params = opts.params ?? []
  const fromDate = opts.fromDate ?? null

  const mvRows = await runQuery<{ date: string; contract: string; mv: string; lots: string }>(
    `SELECT "交易日期"::text AS date, UPPER(TRIM("合约")) AS contract,
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
     WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
       ${MOM_BOOK_ACCOUNT_SQL}
       AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
       AND TRIM("合约") NOT LIKE '%-%-%'${accountSql}${sleeveSql}
     GROUP BY "交易日期", UPPER(TRIM("合约"))
     ORDER BY 1`,
    params,
  )

  if (mvRows.length === 0) return { shares: EMPTY_SHARES, days: [] }

  const prodMvByDate = new Map<string, Map<string, number>>()
  const prodLotsByDate = new Map<string, Map<string, number>>()
  for (const row of mvRows) {
    const prod = getPrefix(row.contract)
    if (!prodMvByDate.has(prod)) prodMvByDate.set(prod, new Map())
    if (!prodLotsByDate.has(prod)) prodLotsByDate.set(prod, new Map())
    const mvMap = prodMvByDate.get(prod)!
    const lotsMap = prodLotsByDate.get(prod)!
    mvMap.set(row.date, (mvMap.get(row.date) ?? 0) + toNum(row.mv))
    lotsMap.set(row.date, (lotsMap.get(row.date) ?? 0) + Math.round(toNum(row.lots)))
  }

  const tradingDates = [...new Set(mvRows.map((row) => row.date))].sort()
  const allProds = [...prodMvByDate.keys()]
  const akCodes = [...new Set(allProds.map((prod) => AKSHARE_CODE[prod]).filter(Boolean))]
  if (akCodes.length === 0) return { shares: EMPTY_SHARES, days: [] }

  const pctRows = await runQuery<{ date: string; code: string; pct: string }>(
    `SELECT trade_date::text AS date, code, pct_change::text AS pct
     FROM raw_akshare_futures_daily
     WHERE code = ANY($1) AND pct_change IS NOT NULL
     ORDER BY trade_date`,
    [akCodes],
  )

  const pctMap = new Map<string, Map<string, number>>()
  for (const row of pctRows) {
    if (!pctMap.has(row.code)) pctMap.set(row.code, new Map())
    pctMap.get(row.code)!.set(row.date, toNum(row.pct) / 100)
  }

  const allMktDates = [...new Set(pctRows.map((row) => row.date))].sort()
  const neededHistory = Math.max(volDays, corrDays)
  const cleanPctByCode = new Map<string, number[]>()
  for (const code of akCodes) {
    const series = pctMap.get(code)
    cleanPctByCode.set(code, zeroRolloverSpikes(allMktDates.map((date) => series?.get(date) ?? 0)))
  }

  const days: PositionVarDay[] = []
  for (const date of tradingDates) {
    if (fromDate && date < fromDate) continue
    const mktIdx = floorIndex(allMktDates, date)
    if (mktIdx < neededHistory) continue

    const corrDatesArr = allMktDates.slice(mktIdx - corrDays, mktIdx)
    const prodMvs: { prod: string; mv: number; lots: number }[] = []
    for (const [prod, mvByDate] of prodMvByDate) {
      const mv = mvByDate.get(date) ?? 0
      if (Math.abs(mv) >= 1000) {
        prodMvs.push({ prod, mv, lots: prodLotsByDate.get(prod)?.get(date) ?? 0 })
      }
    }
    if (prodMvs.length === 0) continue

    const sigmas = prodMvs.map(({ prod }) => {
      const code = AKSHARE_CODE[prod]
      const cleanRets = cleanPctByCode.get(code ?? "") ?? []
      const rets = cleanRets.slice(mktIdx - volDays, mktIdx).filter((ret) => ret !== 0)
      return stdDev(rets)
    })
    const retSeries = prodMvs.map(({ prod }) => {
      const code = AKSHARE_CODE[prod]
      const series = pctMap.get(code ?? "")
      return corrDatesArr.map((marketDate) => series?.get(marketDate) ?? 0)
    })
    const count = prodMvs.length
    const corrMat: number[][] = Array.from({ length: count }, () => new Array(count).fill(0))
    for (let i = 0; i < count; i++) {
      corrMat[i][i] = 1
      for (let j = i + 1; j < count; j++) {
        const corr = pearsonCorr(retSeries[i], retSeries[j])
        corrMat[i][j] = corr
        corrMat[j][i] = corr
      }
    }

    const day = assemblePositionVarDay({
      date,
      products: prodMvs.map((product, index) => ({
        prod: product.prod,
        mv: product.mv,
        lots: product.lots,
        sigma: sigmas[index],
      })),
      corr: corrMat,
      zScore: opts.zScore,
    })
    if (day) days.push(day)
  }

  return { shares: sharesFrom(days), days }
}
