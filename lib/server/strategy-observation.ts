import { n, query, queryUnbounded } from "@/lib/db"
import {
  fundMatchesObservationCategory,
  lookbackStart,
  mean,
  periodStartDate,
  sanitizeReturns,
  rankedPercentile,
  round2,
  sqlPeriodBucketExpr,
  stdev,
  STRATEGY_OBSERVATION_ALL_CATEGORIES,
  winRate,
  type ReturnGranularity,
  type StrategyObservationDistribution,
  type StrategyObservationDistParams,
  type StrategyObservationIndicatorRow,
  type StrategyObservationIndicatorTab,
  type StrategyObservationResponse,
  type StrategyObservationSeries,
} from "@/lib/ma/strategy-observation"
import {
  sqlResolvedStrategyExprs,
  sqlType6LatestStrategyJoin,
} from "@/lib/server/fund-strategy-resolve"

const CACHE_TTL_MS = 15 * 60 * 1000
const RISK_FREE = 0.03

const STRATEGY_BENCHMARK: Record<string, BenchmarkKey> = {
  "1000指增": "IM",
  "500指增": "IC",
  "300指增": "IF",
  "A500指增": "IF",
  量化选股: "IF",
  量化精选: "IF",
  量化多头: "IF",
  主观多头: "IF",
  主观精选: "IF",
  股票多头: "IF",
  量化期货: "NHCI",
  主观期货: "NHCI",
  期货策略: "NHCI",
  债券策略: "BOND",
  多资产策略: "IF",
  组合策略: "IF",
  可转债多头: "IF",
}

type BenchmarkKey = "IF" | "IC" | "IM" | "NHCI" | "BOND"

type FundRow = StrategyObservationLabels & {
  beian_hao: string
  ret_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
  latest_nav_date: string | null
}

type PeriodNavRow = {
  beian_hao: string
  bucket: string
  nav: number
}

interface CacheEntry {
  ts: number
  payload: StrategyObservationResponse
}

declare global {
  // eslint-disable-next-line no-var
  var _strategyObservationCache: Map<string, CacheEntry> | undefined
}

const cache: Map<string, CacheEntry> =
  global._strategyObservationCache ?? (global._strategyObservationCache = new Map())

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseNum(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (typeof value === "string") return value.slice(0, 10)
  return value.toISOString().slice(0, 10)
}

async function loadFunds(): Promise<FundRow[]> {
  const expr = sqlResolvedStrategyExprs("t6", "i")
  const rows = await query<{
    beian_hao: string
    product_name: string | null
    ret_1y: string | number | null
    sharpe_1y: string | number | null
    calmar_1y: string | number | null
    latest_nav_date: Date | string | null
    strategy_l1: string | null
    strategy_l2: string | null
    strategy_l3: string | null
  }>(
    `SELECT
       i.beian_hao,
       i.product_name,
       i.ret_1y,
       i.sharpe_1y,
       i.calmar_1y,
       i.latest_nav_date,
       ${expr.l1} AS strategy_l1,
       ${expr.l2} AS strategy_l2,
       ${expr.l3} AS strategy_l3
     FROM private_fund_info i
     ${sqlType6LatestStrategyJoin("i.beian_hao", "t6")}
     WHERE i.latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'
       AND NULLIF(BTRIM(i.beian_hao), '') IS NOT NULL`,
  )

  return rows.map((row) => ({
    beian_hao: row.beian_hao,
    name: row.product_name ?? "",
    l1: row.strategy_l1 ?? "",
    l2: row.strategy_l2 ?? "",
    l3: row.strategy_l3 ?? "",
    ret_1y: parseNum(row.ret_1y),
    sharpe_1y: parseNum(row.sharpe_1y),
    calmar_1y: parseNum(row.calmar_1y),
    latest_nav_date: isoDate(row.latest_nav_date),
  }))
}

function classifyFunds(funds: FundRow[]): Map<string, Set<string>> {
  const byCategory = new Map<string, Set<string>>()
  for (const category of STRATEGY_OBSERVATION_ALL_CATEGORIES) {
    byCategory.set(category, new Set())
  }
  for (const fund of funds) {
    for (const category of STRATEGY_OBSERVATION_ALL_CATEGORIES) {
      if (fundMatchesObservationCategory(category, fund)) {
        byCategory.get(category)!.add(fund.beian_hao)
      }
    }
  }
  return byCategory
}

async function loadPeriodNavs(
  year: number,
  granularity: ReturnGranularity,
  cutoff: string,
): Promise<PeriodNavRow[]> {
  const from = lookbackStart(year, granularity)
  const bucketSql = sqlPeriodBucketExpr("price_date", granularity === "phase" ? "year" : granularity)
  const rows = await queryUnbounded<{ beian_hao: string; bucket: string; nav: string | number | null }>(
    `SELECT DISTINCT ON (beian_hao, bucket)
       beian_hao,
       bucket,
       cumulative_nav::float8 AS nav
     FROM (
       SELECT
         beian_hao,
         ${bucketSql} AS bucket,
         cumulative_nav,
         price_date
       FROM private_fund_nav
       WHERE price_date >= $1::date
         AND price_date <= $2::date
         AND cumulative_nav IS NOT NULL
         AND CAST(cumulative_nav AS float8) > 0
         AND beian_hao IN (
           SELECT beian_hao
           FROM private_fund_info
           WHERE latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'
             AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL
         )
     ) nav
     ORDER BY beian_hao, bucket, price_date DESC`,
    [from, cutoff],
  )
  const out: PeriodNavRow[] = []
  for (const row of rows) {
    const nav = parseNum(row.nav)
    if (nav == null || nav <= 0) continue
    out.push({ beian_hao: row.beian_hao, bucket: row.bucket, nav })
  }
  return out
}

async function loadBenchmarkPrices(from: string, to: string): Promise<Record<BenchmarkKey, { date: string; value: number }[]>> {
  const [spot, nanhua, etf] = await Promise.all([
    query<{ symbol: string; trade_date: Date | string; close: string | number | null }>(
      `SELECT DISTINCT ON (symbol, trade_date) symbol, trade_date, close
       FROM raw_spot_daily
       WHERE symbol = ANY($1)
         AND trade_date >= $2
         AND trade_date <= $3
         AND close IS NOT NULL
         AND close > 0
       ORDER BY symbol, trade_date ASC, fetched_at DESC`,
      [["IF", "IC", "IM"], from, to],
    ).catch(() => []),
    query<{ trade_date: Date | string; close: string | number | null }>(
      `SELECT trade_date, close
       FROM raw_nanhua_indices_daily
       WHERE code = 'NHCI.NH'
         AND trade_date >= $1
         AND trade_date <= $2
         AND close IS NOT NULL
         AND CAST(close AS float8) > 0
       ORDER BY trade_date ASC`,
      [from, to],
    ).catch(() => []),
    query<{ trade_date: Date | string; value: string | number | null }>(
      `SELECT trade_date, value
       FROM raw_etf_daily
       WHERE ticker = '511010.SH'
         AND field = 'ORIGINALUNIT'
         AND trade_date >= $1
         AND trade_date <= $2
         AND value IS NOT NULL
         AND value > 0
       ORDER BY trade_date ASC`,
      [from, to],
    ).catch(() => []),
  ])

  const result: Record<BenchmarkKey, { date: string; value: number }[]> = {
    IF: [],
    IC: [],
    IM: [],
    NHCI: [],
    BOND: [],
  }
  for (const row of spot) {
    const value = n(row.close)
    const date = isoDate(row.trade_date)
    if (value == null || !date) continue
    const key = row.symbol as BenchmarkKey
    if (key === "IF" || key === "IC" || key === "IM") result[key].push({ date, value })
  }
  for (const row of nanhua) {
    const value = n(row.close)
    const date = isoDate(row.trade_date)
    if (value == null || !date) continue
    result.NHCI.push({ date, value })
  }
  for (const row of etf) {
    const value = n(row.value)
    const date = isoDate(row.trade_date)
    if (value == null || !date) continue
    result.BOND.push({ date, value })
  }
  return result
}

function bucketForDate(date: string, granularity: ReturnGranularity): string {
  const y = date.slice(0, 4)
  const m = Number(date.slice(5, 7))
  if (granularity === "month") return date.slice(0, 7)
  if (granularity === "year" || granularity === "phase") return y
  if (granularity === "quarter") return `${y}-Q${Math.ceil(m / 3)}`
  if (granularity === "half") return `${y}-H${m <= 6 ? 1 : 2}`
  const parsed = new Date(`${date}T12:00:00`)
  const day = parsed.getDay()
  const diff = parsed.getDate() - day + (day === 0 ? -6 : 1)
  parsed.setDate(diff)
  return parsed.toISOString().slice(0, 10)
}

function yearReturnFromPoints(points: { date: string; value: number }[], year: number): number | null {
  const prefix = `${year}`
  const lastInYear = [...points].reverse().find((point) => point.date.startsWith(prefix))
  if (!lastInYear) return null
  const before = [...points].reverse().find((point) => point.date < `${year}-01-01`)
  const firstInYear = points.find((point) => point.date.startsWith(prefix))
  const base = before?.value ?? firstInYear?.value
  if (base == null || base <= 0) return null
  return (lastInYear.value / base - 1) * 100
}

function periodReturnsFromPoints(
  points: { date: string; value: number }[],
  granularity: ReturnGranularity,
): Map<string, number> {
  const lastByBucket = new Map<string, { date: string; value: number }>()
  for (const point of points) {
    lastByBucket.set(bucketForDate(point.date, granularity === "phase" ? "year" : granularity), point)
  }
  const buckets = [...lastByBucket.keys()].sort()
  const rets = new Map<string, number>()
  for (let i = 1; i < buckets.length; i++) {
    const prev = lastByBucket.get(buckets[i - 1])!.value
    const cur = lastByBucket.get(buckets[i])!.value
    if (prev > 0) rets.set(buckets[i], (cur / prev - 1) * 100)
  }
  return rets
}

function displayPeriodKey(bucket: string, year: number, granularity: ReturnGranularity): string {
  if (granularity === "phase") return `${year}-phase`
  return bucket
}

function keepPeriod(bucket: string, year: number, granularity: ReturnGranularity, cutoff: string): boolean {
  if (granularity === "phase") return bucket === String(year)
  if (granularity === "year") return bucket === String(year)
  if (!bucket.startsWith(String(year))) return false
  return periodStartDate(bucket, granularity) <= cutoff
}

function buildFundReturns(rows: PeriodNavRow[]): Map<string, { bucket: string; nav: number }[]> {
  const byFund = new Map<string, { bucket: string; nav: number }[]>()
  for (const row of rows) {
    const list = byFund.get(row.beian_hao)
    if (list) list.push(row)
    else byFund.set(row.beian_hao, [row])
  }
  for (const list of byFund.values()) list.sort((a, b) => a.bucket.localeCompare(b.bucket))
  return byFund
}

function fundPeriodReturns(
  points: { bucket: string; nav: number }[],
): Map<string, number> {
  const rets = new Map<string, number>()
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].nav
    const cur = points[i].nav
    if (prev > 0) rets.set(points[i].bucket, (cur / prev - 1) * 100)
  }
  return rets
}

function fundYearReturn(points: { bucket: string; nav: number }[], year: number): number | null {
  const prefix = `${year}`
  const lastInYear = [...points].reverse().find((point) => point.bucket.startsWith(prefix))
  if (!lastInYear) return null
  const before = [...points].reverse().find((point) => point.bucket < prefix)
  const base = before?.nav ?? points.find((point) => point.bucket.startsWith(prefix))?.nav
  if (base == null || base <= 0) return null
  return (lastInYear.nav / base - 1) * 100
}

function distParams(values: number[]): StrategyObservationDistParams | null {
  const avg = mean(values)
  if (avg == null) return null
  return {
    mean: round2(avg) ?? 0,
    std: round2(stdev(values)) ?? 1.2,
    n: values.length,
  }
}

function indicatorRows(
  funds: FundRow[],
  byCategory: Map<string, Set<string>>,
  pick: (fund: FundRow) => number | null,
): StrategyObservationIndicatorRow[] {
  const rows: StrategyObservationIndicatorRow[] = []
  for (const category of STRATEGY_OBSERVATION_ALL_CATEGORIES) {
    if (category === "量化多头") continue
    const ids = byCategory.get(category)
    if (!ids?.size) continue
    const values: number[] = []
    for (const fund of funds) {
      if (!ids.has(fund.beian_hao)) continue
      const value = pick(fund)
      if (value == null || !Number.isFinite(value)) continue
      values.push(value)
    }
    const clean = sanitizeReturns(values, 250)
    if (!clean.length) continue
    const sortedDesc = [...clean].sort((a, b) => b - a)
    const avg = mean(clean) ?? 0
    rows.push({
      category,
      sampleSize: clean.length,
      average: round2(avg) ?? 0,
      p10: round2(rankedPercentile(sortedDesc, 0.1)) ?? 0,
      p25: round2(rankedPercentile(sortedDesc, 0.25)) ?? 0,
      p50: round2(rankedPercentile(sortedDesc, 0.5)) ?? 0,
      p75: round2(rankedPercentile(sortedDesc, 0.75)) ?? 0,
      p90: round2(rankedPercentile(sortedDesc, 0.9)) ?? 0,
      positiveRatio: winRate(clean) ?? 0,
    })
  }
  return rows
}

function derivedMaxdd(fund: FundRow): number | null {
  if (fund.ret_1y == null || fund.calmar_1y == null || fund.calmar_1y === 0) return null
  const maxdd = fund.ret_1y / 100 / fund.calmar_1y
  return Number.isFinite(maxdd) ? maxdd * 100 : null
}

function derivedVol(fund: FundRow): number | null {
  if (fund.ret_1y == null || fund.sharpe_1y == null || fund.sharpe_1y === 0) return null
  const vol = (fund.ret_1y / 100 - RISK_FREE) / fund.sharpe_1y
  return Number.isFinite(vol) ? Math.abs(vol) * 100 : null
}

export async function loadStrategyObservation(
  year: number,
  granularity: ReturnGranularity,
  noCache = false,
): Promise<StrategyObservationResponse> {
  const cacheKey = `${year}:${granularity}`
  const hit = cache.get(cacheKey)
  if (!noCache && hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.payload

  const cutoff = todayIso()
  const [funds, periodNavs, benchmarks] = await Promise.all([
    loadFunds(),
    loadPeriodNavs(year, granularity, cutoff),
    loadBenchmarkPrices(lookbackStart(year, granularity), cutoff),
  ])

  const byCategory = classifyFunds(funds)
  const byFundNav = buildFundReturns(periodNavs)
  const latestNav = funds.reduce((max, fund) => {
    const date = fund.latest_nav_date
    return date && date > max ? date : max
  }, "")
  const statsCutoff = latestNav && latestNav < cutoff ? latestNav : cutoff

  const rawPeriodKeys = new Set<string>()
  for (const points of byFundNav.values()) {
    for (const point of points) {
      if (keepPeriod(point.bucket, year, granularity, statsCutoff)) rawPeriodKeys.add(point.bucket)
    }
  }
  const periodKeys = granularity === "phase"
    ? [`${year}-phase`]
    : [...rawPeriodKeys].sort()

  const benchRets: Partial<Record<BenchmarkKey, Map<string, number>>> = {}
  for (const key of Object.keys(benchmarks) as BenchmarkKey[]) {
    benchRets[key] = periodReturnsFromPoints(benchmarks[key], granularity)
  }

  const series: Record<string, StrategyObservationSeries> = {}
  const distributions: Record<string, StrategyObservationDistribution> = {}
  const lastKey = periodKeys[periodKeys.length - 1]
  const prevKey = periodKeys[periodKeys.length - 2]

  for (const category of STRATEGY_OBSERVATION_ALL_CATEGORIES) {
    const ids = byCategory.get(category)
    if (!ids?.size) continue
    const benchKey = STRATEGY_BENCHMARK[category]
    const benchMap = benchKey ? benchRets[benchKey] : undefined
    const perPeriod: number[][] = periodKeys.map(() => [])
    const yearRets: number[] = []
    const lastRets: number[] = []
    const prevRets: number[] = []

    for (const beianHao of ids) {
      const points = byFundNav.get(beianHao)
      if (!points?.length) continue
      const rets = fundPeriodReturns(points)
      const ytd = fundYearReturn(points, year)
      if (ytd != null && Number.isFinite(ytd)) yearRets.push(ytd)
      for (let i = 0; i < periodKeys.length; i++) {
        const key = periodKeys[i]
        const rawKey = granularity === "phase" ? String(year) : key
        const value = granularity === "phase" ? ytd : rets.get(rawKey)
        if (value == null || !Number.isFinite(value)) continue
        perPeriod[i].push(value)
        if (key === lastKey) lastRets.push(value)
        if (key === prevKey) prevRets.push(value)
      }
    }

    const periodCap = granularity === "week" ? 40 : granularity === "month" ? 80 : 150
    const values = perPeriod.map((list) => round2(mean(sanitizeReturns(list, periodCap))))
    const excessValues = values.map((value, index) => {
      if (value == null) return null
      const rawKey = granularity === "phase" ? String(year) : periodKeys[index]
      const bench = benchMap?.get(rawKey) ?? 0
      return round2(value - bench)
    })
    const yearRet = round2(mean(sanitizeReturns(yearRets, 200)))
    const yearBench = benchKey ? yearReturnFromPoints(benchmarks[benchKey], year) ?? 0 : 0
    series[category] = {
      values,
      excessValues,
      yearRet,
      excessYearRet: yearRet == null ? null : round2(yearRet - yearBench),
      winRate: winRate(values.filter((value): value is number => value != null)),
      excessWinRate: winRate(excessValues.filter((value): value is number => value != null)),
      sampleN: ids.size,
    }

    const lastClean = sanitizeReturns(lastRets, periodCap)
    const prevClean = sanitizeReturns(prevRets, periodCap)
    const lastBench = lastKey ? (benchMap?.get(granularity === "phase" ? String(year) : lastKey) ?? 0) : 0
    const prevBench = prevKey ? (benchMap?.get(prevKey) ?? 0) : 0
    distributions[category] = {
      current: distParams(lastClean),
      previous: distParams(prevClean),
      excessCurrent: distParams(lastClean.map((value) => value - lastBench)),
      excessPrevious: distParams(prevClean.map((value) => value - prevBench)),
    }
  }

  const indicators: Record<StrategyObservationIndicatorTab, StrategyObservationIndicatorRow[]> = {
    return: indicatorRows(funds, byCategory, (fund) => fund.ret_1y),
    sharpe: indicatorRows(funds, byCategory, (fund) => fund.sharpe_1y),
    calmar: indicatorRows(funds, byCategory, (fund) => fund.calmar_1y),
    maxdd: indicatorRows(funds, byCategory, derivedMaxdd),
    vol: indicatorRows(funds, byCategory, derivedVol),
  }

  const payload: StrategyObservationResponse = {
    year,
    granularity,
    cutoff: statsCutoff,
    fundCount: funds.length,
    periodKeys: periodKeys.map((key) => displayPeriodKey(key, year, granularity)),
    series,
    distributions,
    indicators,
  }
  cache.set(cacheKey, { ts: Date.now(), payload })
  return payload
}
