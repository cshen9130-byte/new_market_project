import { query } from "@/lib/db"
import { PROD_SECTOR, prodLabel } from "@/lib/ma/prod-sector"
import { getPrefix } from "@/lib/server/prod-utils"
import {
  BOOK_CAP_MIN,
  MV_MIN,
  PRODUCT_HARD,
  PRODUCT_SOFT,
  SECTOR_HARD,
  SECTOR_SOFT,
  VAR_BUDGET_HARD,
  VAR_BUDGET_SOFT,
  accountLayerNote,
  allocateCuts,
  asDate,
  bisectScaleK,
  budgetHardNote,
  budgetSoftNote,
  buildCapitalPath,
  buildConclusion,
  collectBreaches,
  displayAccount,
  linearScaleK,
  normAccount,
  parseWarningStop,
  personLabel,
  portfolioVar95,
  productSector,
  productsToScale,
  sectorLabel,
  shapleyDriver,
  trailingStreak,
  type AccountLayerAction,
  type BreachRow,
  type CutRow,
  type DriverInfo,
  type HolderRow,
  type ObjectKind,
  type VarProduct,
} from "@/lib/ma/var-mcr-policy"

export const ACCOUNT_FILTER = `
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'
         AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
         AND TRIM("合约") NOT LIKE '%-%-%'`

export const ACCOUNT_ONLY_FILTER = `
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'`

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

type TimeseriesPayload = {
  ok?: boolean
  dates?: string[]
  productData?: Record<string, number[]>
  sectorData?: Record<string, number[]>
  productSoft?: number
  productHard?: number
  sectorSoft?: number
  sectorHard?: number
  error?: string
}

type SandboxPayload = {
  ok?: boolean
  date?: string
  products?: Array<{ prod: string; mv: number; lots: number; sigma: number }>
  corrMatrix?: number[][]
  totalVar?: number
  zScore?: number
  error?: string
}

type AdvisorRow = {
  account: string
  accountDisp: string
  name: string | null
  warningStopLoss: string | null
  warnPct: number | null
  stopPct: number | null
  preference: string | null
  onRoster: boolean
}

function toNum(value: unknown): number {
  if (value == null) return 0
  const n = parseFloat(String(value).replace(/[,%\s]/g, ""))
  return Number.isFinite(n) ? n : 0
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
  for (let i = 0; i < n; i += 1) {
    const xi = x[i] - mx, yi = y[i] - my
    num += xi * yi; sx += xi * xi; sy += yi * yi
  }
  const denom = Math.sqrt(sx * sy)
  return denom < 1e-10 ? 0 : num / denom
}

function zeroRolloverSpikes(rets: number[]): number[] {
  if (rets.length < 2) return [...rets]
  const MIN_THRESHOLD = 0.06, K = 12, LOOKBACK = 40
  const out = [...rets]
  for (let i = LOOKBACK; i < rets.length; i += 1) {
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

async function readRoute(loader: () => Promise<(req: Request) => Promise<Response>>, url: string): Promise<Record<string, unknown>> {
  const GET = await loader()
  const res = await GET(new Request(url))
  const body = await res.json()
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "empty response" }
  return body as Record<string, unknown>
}

type ContractPos = {
  account: string
  prod: string
  netMv: number
  grossMv: number
  netLots: number
  grossLots: number
}

async function loadAccountPositions(date: string): Promise<ContractPos[]> {
  const rows = await query<{ account: string; contract: string; mv: string; lots: string }>(
    `SELECT UPPER(TRIM("账户")) AS account,
            UPPER(TRIM("合约")) AS contract,
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
     WHERE "交易日期" = $1::date
       AND "账户" IS NOT NULL
       ${ACCOUNT_FILTER}
     GROUP BY UPPER(TRIM("账户")), UPPER(TRIM("合约"))`,
    [date],
  )
  const map = new Map<string, ContractPos>()
  for (const row of rows) {
    const account = normAccount(row.account)
    const prod = getPrefix(row.contract)
    if (!account || !prod) continue
    const key = `${account}::${prod}`
    const mv = toNum(row.mv)
    const lots = toNum(row.lots)
    const cur = map.get(key) ?? { account, prod, netMv: 0, grossMv: 0, netLots: 0, grossLots: 0 }
    cur.netMv += mv
    cur.grossMv += Math.abs(mv)
    cur.netLots += lots
    cur.grossLots += Math.abs(lots)
    map.set(key, cur)
  }
  return [...map.values()]
}

async function loadProductMvs(date: string): Promise<Map<string, number>> {
  const rows = await query<{ contract: string; mv: string }>(
    `SELECT UPPER(TRIM("合约")) AS contract,
            SUM(
              CASE WHEN ${numExpr("买持仓")} > 0
                   THEN  ${numExpr("持仓市値")}
                   ELSE -${numExpr("持仓市値")}
              END
            )::text AS mv
     FROM mom_position_details
     WHERE "交易日期" = $1::date
       ${ACCOUNT_FILTER}
     GROUP BY UPPER(TRIM("合约"))`,
    [date],
  )
  const map = new Map<string, number>()
  for (const row of rows) {
    const prod = getPrefix(row.contract)
    if (!prod) continue
    map.set(prod, (map.get(prod) ?? 0) + toNum(row.mv))
  }
  return map
}

async function loadAdvisors(): Promise<Map<string, AdvisorRow>> {
  const rows = await query<{ account_code: string; advisor_name: string; warning_stop_loss: string | null; product_preference: string | null }>(
    `SELECT account_code, advisor_name, warning_stop_loss, product_preference
     FROM mom_advisor_info`,
  ).catch(() => [] as Array<{ account_code: string; advisor_name: string; warning_stop_loss: string | null; product_preference: string | null }>)
  const map = new Map<string, AdvisorRow>()
  for (const row of rows) {
    const account = normAccount(row.account_code)
    if (!account || map.has(account)) continue
    const lines = parseWarningStop(row.warning_stop_loss)
    map.set(account, {
      account,
      accountDisp: displayAccount(row.account_code),
      name: (row.advisor_name ?? "").trim() || null,
      warningStopLoss: row.warning_stop_loss,
      warnPct: lines.warnPct,
      stopPct: lines.stopPct,
      preference: row.product_preference,
      onRoster: true,
    })
  }
  return map
}

async function loadEquityFlows(): Promise<Map<string, Array<{ date: string; equity: number | null; netFlow: number }>>> {
  const rows = await query<{ account: string; date: string; equity: string; net_flow: string }>(
    `SELECT TRIM("账户"::text) AS account,
            "交易日期"::date::text AS date,
            SUM(${numExpr("客户权益")})::text AS equity,
            SUM(${numExpr("当日存取合计")})::text AS net_flow
     FROM mom_daily_reports
     WHERE COALESCE(TRIM("账户"::text), '') <> ''
       ${ACCOUNT_ONLY_FILTER}
     GROUP BY TRIM("账户"::text), "交易日期"::date
     ORDER BY 1, 2`,
  ).catch(() => [] as Array<{ account: string; date: string; equity: string; net_flow: string }>)
  const map = new Map<string, Array<{ date: string; equity: number | null; netFlow: number }>>()
  for (const row of rows) {
    const account = normAccount(row.account)
    if (!account) continue
    const list = map.get(account) ?? []
    list.push({
      date: asDate(row.date),
      equity: row.equity == null ? null : toNum(row.equity),
      netFlow: toNum(row.net_flow),
    })
    map.set(account, list)
  }
  return map
}

type MarketPack = {
  dates: string[]
  pctMap: Map<string, Map<string, number>>
  cleanPctByCode: Map<string, number[]>
}

async function loadMarket(codes: string[]): Promise<MarketPack> {
  if (codes.length === 0) return { dates: [], pctMap: new Map(), cleanPctByCode: new Map() }
  const rows = await query<{ date: string; code: string; pct: string }>(
    `SELECT trade_date::text AS date, code, pct_change::text AS pct
     FROM raw_akshare_futures_daily
     WHERE code = ANY($1) AND pct_change IS NOT NULL
     ORDER BY trade_date`,
    [codes],
  )
  const pctMap = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const date = asDate(row.date)
    if (!pctMap.has(row.code)) pctMap.set(row.code, new Map())
    pctMap.get(row.code)!.set(date, toNum(row.pct) / 100)
  }
  const dates = [...new Set(rows.map((row) => asDate(row.date)).filter(Boolean))].sort()
  const cleanPctByCode = new Map<string, number[]>()
  for (const code of codes) {
    const m = pctMap.get(code)
    cleanPctByCode.set(code, zeroRolloverSpikes(dates.map((d) => m?.get(d) ?? 0)))
  }
  return { dates, pctMap, cleanPctByCode }
}

function riskOnDate(
  mvMap: Map<string, number>,
  date: string,
  market: MarketPack,
  volDays = 20,
  corrDays = 252,
): { products: VarProduct[]; corr: number[][]; var95: number } | null {
  const mktIdx = floorIndex(market.dates, date)
  if (mktIdx < Math.max(volDays, corrDays) - 1) return null
  const active = [...mvMap.entries()]
    .filter(([prod, mv]) => Boolean(AKSHARE_CODE[prod]) && Math.abs(mv) >= MV_MIN)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  if (active.length === 0) return null
  const volStart = mktIdx - volDays + 1
  const corrStart = mktIdx - corrDays + 1
  const corrDates = market.dates.slice(corrStart, mktIdx + 1)
  const products: VarProduct[] = active.map(([prod, mv]) => {
    const code = AKSHARE_CODE[prod]
    const clean = market.cleanPctByCode.get(code) ?? []
    const rets = clean.slice(volStart, mktIdx + 1).filter((r) => r !== 0)
    return { prod, mv, sigma: stdDev(rets) }
  })
  const retSeries = active.map(([prod]) => {
    const code = AKSHARE_CODE[prod]
    const m = market.pctMap.get(code)
    return corrDates.map((d) => m?.get(d) ?? 0)
  })
  const n = products.length
  const corr: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 1 : pearsonCorr(retSeries[i], retSeries[j]))),
  )
  return { products, corr, var95: portfolioVar95(products, corr) }
}

async function loadCumCapitalSeries(): Promise<Array<{ date: string; capital: number }>> {
  try {
    const nav = await readRoute(
      () => import("@/app/ma/api/mom-analysis/product-nav/route").then((mod) => mod.GET),
      "http://localhost/ma/api/mom-analysis/product-nav",
    )
    const series = Array.isArray(nav.data) ? nav.data as Array<{ date?: string; cumCapital?: number }> : []
    return series
      .filter((row) => typeof row.cumCapital === "number" && row.date)
      .map((row) => ({ date: asDate(row.date), capital: Number(row.cumCapital) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

function capitalOnOrBefore(series: Array<{ date: string; capital: number }>, date: string): { capital: number | null; date: string | null } {
  let found: { date: string; capital: number } | null = null
  for (const row of series) {
    if (row.date <= date) found = row
    else break
  }
  return found ? { capital: found.capital, date: found.date } : { capital: null, date: null }
}

function buildHolders(
  positions: ContractPos[],
  advisors: Map<string, AdvisorRow>,
  kind: ObjectKind,
  name: string,
): HolderRow[] {
  const products = kind === "product" ? [name] : [...new Set(positions.map((row) => row.prod).filter((prod) => productSector(prod) === name))]
  const relevant = positions.filter((row) => products.includes(row.prod) && (Math.abs(row.netMv) >= MV_MIN || row.grossMv >= MV_MIN))
  const objectGross = relevant.reduce((sum, row) => sum + Math.max(row.grossMv, Math.abs(row.netMv)), 0)
  const accountGross = new Map<string, number>()
  for (const row of positions) {
    accountGross.set(row.account, (accountGross.get(row.account) ?? 0) + row.grossMv)
  }
  const useGross = relevant.every((row) => Math.abs(row.netMv) < 0.25 * Math.max(row.grossMv, 1)) && relevant.some((row) => row.grossMv > Math.abs(row.netMv) * 1.5)
  const rows: HolderRow[] = relevant.map((row) => {
    const adv = advisors.get(row.account)
    const weight = useGross ? row.grossMv : Math.abs(row.netMv)
    const acctGross = accountGross.get(row.account) ?? 0
    return {
      account: row.account,
      accountDisp: adv?.accountDisp ?? displayAccount(row.account),
      traderName: adv?.name ?? null,
      displayName: personLabel(adv?.name ?? null, adv?.accountDisp ?? row.account),
      prod: row.prod,
      prodLabel: prodLabel(row.prod),
      sector: productSector(row.prod),
      netMv: Math.round(row.netMv),
      grossMv: Math.round(row.grossMv),
      netLots: Math.round(row.netLots),
      grossLots: Math.round(row.grossLots),
      shareOfObject: objectGross > 0 ? weight / objectGross : 0,
      shareOfAccount: acctGross > 0 ? row.grossMv / acctGross : 0,
    }
  })
  rows.sort((a, b) => {
    const wa = useGross ? a.grossMv : Math.abs(a.netMv)
    const wb = useGross ? b.grossMv : Math.abs(b.netMv)
    return wb - wa
  })
  return rows
}

function approachingRows(productData: Record<string, number[]>, sectorData: Record<string, number[]>, index: number) {
  const products = Object.entries(productData)
    .map(([name, series]) => ({ name, label: prodLabel(name), sharePct: series[index] ?? 0 }))
    .filter((row) => row.sharePct >= PRODUCT_SOFT - 2 && row.sharePct < PRODUCT_SOFT)
    .sort((a, b) => b.sharePct - a.sharePct)
  const sectors = Object.entries(sectorData)
    .map(([name, series]) => ({ name, label: sectorLabel(name), sharePct: series[index] ?? 0 }))
    .filter((row) => row.sharePct >= SECTOR_SOFT - 2 && row.sharePct < SECTOR_SOFT)
    .sort((a, b) => b.sharePct - a.sharePct)
  return { products, sectors }
}

export type SuggestionPayload = {
  ok: true
  date: string
  latestDate: string
  selectedDate: string
  conclusion: string
  productSoft: number
  productHard: number
  sectorSoft: number
  sectorHard: number
  varPct: number | null
  var95: number | null
  cumCapital: number | null
  capitalDate: string | null
  capOk: boolean
  driver: DriverInfo
  budgetSoft: string | null
  budgetHard: string | null
  budgetHardStreak: number
  breaches: BreachRow[]
  approaching: { products: Array<{ name: string; label: string; sharePct: number }>; sectors: Array<{ name: string; label: string; sharePct: number }> }
  objects: Array<{
    kind: ObjectKind
    name: string
    label: string
    breach: BreachRow
    holders: HolderRow[]
    holderSort: "gross" | "absNet"
    nnrScope: string
    k: number
    kMethod: "bisection" | "linear"
    achievedShare: number | null
    targetPct: number
    formalCut: boolean
    cuts: CutRow[]
    residualCuts: CutRow[]
    cutNote: string
  }>
  accountActions: AccountLayerAction[]
  dataGaps: {
    positionsWithoutAdvisor: string[]
    equityWithoutRoster: string[]
    rosterWithoutEquity: string[]
    missingWarningLines: string[]
  }
  window: string
  volDays: number
  corrDays: number
}

export async function buildVarMcrSuggestions(req: Request): Promise<SuggestionPayload> {
  const url = new URL(req.url)
  const volDays = Math.max(5, Math.min(120, parseInt(url.searchParams.get("volDays") ?? "20", 10)))
  const corrDays = Math.max(5, Math.min(756, parseInt(url.searchParams.get("corrDays") ?? "252", 10)))
  const requested = asDate(url.searchParams.get("date") ?? "")

  const ts = await readRoute(
    () => import("@/app/ma/api/mom-analysis/var-mcr-timeseries/route").then((mod) => mod.GET),
    `http://localhost/ma/api/mom-analysis/var-mcr-timeseries?volDays=${volDays}&corrDays=${corrDays}`,
  ) as TimeseriesPayload
  if (ts.ok === false) throw new Error(ts.error || "var-mcr-timeseries failed")

  const dates = (ts.dates ?? []).map(asDate)
  if (dates.length === 0) {
    return emptyPayload({ date: requested || null, volDays, corrDays })
  }
  const latestDate = dates[dates.length - 1]
  const selectedDate = requested && dates.includes(requested) ? requested : latestDate
  const asOfIndex = dates.indexOf(selectedDate)

  const sandbox = await readRoute(
    () => import("@/app/ma/api/mom-analysis/var-sandbox/route").then((mod) => mod.GET),
    `http://localhost/ma/api/mom-analysis/var-sandbox?volDays=${volDays}&corrDays=${corrDays}&confidence=95&distModel=normal`,
  ) as SandboxPayload

  const [positions, advisors, equityMap, capitalSeries] = await Promise.all([
    loadAccountPositions(selectedDate),
    loadAdvisors(),
    loadEquityFlows(),
    loadCumCapitalSeries(),
  ])
  const capitalInfo = capitalOnOrBefore(capitalSeries, selectedDate)

  const prevDate = asOfIndex > 0 ? dates[asOfIndex - 1] : null
  const useSandboxBook = asDate(sandbox.date) === selectedDate && Array.isArray(sandbox.products) && Array.isArray(sandbox.corrMatrix)
  const sandboxProducts = useSandboxBook ? (sandbox.products ?? []).map((p) => ({ prod: p.prod, mv: p.mv, sigma: p.sigma })) : []
  const sandboxCorr = useSandboxBook ? (sandbox.corrMatrix ?? []) : []

  let var95 = useSandboxBook && typeof sandbox.totalVar === "number" ? sandbox.totalVar : null
  let productsForCut: VarProduct[] = sandboxProducts
  let corrForCut = sandboxCorr
  let driver: DriverInfo = { driver: "na", dVar: null, attrPos: null, attrMkt: null }

  const recentDates = dates.slice(Math.max(0, asOfIndex - 14), asOfIndex + 1)
  const mvByDate = new Map<string, Map<string, number>>()
  const needDates = [...new Set([selectedDate, prevDate, ...recentDates].filter((d): d is string => Boolean(d)))]
  await Promise.all(needDates.map(async (date) => {
    mvByDate.set(date, await loadProductMvs(date))
  }))
  const allProds = new Set<string>()
  for (const map of mvByDate.values()) for (const prod of map.keys()) allProds.add(prod)
  const market = await loadMarket([...new Set([...allProds].map((p) => AKSHARE_CODE[p]).filter(Boolean))])

  if (!useSandboxBook) {
    const todayRisk = riskOnDate(mvByDate.get(selectedDate) ?? new Map(), selectedDate, market, volDays, corrDays)
    if (todayRisk) {
      productsForCut = todayRisk.products
      corrForCut = todayRisk.corr
      var95 = todayRisk.var95
    }
  }

  if (prevDate) {
    const yest = riskOnDate(mvByDate.get(prevDate) ?? new Map(), prevDate, market, volDays, corrDays)
    const todayY = riskOnDate(mvByDate.get(selectedDate) ?? new Map(), prevDate, market, volDays, corrDays)
    const yestT = riskOnDate(mvByDate.get(prevDate) ?? new Map(), selectedDate, market, volDays, corrDays)
    const todayT = riskOnDate(mvByDate.get(selectedDate) ?? new Map(), selectedDate, market, volDays, corrDays)
    if (yest && todayY && yestT && todayT) {
      driver = shapleyDriver(yest.var95, todayY.var95, yestT.var95, todayT.var95)
    }
  }

  const capOk = Boolean(capitalInfo.capital != null && capitalInfo.capital >= BOOK_CAP_MIN)
  const varPct = var95 != null && capitalInfo.capital && capitalInfo.capital > 0
    ? Math.round((var95 / capitalInfo.capital) * 10000) / 100
    : null

  const varPctSeries: Array<{ date: string; varPct: number | null; capOk: boolean }> = []
  for (const date of recentDates) {
    if (date === selectedDate && varPct != null) {
      varPctSeries.push({ date, varPct, capOk })
      continue
    }
    const risk = riskOnDate(mvByDate.get(date) ?? new Map(), date, market, volDays, corrDays)
    const cap = capitalOnOrBefore(capitalSeries, date).capital
    const ok = Boolean(cap != null && cap >= BOOK_CAP_MIN)
    const vp = risk && cap && cap > 0 ? (risk.var95 / cap) * 100 : null
    varPctSeries.push({ date, varPct: vp, capOk: ok })
  }
  const hardStreak = trailingStreak(varPctSeries.map((row) => (row.capOk && row.varPct != null ? row.varPct : 0)), VAR_BUDGET_HARD)
  let lastFireDate: string | null = null
  let releaseStreak: number | null = null
  for (let i = 0; i < varPctSeries.length; i += 1) {
    const window = varPctSeries.slice(0, i + 1)
    const streak = trailingStreak(window.map((row) => (row.capOk && row.varPct != null ? row.varPct : 0)), VAR_BUDGET_HARD)
    if (streak >= 3) lastFireDate = varPctSeries[i].date
  }
  if (lastFireDate) {
    const after = varPctSeries.filter((row) => row.date > lastFireDate!)
    let below = 0
    for (const row of after) {
      if (row.capOk && row.varPct != null && row.varPct <= VAR_BUDGET_HARD) below += 1
      else below = 0
    }
    releaseStreak = after.length === 0 ? 0 : below
    if (after.some((row) => row.capOk && row.varPct != null && row.varPct > VAR_BUDGET_HARD) && below < 3) {
      // still possibly in force if we haven't released; keep lastFireDate
    } else if (below >= 3) {
      lastFireDate = null
      releaseStreak = below
    }
  }

  const breaches = collectBreaches({
    productSeries: ts.productData ?? {},
    sectorSeries: ts.sectorData ?? {},
    asOfIndex,
    driver: driver.driver,
    attrPos: driver.attrPos,
    varPct,
    capOk,
  })
  const budgetSoft = budgetSoftNote(varPct, capOk)
  const todayBudgetFire = Boolean(capOk && varPct != null && varPct > VAR_BUDGET_HARD && hardStreak >= 3)
  const budgetHard = budgetHardNote({
    varPct,
    capOk,
    hardStreak,
    lastFireDate: todayBudgetFire ? null : lastFireDate,
    releaseStreak,
  })
  const conclusion = buildConclusion({
    date: selectedDate,
    breaches,
    varPct,
    capOk,
    driver: driver.driver,
    budgetSoft,
    budgetHard,
  })

  const objects = breaches.map((breach) => {
    const holders = buildHolders(positions, advisors, breach.kind, breach.name)
    const scaleNames = productsToScale(breach.kind, breach.name, [...new Set(positions.map((row) => row.prod))])
    const holderSort: "gross" | "absNet" = holders.some((row) => row.grossMv > Math.abs(row.netMv) * 1.5 && Math.abs(row.netMv) < 0.25 * Math.max(row.grossMv, 1))
      ? "gross"
      : "absNet"
    let k = linearScaleK(breach.sharePct, breach.softPct)
    let kMethod: "bisection" | "linear" = "linear"
    let achievedShare: number | null = null
    if (productsForCut.length > 0 && corrForCut.length > 0 && breach.sharePct > breach.softPct) {
      const solved = bisectScaleK({
        products: productsForCut,
        corr: corrForCut,
        kind: breach.kind,
        name: breach.name,
        targetPct: breach.softPct,
      })
      if (solved.applied) {
        k = solved.k
        kMethod = "bisection"
        achievedShare = Math.round(solved.achievedShare * 10) / 10
      }
    }
    const { included, residual } = allocateCuts({ k, holders, products: scaleNames })
    const nnrScope = [
      `禁止新增的对象是${breach.kind === "product" ? "品种" : "板块"}「${breach.label}」，不是整本账。`,
      `凡是会增加该对象绝对暴露的账户都适用，包括尚未持有、准备新开仓的账户。`,
      holders.length > 0
        ? `当前持仓账户如下，建议优先与占比靠前的交易员沟通：${uniquePeople(holders).join("、")}。`
        : "当日持仓里还没有看到该对象的账户明细。",
      breach.nnrAlreadyInEffect ? "该限制已于上一交易日收盘后生效。" : "该限制从次一交易日起生效。",
    ].join("")
    const cutNote = breach.formalCut
      ? `已满足正式硬砍条件。建议按缩放系数 k=${k.toFixed(3)}，把${breach.label}的贡献从 ${breach.sharePct.toFixed(1)}% 压回软线 ${breach.softPct}%。下列数量按各账户对该对象净市值的比例分摊，已把过小的尾仓单独列出、不作为必须执行的砍仓指令。减仓指降低绝对暴露（多头减多、空头回补），不是再朝拥挤方向加仓。`
      : `尚未达到正式硬砍条件（需要硬线持续不少于 ${3} 个交易日，且持仓是 VaR 上升主因或 VaR/资本已超过 ${VAR_BUDGET_SOFT}%，市场驱动日还要冻结硬砍）。下表只是「若把贡献压回软线 ${breach.softPct}%」的测算，缩放系数 k=${k.toFixed(3)}，不是数量减仓令。`
    return {
      kind: breach.kind,
      name: breach.name,
      label: breach.label,
      breach,
      holders,
      holderSort,
      nnrScope,
      k: Math.round(k * 1000) / 1000,
      kMethod,
      achievedShare,
      targetPct: breach.softPct,
      formalCut: breach.formalCut,
      cuts: included,
      residualCuts: residual,
      cutNote,
    }
  })

  const accountActions: AccountLayerAction[] = []
  const tradingAccounts = new Set(positions.map((row) => row.account))
  const equityAccounts = [...equityMap.keys()]
  for (const account of new Set([...equityAccounts, ...advisors.keys()])) {
    const adv = advisors.get(account)
    const flows = equityMap.get(account) ?? []
    if (flows.length === 0) continue
    const path = buildCapitalPath(flows, adv?.warnPct ?? null, adv?.stopPct ?? null)
    const state = [...path].reverse().find((row) => row.date <= selectedDate) ?? path[path.length - 1]
    if (!state) continue
    const stillTrading = tradingAccounts.has(account)
    const { action, note } = accountLayerNote(state, stillTrading)
    if (!action) continue
    accountActions.push({
      account,
      accountDisp: adv?.accountDisp ?? displayAccount(account),
      traderName: adv?.name ?? null,
      displayName: personLabel(adv?.name ?? null, adv?.accountDisp ?? account),
      asOfDate: state.date,
      equity: state.equity,
      capital: state.capital,
      ratio: state.ratio,
      warnPct: state.warnPct,
      stopPct: state.stopPct,
      warningStopLoss: adv?.warningStopLoss ?? null,
      nearWarn: state.nearWarn,
      warnHit: state.warnHit,
      stopHit: state.stopHit,
      stillTrading,
      action,
      note,
    })
  }
  accountActions.sort((a, b) => {
    const rank = (row: AccountLayerAction) => (row.stopHit ? 0 : row.warnHit ? 1 : 2)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    return (a.ratio ?? 99) - (b.ratio ?? 99)
  })

  const positionsWithoutAdvisor = [...new Set(positions.map((row) => row.account))]
    .filter((account) => !advisors.get(account)?.name)
    .map((account) => displayAccount(account))
    .sort()
  const equityWithoutRoster = equityAccounts
    .filter((account) => !advisors.has(account) && tradingAccounts.has(account))
    .map((account) => displayAccount(account))
    .sort()
  const rosterWithoutEquity = [...advisors.values()]
    .filter((row) => !equityMap.has(row.account))
    .map((row) => personLabel(row.name, row.accountDisp))
    .sort()
  const missingWarningLines = [...advisors.values()]
    .filter((row) => (row.warnPct == null || row.stopPct == null) && tradingAccounts.has(row.account))
    .map((row) => personLabel(row.name, row.accountDisp))
    .sort()

  return {
    ok: true,
    date: selectedDate,
    latestDate,
    selectedDate,
    conclusion,
    productSoft: ts.productSoft ?? PRODUCT_SOFT,
    productHard: ts.productHard ?? PRODUCT_HARD,
    sectorSoft: ts.sectorSoft ?? SECTOR_SOFT,
    sectorHard: ts.sectorHard ?? SECTOR_HARD,
    varPct,
    var95: var95 == null ? null : Math.round(var95),
    cumCapital: capitalInfo.capital,
    capitalDate: capitalInfo.date,
    capOk,
    driver,
    budgetSoft,
    budgetHard,
    budgetHardStreak: hardStreak,
    breaches,
    approaching: approachingRows(ts.productData ?? {}, ts.sectorData ?? {}, asOfIndex),
    objects,
    accountActions,
    dataGaps: { positionsWithoutAdvisor, equityWithoutRoster, rosterWithoutEquity, missingWarningLines },
    window: "inclusive",
    volDays,
    corrDays,
  }
}

function uniquePeople(holders: HolderRow[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of holders) {
    if (seen.has(row.account)) continue
    seen.add(row.account)
    out.push(row.displayName)
    if (out.length >= 8) break
  }
  return out
}

function emptyPayload(input: { date: string | null; volDays: number; corrDays: number }): SuggestionPayload {
  const date = input.date || "—"
  return {
    ok: true,
    date,
    latestDate: date,
    selectedDate: date,
    conclusion: `${date === "—" ? "暂无交易日" : date}：暂无边际波动贡献数据，无法给出处置建议。`,
    productSoft: PRODUCT_SOFT,
    productHard: PRODUCT_HARD,
    sectorSoft: SECTOR_SOFT,
    sectorHard: SECTOR_HARD,
    varPct: null,
    var95: null,
    cumCapital: null,
    capitalDate: null,
    capOk: false,
    driver: { driver: "na", dVar: null, attrPos: null, attrMkt: null },
    budgetSoft: null,
    budgetHard: null,
    budgetHardStreak: 0,
    breaches: [],
    approaching: { products: [], sectors: [] },
    objects: [],
    accountActions: [],
    dataGaps: { positionsWithoutAdvisor: [], equityWithoutRoster: [], rosterWithoutEquity: [], missingWarningLines: [] },
    window: "inclusive",
    volDays: input.volDays,
    corrDays: input.corrDays,
  }
}
