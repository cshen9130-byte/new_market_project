import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"
import { getPrefix } from "@/lib/server/prod-utils"
import { isQuantAccountIn, parseQuantIdList, accountNumericId } from "@/lib/ma/quant-accounts"
import { buildMomSignals, classifyExposure } from "@/lib/ma/quant-vs-subjective-signals"
import type { SignalKind } from "@/lib/ma/quant-vs-subjective-signals"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return Number.isFinite(n) ? n : 0
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

const ACCOUNT_EXCL = `
  UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
  AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
  AND TRIM("账户"::text) NOT LIKE '%国信%'
  AND TRIM("账户"::text) <> '665300200077'
`

const NON_DIGIT = "[^" + "0-9]"

function sleeveSql(quantIds: number[]): string {
  if (!quantIds.length) return "'subjective'"
  const list = quantIds.map((id) => `'${id}'`).join(",")
  const digits = `regexp_replace(TRIM("账户"), '${NON_DIGIT}', '', 'g')`
  const norm = `COALESCE(NULLIF(TRIM(LEADING '0' FROM ${digits}), ''), '0')`
  return (
    "CASE WHEN " + digits + " = '' THEN 'subjective' " +
    "WHEN " + norm + " IN (" + list + ") THEN 'quant' ELSE 'subjective' END"
  )
}

const CAT_MAP: Record<string, string> = {
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}
function getCat(prefix: string): string {
  return CAT_MAP[prefix] ?? "商品"
}

const SECTOR_MAP: Record<string, string> = {
  C: "农产", CS: "农产", WH: "农产", PM: "农产", RR: "农产", RI: "农产", JR: "农产", LR: "农产",
  A: "农产", B: "农产", M: "农产", Y: "农产", RM: "农产", OI: "农产", RS: "农产", PK: "农产", P: "农产",
  SR: "农产", CF: "农产", CY: "农产", LG: "农产", SP: "农产", OP: "农产",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "黑色", SF: "黑色", SM: "黑色", RB: "黑色", HC: "黑色", SS: "黑色", WR: "黑色",
  JM: "黑色", J: "黑色", ZC: "黑色", FG: "黑色", BB: "黑色", FB: "黑色",
  SC: "能源化工", FU: "能源化工", LU: "能源化工", PG: "能源化工", BU: "能源化工",
  TA: "能源化工", EG: "能源化工", PF: "能源化工", PR: "能源化工",
  PL: "能源化工", PP: "能源化工", L: "能源化工",
  BZ: "能源化工", PX: "能源化工", EB: "能源化工",
  RU: "能源化工", BR: "能源化工", NR: "能源化工",
  SA: "能源化工", SH: "能源化工", V: "能源化工",
  UR: "能源化工", MA: "能源化工",
  EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}

const SECTORS = ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债", "其他"] as const

const PROD_NAMES: Record<string, string> = {
  C: "玉米", CS: "淀粉", WH: "强麦", PM: "普麦", RR: "粳米", RI: "早籼稻", JR: "粳稻", LR: "晚籼稻",
  A: "黄大豆1号", B: "黄大豆2号", M: "豆粕", Y: "豆油", RM: "菜籽粕", OI: "菜籽油", RS: "油菜籽", PK: "花生", P: "棕榈油",
  SR: "白糖", CF: "棉花", CY: "棉纱", LG: "原木", SP: "纸浆", OP: "双胶纸",
  AP: "苹果", CJ: "红枣", LH: "生猪", JD: "鸡蛋",
  AU: "黄金", AG: "白银", PT: "铂", PD: "钯",
  CU: "沪铜", BC: "国际铜", AL: "沪铝", AO: "氧化铝", AD: "铝合金", ZN: "沪锌", PB: "沪铅", NI: "沪镍", SN: "沪锡",
  LC: "碳酸锂", PS: "多晶硅", SI: "工业硅",
  I: "铁矿石", SF: "硅铁", SM: "锰硅", RB: "螺纹钢", HC: "热卷", SS: "不锈钢", WR: "线材",
  JM: "焦煤", J: "焦炭", ZC: "动力煤", FG: "玻璃", BB: "胶合板", FB: "纤维板",
  SC: "原油", FU: "燃料油", LU: "低硫燃料油", PG: "液化石油气", BU: "沥青",
  TA: "PTA", EG: "乙二醇", PF: "短纤", PR: "瓶片", PL: "丙烯", PP: "聚丙烯", L: "塑料",
  BZ: "纯苯", PX: "对二甲苯", EB: "苯乙烯",
  RU: "天然橡胶", BR: "丁二烯橡胶", NR: "20号胶",
  SA: "纯碱", SH: "烧碱", V: "PVC", UR: "尿素", MA: "甲醇",
  EC: "航运指数",
  IH: "上证50", IF: "沪深300", IC: "中证500", IM: "中证1000", MO: "中证1000期权",
  TS: "2年期国债", TF: "5年期国债", T: "10年期国债", TL: "30年期国债",
}

function getSector(prefix: string): string {
  return SECTOR_MAP[prefix] ?? "其他"
}

const SUB_SECTOR_MAP: Record<string, string> = {
  C: "谷物", CS: "谷物", WH: "谷物", PM: "谷物", RR: "谷物", RI: "谷物", JR: "谷物", LR: "谷物",
  A: "油脂油料", B: "油脂油料", M: "油脂油料", Y: "油脂油料", RM: "油脂油料", OI: "油脂油料", RS: "油脂油料", PK: "油脂油料", P: "油脂油料",
  SR: "软商品", CF: "软商品", CY: "软商品",
  LG: "林业", SP: "林业", OP: "林业",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "原材", SF: "原材", SM: "原材",
  RB: "成材", HC: "成材", SS: "成材", WR: "成材",
  JM: "煤炭", J: "煤炭", ZC: "煤炭",
  FG: "建材", BB: "建材", FB: "建材",
  SC: "油品", FU: "油品", LU: "油品", PG: "油品", BU: "油品",
  TA: "聚酯", EG: "聚酯", PF: "聚酯", PR: "聚酯",
  PL: "烯烃", PP: "烯烃", L: "烯烃",
  BZ: "芳烃", PX: "芳烃", EB: "芳烃",
  RU: "橡胶", BR: "橡胶", NR: "橡胶",
  SA: "盐化工", SH: "盐化工", V: "盐化工",
  UR: "煤化工", MA: "煤化工",
  EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}
function getSubSector(prefix: string): string {
  return SUB_SECTOR_MAP[prefix] ?? "其他"
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round0(n: number): number {
  return Math.round(n)
}

const VOL_DAYS = 20

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

function zeroRolloverSpikes(rets: number[]): number[] {
  if (rets.length < 2) return [...rets]
  const MIN_THRESHOLD = 0.06, K = 12, LOOKBACK = 40
  const out = [...rets]
  for (let i = LOOKBACK; i < rets.length; i++) {
    const win = rets.slice(i - LOOKBACK, i).map(Math.abs).sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    const devs = win.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
    const mad = devs[Math.floor(devs.length / 2)]
    const thr = Math.max(MIN_THRESHOLD, med + K * mad * 1.4826)
    if (Math.abs(rets[i]) > thr) out[i] = 0
  }
  return out
}

function floorIndex(arr: string[], target: string): number {
  let lo = 0, hi = arr.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= target) { idx = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return idx
}

type Sleeve = "quant" | "subjective"

interface SleeveMv {
  longMv: number
  shortMv: number
  netMv: number
  equityPctGroup: number
  equityPctBook: number
  grossPctGroup: number
  riskPctGroup: number
  riskPctBook: number
}

interface CompareRow {
  key: string
  name: string
  sector?: string
  volAnnPct?: number
  quant: SleeveMv
  subjective: SleeveMv
  signal: SignalKind
  consensusScore: number
}

function buildSleeve(
  longMv: number,
  shortMv: number,
  longRisk: number,
  shortRisk: number,
  posMargin: number,
  groupMargin: number,
  bookMargin: number,
  groupGrossRisk: number,
  bookGrossRisk: number,
): SleeveMv {
  const netMv = longMv - shortMv
  const gross = longMv + shortMv
  const netRisk = longRisk - shortRisk
  return {
    longMv: round0(longMv),
    shortMv: round0(shortMv),
    netMv: round0(netMv),
    equityPctGroup: groupMargin > 0 ? round1((posMargin / groupMargin) * 100) : 0,
    equityPctBook: bookMargin > 0 ? round1((posMargin / bookMargin) * 100) : 0,
    grossPctGroup: groupMargin > 0 ? round1((gross / groupMargin) * 100) : 0,
    riskPctGroup: groupGrossRisk > 0 ? round1((netRisk / groupGrossRisk) * 100) : 0,
    riskPctBook: bookGrossRisk > 0 ? round1((netRisk / bookGrossRisk) * 100) : 0,
  }
}

async function _GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const dateParam = searchParams.get("date")
    const quantIds = parseQuantIdList(searchParams.get("quantIds"))
    const quantIdSet = new Set(quantIds.map(String))
    const inQuant = (acc: string) => isQuantAccountIn(acc, quantIdSet)
    const SLEEVE_EXPR = sleeveSql(quantIds)

    const latestRows = await query<{ date: string }>(
      `SELECT DISTINCT "交易日期"::date::text AS date
       FROM mom_position_details
       WHERE "交易日期" IS NOT NULL AND ${ACCOUNT_EXCL}
       ORDER BY date DESC LIMIT 1`,
    )
    const date = dateParam || latestRows[0]?.date
    if (!date) {
      return NextResponse.json({ ok: true, date: null, groups: null, sectors: [], products: [], signals: [], sectorTs: [], productTs: [] })
    }

    const optionRe = "[0-9]" + "[CP]" + "[0-9]"
    const optionExcl =
      " AND UPPER(TRIM(\"合约\")) !~ '" + optionRe + "'" +
      " AND TRIM(\"合约\") NOT LIKE '%-%-%'"

    const [posRows, eqRows, tsPosRows, pctRows] = await Promise.all([
      query<{ account: string; contract: string; long_mv: string; short_mv: string; margin: string }>(
        `SELECT
           TRIM("账户") AS account,
           UPPER(TRIM("合约")) AS contract,
           SUM(CASE WHEN ${numExpr("买持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS long_mv,
           SUM(CASE WHEN ${numExpr("卖持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS short_mv,
           SUM(${numExpr("保证金")})::text AS margin
         FROM mom_position_details
         WHERE "交易日期"::date = $1::date
           AND "合约" IS NOT NULL
           AND ${ACCOUNT_EXCL}
           ${optionExcl}
         GROUP BY TRIM("账户"), UPPER(TRIM("合约"))`,
        [date],
      ),
      query<{ account: string; equity: string; margin: string }>(
        `SELECT
           TRIM("账户") AS account,
           ${numExpr("客户权益")}::text AS equity,
           ${numExpr("保证金占用")}::text AS margin
         FROM mom_daily_reports
         WHERE "交易日期"::date = $1::date
           AND ${ACCOUNT_EXCL}`,
        [date],
      ),
      query<{ date: string; sleeve: string; contract: string; long_mv: string; short_mv: string; margin: string }>(
        `SELECT
           "交易日期"::date::text AS date,
           ${SLEEVE_EXPR} AS sleeve,
           UPPER(TRIM("合约")) AS contract,
           SUM(CASE WHEN ${numExpr("买持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS long_mv,
           SUM(CASE WHEN ${numExpr("卖持仓")} > 0 THEN ${numExpr("持仓市値")} ELSE 0 END)::text AS short_mv,
           SUM(${numExpr("保证金")})::text AS margin
         FROM mom_position_details
         WHERE "交易日期"::date > $1::date - INTERVAL '400 days'
           AND "交易日期"::date <= $1::date
           AND "合约" IS NOT NULL
           AND ${ACCOUNT_EXCL}
           ${optionExcl}
         GROUP BY "交易日期"::date, ${SLEEVE_EXPR}, UPPER(TRIM("合约"))`,
        [date],
      ),
      query<{ date: string; code: string; pct: string }>(
        `SELECT trade_date::text AS date, code, pct_change::text AS pct
         FROM raw_akshare_futures_daily
         WHERE code = ANY($1) AND pct_change IS NOT NULL
           AND trade_date > $2::date - INTERVAL '450 days'
           AND trade_date <= $2::date
         ORDER BY trade_date`,
        [Object.values(AKSHARE_CODE), date],
      ).catch(() => [] as { date: string; code: string; pct: string }[]),
    ])

    const equityMap = new Map<string, { equity: number; margin: number; group: Sleeve }>()
    for (const r of eqRows) {
      const acc = r.account?.trim() ?? ""
      if (!acc) continue
      equityMap.set(acc, {
        equity: toNum(r.equity),
        margin: toNum(r.margin),
        group: inQuant(acc) ? "quant" : "subjective",
      })
    }
    for (const r of posRows) {
      const acc = r.account?.trim() ?? ""
      if (!acc || equityMap.has(acc)) continue
      equityMap.set(acc, { equity: 0, margin: 0, group: inQuant(acc) ? "quant" : "subjective" })
    }

    const groups = {
      quant: { accounts: [] as string[], nAccounts: 0, equity: 0, margin: 0 },
      subjective: { accounts: [] as string[], nAccounts: 0, equity: 0, margin: 0 },
    }
    for (const [acc, info] of equityMap) {
      groups[info.group].accounts.push(acc)
      groups[info.group].nAccounts += 1
      groups[info.group].equity += info.equity
      groups[info.group].margin += info.margin
    }
    groups.quant.accounts.sort()
    groups.subjective.accounts.sort()
    groups.quant.equity = round0(groups.quant.equity)
    groups.quant.margin = round0(groups.quant.margin)
    groups.subjective.equity = round0(groups.subjective.equity)
    groups.subjective.margin = round0(groups.subjective.margin)

    const bookEq = groups.quant.equity + groups.subjective.equity
    const bookMargin = groups.quant.margin + groups.subjective.margin
    const presentQuantIds = new Set(groups.quant.accounts.map((a) => accountNumericId(a)))
    const missingQuantIds = quantIds.filter((id) => !presentQuantIds.has(String(id)))

    type Bucket = { long: number; short: number; margin: number }
    const sectorBuckets: Record<Sleeve, Record<string, Bucket>> = { quant: {}, subjective: {} }
    const prodBuckets: Record<Sleeve, Record<string, Bucket>> = { quant: {}, subjective: {} }
    const add = (map: Record<string, Bucket>, key: string, longMv: number, shortMv: number, margin: number) => {
      if (!map[key]) map[key] = { long: 0, short: 0, margin: 0 }
      map[key].long += longMv
      map[key].short += shortMv
      map[key].margin += margin
    }

    for (const r of posRows) {
      const acc = r.account?.trim() ?? ""
      const group: Sleeve = inQuant(acc) ? "quant" : "subjective"
      const prefix = getPrefix(r.contract)
      if (!prefix) continue
      const longMv = toNum(r.long_mv)
      const shortMv = toNum(r.short_mv)
      const margin = toNum(r.margin)
      if (longMv === 0 && shortMv === 0 && margin === 0) continue
      add(sectorBuckets[group], getSector(prefix), longMv, shortMv, margin)
      add(prodBuckets[group], prefix, longMv, shortMv, margin)
    }

    const pctMap = new Map<string, Map<string, number>>()
    for (const r of pctRows) {
      if (!pctMap.has(r.code)) pctMap.set(r.code, new Map())
      pctMap.get(r.code)!.set(r.date, toNum(r.pct) / 100)
    }
    const allMktDates = [...new Set(pctRows.map((r) => r.date))].sort()
    const cleanPctByCode = new Map<string, number[]>()
    for (const code of new Set(Object.values(AKSHARE_CODE))) {
      const m = pctMap.get(code)
      cleanPctByCode.set(code, zeroRolloverSpikes(allMktDates.map((d) => m?.get(d) ?? 0)))
    }

    const sigmaOn = (prod: string, asOf: string): number => {
      const code = AKSHARE_CODE[prod]
      if (!code) return 0
      const mi = floorIndex(allMktDates, asOf)
      if (mi < 2) return 0
      const clean = cleanPctByCode.get(code) ?? []
      const rets = (mi >= VOL_DAYS ? clean.slice(mi - VOL_DAYS, mi) : clean.slice(0, mi)).filter((x) => x !== 0)
      return stdDev(rets)
    }

    const prodKeysForVol = [...new Set([...Object.keys(prodBuckets.quant), ...Object.keys(prodBuckets.subjective)])]
    const rawSigmas = prodKeysForVol.map((p) => sigmaOn(p, date)).filter((s) => s > 0)
    const medianSigma = rawSigmas.length
      ? [...rawSigmas].sort((a, b) => a - b)[Math.floor(rawSigmas.length / 2)]
      : 0
    const sigmaOf = (prod: string, asOf = date) => {
      const s = sigmaOn(prod, asOf)
      return s > 0 ? s : medianSigma
    }

    const riskOf = (b: Bucket | undefined, sigma: number) => ({
      long: (b?.long ?? 0) * sigma,
      short: (b?.short ?? 0) * sigma,
    })

    const prodKeys = new Set([...Object.keys(prodBuckets.quant), ...Object.keys(prodBuckets.subjective)])
    let qGrossRisk = 0
    let sGrossRisk = 0
    let qPosMargin = 0
    let sPosMargin = 0
    for (const p of prodKeys) {
      const sig = sigmaOf(p)
      const qNet = (prodBuckets.quant[p]?.long ?? 0) - (prodBuckets.quant[p]?.short ?? 0)
      const sNet = (prodBuckets.subjective[p]?.long ?? 0) - (prodBuckets.subjective[p]?.short ?? 0)
      qGrossRisk += Math.abs(sig * qNet)
      sGrossRisk += Math.abs(sig * sNet)
      qPosMargin += prodBuckets.quant[p]?.margin ?? 0
      sPosMargin += prodBuckets.subjective[p]?.margin ?? 0
    }
    const bookGrossRisk = qGrossRisk + sGrossRisk
    const bookPosMargin = qPosMargin + sPosMargin

    const toRow = (
      key: string,
      name: string,
      sector: string | undefined,
      qb: Bucket | undefined,
      sb: Bucket | undefined,
      sigma: number,
    ): CompareRow => {
      const qr = riskOf(qb, sigma)
      const sr = riskOf(sb, sigma)
      const quant = buildSleeve(qb?.long ?? 0, qb?.short ?? 0, qr.long, qr.short, qb?.margin ?? 0, qPosMargin, bookPosMargin, qGrossRisk, bookGrossRisk)
      const subjective = buildSleeve(sb?.long ?? 0, sb?.short ?? 0, sr.long, sr.short, sb?.margin ?? 0, sPosMargin, bookPosMargin, sGrossRisk, bookGrossRisk)
      const { signal, consensusScore } = classifyExposure(quant, subjective, "risk")
      return {
        key, name, sector, quant, subjective, signal, consensusScore,
        volAnnPct: sigma > 0 ? round1(sigma * Math.sqrt(252) * 100) : undefined,
      }
    }

    const sectorRiskBuckets: Record<Sleeve, Record<string, Bucket>> = { quant: {}, subjective: {} }
    for (const p of prodKeys) {
      const sig = sigmaOf(p)
      const sec = getSector(p)
      const q = prodBuckets.quant[p]
      const s = prodBuckets.subjective[p]
      if (q) add(sectorRiskBuckets.quant, sec, q.long * sig, q.short * sig, 0)
      if (s) add(sectorRiskBuckets.subjective, sec, s.long * sig, s.short * sig, 0)
    }

    const sectors: CompareRow[] = SECTORS.map((sec) => {
      const qb = sectorBuckets.quant[sec]
      const sb = sectorBuckets.subjective[sec]
      const qr = sectorRiskBuckets.quant[sec]
      const sr = sectorRiskBuckets.subjective[sec]
      const quant = buildSleeve(qb?.long ?? 0, qb?.short ?? 0, qr?.long ?? 0, qr?.short ?? 0, qb?.margin ?? 0, qPosMargin, bookPosMargin, qGrossRisk, bookGrossRisk)
      const subjective = buildSleeve(sb?.long ?? 0, sb?.short ?? 0, sr?.long ?? 0, sr?.short ?? 0, sb?.margin ?? 0, sPosMargin, bookPosMargin, sGrossRisk, bookGrossRisk)
      const { signal, consensusScore } = classifyExposure(quant, subjective, "risk")
      return { key: sec, name: sec, quant, subjective, signal, consensusScore }
    }).filter((r) => r.quant.grossPctGroup !== 0 || r.subjective.grossPctGroup !== 0)

    const products: CompareRow[] = Array.from(prodKeys)
      .map((p) => toRow(p, PROD_NAMES[p] ?? p, getSector(p), prodBuckets.quant[p], prodBuckets.subjective[p], sigmaOf(p)))
      .filter((r) => Math.abs(r.quant.riskPctGroup) + Math.abs(r.subjective.riskPctGroup) >= 0.3
        || Math.abs(r.quant.equityPctGroup) + Math.abs(r.subjective.equityPctGroup) >= 0.5)
      .sort((a, b) =>
        (Math.abs(b.quant.riskPctGroup) + Math.abs(b.subjective.riskPctGroup)) -
        (Math.abs(a.quant.riskPctGroup) + Math.abs(a.subjective.riskPctGroup)),
      )

    const quantShare = bookMargin > 0 ? (groups.quant.margin / bookMargin) * 100 : 0
    const signals = buildMomSignals(sectors, products.slice(0, 40), "risk", quantShare, groups.quant.nAccounts, groups.subjective.nAccounts)

    const tsRisk = new Map<string, { quant: Record<string, number>; subjective: Record<string, number>; qAbs: number; sAbs: number }>()
    const tsEq = new Map<string, { quant: Record<string, number>; subjective: Record<string, number>; qEq: number; sEq: number }>()
    const tsProdRisk = new Map<string, { quant: Record<string, number>; subjective: Record<string, number> }>()
    const tsProdMv = new Map<string, { quant: Record<string, number>; subjective: Record<string, number> }>()
    for (const r of tsPosRows) {
      const prefix = getPrefix(r.contract)
      if (!prefix) continue
      const sector = getSector(prefix)
      const group: Sleeve = r.sleeve === "quant" ? "quant" : "subjective"
      const net = toNum(r.long_mv) - toNum(r.short_mv)
      const risk = sigmaOf(prefix, r.date) * net
      const margin = toNum(r.margin)
      if (!tsRisk.has(r.date)) tsRisk.set(r.date, { quant: {}, subjective: {}, qAbs: 0, sAbs: 0 })
      const entry = tsRisk.get(r.date)!
      entry[group][sector] = (entry[group][sector] ?? 0) + risk
      if (!tsEq.has(r.date)) tsEq.set(r.date, { quant: {}, subjective: {}, qEq: 0, sEq: 0 })
      const eqE = tsEq.get(r.date)!
      eqE[group][sector] = (eqE[group][sector] ?? 0) + margin
      if (group === "quant") eqE.qEq += margin
      else eqE.sEq += margin
      if (!tsProdRisk.has(r.date)) tsProdRisk.set(r.date, { quant: {}, subjective: {} })
      if (!tsProdMv.has(r.date)) tsProdMv.set(r.date, { quant: {}, subjective: {} })
      const pr = tsProdRisk.get(r.date)!
      const pm = tsProdMv.get(r.date)!
      pr[group][prefix] = (pr[group][prefix] ?? 0) + risk
      pm[group][prefix] = (pm[group][prefix] ?? 0) + margin
    }
    // Risk budget = Σ_product |σ × net|, matching the snapshot charts.
    // Abs at contract level would inflate the denominator on calendar spreads.
    for (const [d, pr] of tsProdRisk) {
      const entry = tsRisk.get(d)
      if (!entry) continue
      entry.qAbs = 0
      entry.sAbs = 0
      for (const v of Object.values(pr.quant)) entry.qAbs += Math.abs(v)
      for (const v of Object.values(pr.subjective)) entry.sAbs += Math.abs(v)
    }
    const sectorTs = Array.from(tsRisk.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .flatMap(([d, entry]) => {
        const eqE = tsEq.get(d)
        return SECTORS
          .map((sec) => {
            const qRisk = entry.quant[sec] ?? 0
            const sRisk = entry.subjective[sec] ?? 0
            const qMv = eqE?.quant[sec] ?? 0
            const sMv = eqE?.subjective[sec] ?? 0
            if (qRisk === 0 && sRisk === 0 && qMv === 0 && sMv === 0) return null
            return {
              date: d,
              sector: sec,
              quantNetPct: entry.qAbs > 0 ? round1((qRisk / entry.qAbs) * 100) : 0,
              subjNetPct: entry.sAbs > 0 ? round1((sRisk / entry.sAbs) * 100) : 0,
              quantEquityPct: (eqE?.qEq ?? 0) > 0 ? round1((qMv / eqE!.qEq) * 100) : 0,
              subjEquityPct: (eqE?.sEq ?? 0) > 0 ? round1((sMv / eqE!.sEq) * 100) : 0,
            }
          })
          .filter((x) => x != null)
      })
    const productTs = Array.from(tsRisk.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .flatMap(([d, entry]) => {
        const eqE = tsEq.get(d)
        const pr = tsProdRisk.get(d)
        const pm = tsProdMv.get(d)
        if (!pr) return []
        const codes = new Set([
          ...Object.keys(pr.quant),
          ...Object.keys(pr.subjective),
          ...Object.keys(pm?.quant ?? {}),
          ...Object.keys(pm?.subjective ?? {}),
        ])
        return [...codes]
          .map((code) => {
            const qRisk = pr.quant[code] ?? 0
            const sRisk = pr.subjective[code] ?? 0
            const qMv = pm?.quant[code] ?? 0
            const sMv = pm?.subjective[code] ?? 0
            if (qRisk === 0 && sRisk === 0 && qMv === 0 && sMv === 0) return null
            return {
              date: d,
              product: code,
              quantNetPct: entry.qAbs > 0 ? round1((qRisk / entry.qAbs) * 100) : 0,
              subjNetPct: entry.sAbs > 0 ? round1((sRisk / entry.sAbs) * 100) : 0,
              quantEquityPct: (eqE?.qEq ?? 0) > 0 ? round1((qMv / eqE!.qEq) * 100) : 0,
              subjEquityPct: (eqE?.sEq ?? 0) > 0 ? round1((sMv / eqE!.sEq) * 100) : 0,
            }
          })
          .filter((x) => x != null)
      })

    const holdingDates = [...new Set(tsPosRows.map((r) => r.date))].sort()
    const holdingProdSet = new Set<string>()
    for (const r of tsPosRows) {
      const p = getPrefix(r.contract)
      if (p) holdingProdSet.add(p)
    }
    const holdingCodes = [...holdingProdSet].sort()
    const dIdx = new Map(holdingDates.map((d, i) => [d, i]))
    const pIdx = new Map(holdingCodes.map((p, i) => [p, i]))
    const zeros2 = () => holdingDates.map(() => holdingCodes.map(() => 0))
    const quantLong = zeros2()
    const quantShort = zeros2()
    const subjLong = zeros2()
    const subjShort = zeros2()
    for (const r of tsPosRows) {
      const prefix = getPrefix(r.contract)
      const di = dIdx.get(r.date)
      const pi = pIdx.get(prefix)
      if (di == null || pi == null) continue
      const long = round0(toNum(r.long_mv))
      const short = round0(toNum(r.short_mv))
      if (r.sleeve === "quant") {
        quantLong[di][pi] += long
        quantShort[di][pi] += short
      } else {
        subjLong[di][pi] += long
        subjShort[di][pi] += short
      }
    }
    const holdingSigma = holdingDates.map((d) =>
      holdingCodes.map((p) => Math.round(sigmaOf(p, d) * 1e6) / 1e6),
    )
    const holdingTs = {
      dates: holdingDates,
      products: holdingCodes.map((code) => ({
        code,
        name: PROD_NAMES[code] ?? code,
        cat: getCat(code),
        sector: getSector(code),
        subSector: getSubSector(code),
      })),
      quantLong,
      quantShort,
      subjLong,
      subjShort,
      sigma: holdingSigma,
    }

    return NextResponse.json({
      ok: true,
      date,
      volDays: VOL_DAYS,
      quantIds,
      missingQuantIds,
      groups,
      bookEquity: round0(bookEq),
      bookMargin: round0(bookMargin),
      quantShare: round1(quantShare),
      sectors,
      products,
      signals,
      sectorTs,
      productTs,
      holdingTs,
    })
  } catch (err) {
    console.error("[quant-vs-subjective]", err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const GET = withMomCache("quant-vs-subjective-v8", _GET)
