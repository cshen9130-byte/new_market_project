/**
 * Daily strategy-environment scores for 市场观察 → 策略环境.
 *
 * A high score means the current market is easier for that sleeve.
 * It is not a forecast of the sleeve's return.
 * Factors that we cannot observe (convertible-bond floor, 5-minute path)
 * are left out rather than filled in.
 */

import { annualizedBasisPct, calendarDaysToCffexExpiry } from "@/lib/client/cffex-expiry"
import {
  bandRating,
  clamp,
  correlation,
  emptyStrategy,
  headlineFromHistory,
  mean,
  pctRank,
  round1,
  smoothedScoreAt,
  tStatOfCorr,
  toneOf,
  variance,
  weightedScore,
  type EnvFactor,
  type EnvStrategy,
  type StrategyEnvironmentPayload,
} from "@/lib/ma/strategy-environment"
import { UNDERLYING_CN_LABELS } from "@/lib/option-iv-labels"
import { queryUnbounded } from "@/lib/db"
import { loadQuantExtras, type QuantPrint } from "@/lib/server/strategy-environment-quant"
import { loadPrivateFundBenchmarkSeries } from "@/lib/server/private-fund-benchmarks"
import { readStrategySnapshot, writeStrategySnapshot } from "@/lib/server/strategy-environment-snapshot"

/** A-share, crowding and CFFEX tables in this database start on 2025-01-02. */
const LOOKBACK_DAYS = 800
/** Continuous commodity futures start on 2023-01-03. */
const COMMODITY_LOOKBACK_DAYS = 1600
const PCT_WINDOW = 60
const CACHE_MS = 10 * 60 * 1000

const FINANCIAL = new Set(["IF", "IH", "IC", "IM", "T", "TF", "TS", "TL", "IO", "HO", "MO"])
const INDEX_PRODUCTS = ["IH", "IF", "IC", "IM"] as const
const SPOT_INDEX: Record<(typeof INDEX_PRODUCTS)[number], string> = {
  IH: "000016.SH",
  IF: "000300.SH",
  IC: "000905.SH",
  IM: "000852.SH",
}
const OPTION_KEYS = [
  { key: "50etf", fallback: "50index", label: "50ETF", sector: "股指" },
  { key: "300etf", fallback: "300index", label: "300ETF", sector: "股指" },
  { key: "500etf", fallback: "500index", label: "500ETF", sector: "股指" },
  { key: "1000index", fallback: "1000etf", label: "中证1000", sector: "股指" },
  { key: "cyb", fallback: "cyb", label: "创业板", sector: "股指" },
  { key: "kcb", fallback: "kcb_efund", label: "科创50", sector: "股指" },
] as const

const COMMODITY_OPTION_SECTOR: Record<string, string> = {
  a: "农产品", b: "农产品", m: "农产品", y: "农产品", p: "农产品", c: "农产品", cs: "农产品",
  jd: "农产品", lh: "农产品", lg: "农产品", sr: "农产品", cf: "农产品", oi: "农产品", rm: "农产品",
  pk: "农产品", ap: "农产品", cj: "农产品",
  i: "黑色", rb: "黑色", sf: "黑色", sm: "黑色", zc: "黑色",
  cu: "有色", al: "有色", zn: "有色", pb: "有色", ni: "有色", sn: "有色", ao: "有色", au: "有色", ag: "有色",
  sc: "能化", ru: "能化", br: "能化", nr: "能化", fu: "能化", l: "能化", v: "能化", pp: "能化", eg: "能化",
  eb: "能化", pg: "能化", ta: "能化", ma: "能化", fg: "能化", sa: "能化", sh: "能化", ur: "能化", pf: "能化",
  px: "能化", pr: "能化", si: "能化", lc: "能化", ps: "能化",
}

const EQUITY_AMOUNT: Record<string, string> = {
  "50etf": "000016.SH",
  "50index": "000016.SH",
  "300etf": "000300.SH",
  "300index": "000300.SH",
  "500etf": "000905.SH",
  "500index": "000905.SH",
  "1000index": "000852.SH",
  "1000etf": "000852.SH",
  cyb: "399006.SZ",
  kcb: "000688.SH",
  kcb_efund: "000688.SH",
}

type StockDay = {
  date: string
  amount: number
  n: number
  xsVol: number
  amp: number | null
  breadth20: number | null
  sealedUp: number
  brokenUp: number
  sealedDown: number
  promoted: number
  yesterdayUp: number
}

type IndexDay = { date: string; close: number; amount: number | null }
type ContractRow = {
  date: string
  contract: string
  open: number
  high: number
  low: number
  close: number
  oi: number
}
type CommodityBar = { date: string; close: number; volume: number }
type IvPoint = { date: string; key: string; iv: number }

let cache: { at: number; data: StrategyEnvironmentPayload } | null = null

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function ymd(value: string): string {
  return String(value).slice(0, 10)
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[strategy-environment] ${label}`, err)
    return fallback
  }
}

async function loadStock(): Promise<StockDay[]> {
  const rows = await queryUnbounded<{
    trade_date: string
    amount: string | number | null
    n: string | number | null
    xs_vol: string | number | null
    amp: string | number | null
    breadth20: string | number | null
    sealed_up: string | number | null
    broken_up: string | number | null
    sealed_down: string | number | null
    promoted: string | number | null
    yesterday_up: string | number | null
  }>(
    `WITH px AS (
       SELECT trade_date,
              ts_code,
              split_part(ts_code, '.', 1) AS code,
              close::float8 AS close,
              high::float8 AS high,
              low::float8 AS low,
              COALESCE(amount, 0)::float8 AS amount,
              LAG(close::float8) OVER (PARTITION BY ts_code ORDER BY trade_date) AS prev,
              LAG(close::float8, 20) OVER (PARTITION BY ts_code ORDER BY trade_date) AS p20
       FROM raw_ashare_daily
       WHERE trade_date >= CURRENT_DATE - $1::int
         AND close > 0
     ),
     flagged AS (
       SELECT trade_date, ts_code, amount, close, high, low, prev, p20,
              CASE
                WHEN code ~ '^(300|301|688|689)' THEN 0.198
                WHEN code ~ '^(8|43|83|87|92)' THEN 0.298
                ELSE 0.098
              END AS lim
       FROM px
     ),
     sealed AS (
       SELECT trade_date, ts_code, amount, close, high, low, prev, p20, lim,
              CASE
                WHEN prev > 0 AND high > 0 AND close / prev - 1 >= lim AND close >= high * 0.998 THEN 1
                ELSE 0
              END AS is_sealed
       FROM flagged
     ),
     marked AS (
       SELECT trade_date, amount, close, high, low, prev, p20, lim, is_sealed,
              LAG(is_sealed) OVER (PARTITION BY ts_code ORDER BY trade_date) AS prev_sealed
       FROM sealed
     )
     SELECT trade_date::text AS trade_date,
            SUM(amount)::float8 AS amount,
            COUNT(*)::int AS n,
            STDDEV_SAMP(close / prev - 1) FILTER (WHERE ABS(close / prev - 1) < 0.35)::float8 AS xs_vol,
            AVG((high - low) / prev) FILTER (WHERE (high - low) / prev > 0 AND (high - low) / prev < 0.25)::float8 AS amp,
            AVG((close / p20 - 1 > 0)::int) FILTER (WHERE p20 > 0 AND ABS(close / p20 - 1) < 1.2)::float8 AS breadth20,
            COUNT(*) FILTER (WHERE is_sealed = 1)::int AS sealed_up,
            COUNT(*) FILTER (WHERE prev > 0 AND high / prev - 1 >= lim AND close / prev - 1 < lim)::int AS broken_up,
            COUNT(*) FILTER (WHERE prev > 0 AND close / prev - 1 <= -lim AND close <= low * 1.002)::int AS sealed_down,
            COUNT(*) FILTER (WHERE is_sealed = 1 AND prev_sealed = 1)::int AS promoted,
            COUNT(*) FILTER (WHERE prev_sealed = 1)::int AS yesterday_up
     FROM marked
     WHERE prev > 0 AND high > 0 AND low > 0
     GROUP BY trade_date
     HAVING COUNT(*) >= 1000
     ORDER BY trade_date`,
    [LOOKBACK_DAYS],
  )
  return rows.flatMap((row) => {
    const amount = num(row.amount)
    const n = num(row.n)
    const xsVol = num(row.xs_vol)
    if (amount == null || n == null || xsVol == null || n < 1000) return []
    return [{
      date: ymd(row.trade_date),
      amount,
      n,
      xsVol,
      amp: num(row.amp),
      breadth20: num(row.breadth20),
      sealedUp: num(row.sealed_up) ?? 0,
      brokenUp: num(row.broken_up) ?? 0,
      sealedDown: num(row.sealed_down) ?? 0,
      promoted: num(row.promoted) ?? 0,
      yesterdayUp: num(row.yesterday_up) ?? 0,
    }]
  })
}

async function loadLimitUps(): Promise<Array<{ date: string; code: string }>> {
  const rows = await queryUnbounded<{ trade_date: string; code: string }>(
    `WITH px AS (
       SELECT trade_date,
              split_part(ts_code, '.', 1) AS code,
              close::float8 AS close,
              high::float8 AS high,
              LAG(close::float8) OVER (PARTITION BY ts_code ORDER BY trade_date) AS prev
       FROM raw_ashare_daily
       WHERE trade_date >= CURRENT_DATE - $1::int
         AND close > 0
     )
     SELECT trade_date::text AS trade_date, code
     FROM px
     WHERE prev > 0
       AND close / prev - 1 >= CASE
             WHEN code ~ '^(300|301|688|689)' THEN 0.198
             WHEN code ~ '^(8|43|83|87|92)' THEN 0.298
             ELSE 0.098
           END
       AND close >= high * 0.998`,
    [LOOKBACK_DAYS],
  )
  return rows.map((row) => ({ date: ymd(row.trade_date), code: row.code }))
}

// These reads sit beside the full A-share scan. The pool's 60s statement
// timeout used to cancel them, and the snapshot then stored an empty sleeve.
async function loadIndexes(): Promise<Map<string, IndexDay[]>> {
  const rows = await queryUnbounded<{
    trade_date: string
    ts_code: string
    close: string | number
    amount: string | number | null
  }>(
    `SELECT trade_date::text AS trade_date, ts_code, close::float8 AS close, amount::float8 AS amount
     FROM raw_ashare_index_daily
     WHERE ts_code IN ('000016.SH','000300.SH','000905.SH','000852.SH','000688.SH','399006.SZ','000832.SH')
       AND trade_date >= DATE '2015-01-01'
       AND close > 0
     ORDER BY ts_code, trade_date`,
  )
  const out = new Map<string, IndexDay[]>()
  for (const row of rows) {
    const close = num(row.close)
    if (close == null) continue
    const list = out.get(row.ts_code) ?? []
    list.push({ date: ymd(row.trade_date), close, amount: num(row.amount) })
    out.set(row.ts_code, list)
  }
  return out
}

async function loadFutures(): Promise<ContractRow[]> {
  const rows = await queryUnbounded<{
    trade_date: string
    contract: string
    open: string | number | null
    high: string | number | null
    low: string | number | null
    close: string | number | null
    oi: string | number | null
  }>(
    `SELECT trade_date::text AS trade_date,
            upper(split_part(contract, '.', 1)) AS contract,
            open::float8 AS open,
            high::float8 AS high,
            low::float8 AS low,
            close::float8 AS close,
            COALESCE(hqoi, 0)::float8 AS oi
     FROM raw_futures_contracts_daily
     WHERE trade_date >= CURRENT_DATE - $1::int
       AND upper(split_part(contract, '.', 1)) ~ '^(IF|IH|IC|IM)[0-9]{4}$'
       AND close > 0`,
    [LOOKBACK_DAYS + 40],
  )
  return rows.flatMap((row) => {
    const open = num(row.open)
    const high = num(row.high)
    const low = num(row.low)
    const close = num(row.close)
    if (open == null || high == null || low == null || close == null) return []
    if (!(high >= low) || !(close > 0)) return []
    return [{
      date: ymd(row.trade_date),
      contract: row.contract,
      open,
      high,
      low,
      close,
      oi: num(row.oi) ?? 0,
    }]
  })
}

async function loadSpots(): Promise<Map<string, Map<string, number>>> {
  const rows = await queryUnbounded<{ trade_date: string; symbol: string; close: string | number }>(
    `SELECT DISTINCT ON (trade_date, upper(symbol))
            trade_date::text AS trade_date,
            upper(symbol) AS symbol,
            close::float8 AS close
     FROM raw_spot_daily
     WHERE upper(symbol) IN ('IF','IH','IC','IM')
       AND trade_date >= CURRENT_DATE - $1::int
       AND close > 0
     ORDER BY trade_date, upper(symbol), CASE WHEN source = 'emquant' THEN 0 ELSE 1 END`,
    [LOOKBACK_DAYS + 40],
  )
  const out = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const close = num(row.close)
    if (close == null) continue
    const book = out.get(row.symbol) ?? new Map<string, number>()
    book.set(ymd(row.trade_date), close)
    out.set(row.symbol, book)
  }
  return out
}

async function loadCommodities(): Promise<Map<string, CommodityBar[]>> {
  const rows = await queryUnbounded<{
    trade_date: string
    code: string
    close: string | number
    volume: string | number | null
  }>(
    `SELECT trade_date::text AS trade_date, upper(code) AS code, close::float8 AS close, volume::float8 AS volume
     FROM raw_akshare_futures_daily
     WHERE trade_date >= CURRENT_DATE - $1::int
       AND close > 0
       AND (upper(code) ~ '^[A-Z]+0\\.' OR upper(code) ~ '^[A-Z]{2,}M\\.')`,
    [COMMODITY_LOOKBACK_DAYS],
  )
  const buckets = new Map<string, { prefer: number; bars: CommodityBar[] }>()
  for (const row of rows) {
    const base = row.code.split(".")[0] ?? ""
    const prefer = /0$/.test(base) ? 2 : 1
    const product = base.replace(/(0|M)$/, "")
    if (!product || FINANCIAL.has(product)) continue
    const close = num(row.close)
    if (close == null) continue
    const bar = { date: ymd(row.trade_date), close, volume: num(row.volume) ?? 0 }
    const existing = buckets.get(product)
    if (!existing) buckets.set(product, { prefer, bars: [bar] })
    else if (prefer > existing.prefer) buckets.set(product, { prefer, bars: [bar] })
    else if (prefer === existing.prefer) existing.bars.push(bar)
  }
  const out = new Map<string, CommodityBar[]>()
  for (const [product, bucket] of buckets) {
    const byDate = new Map<string, CommodityBar>()
    for (const bar of bucket.bars) byDate.set(bar.date, bar)
    const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
    if (bars.length >= 30) out.set(product, bars)
  }
  return out
}

async function loadIv(): Promise<IvPoint[]> {
  const rows = await queryUnbounded<{ trade_date: string; underlying_key: string; iv: string | number }>(
    `SELECT trade_date::text AS trade_date, underlying_key, iv::float8 AS iv
     FROM raw_option_iv_qvix_daily
     WHERE underlying_key IN ('50etf','50index','300etf','300index','500etf','500index','1000index','1000etf','cyb','kcb','kcb_efund')
       AND trade_date >= DATE '2015-01-01'
       AND iv > 0
     ORDER BY trade_date`,
  )
  return rows.flatMap((row) => {
    const iv = num(row.iv)
    if (iv == null) return []
    return [{ date: ymd(row.trade_date), key: row.underlying_key, iv }]
  })
}

async function loadCommodityIv(): Promise<IvPoint[]> {
  const rows = await queryUnbounded<{ trade_date: string; underlying_key: string; iv: string | number }>(
    `SELECT trade_date::text AS trade_date, underlying_key, iv::float8 AS iv
     FROM raw_commodity_option_iv_daily
     WHERE trade_date >= DATE '2015-01-01'
       AND iv > 0
     ORDER BY underlying_key, trade_date`,
  )
  return rows.flatMap((row) => {
    const iv = num(row.iv)
    if (iv == null || !COMMODITY_OPTION_SECTOR[row.underlying_key]) return []
    return [{ date: ymd(row.trade_date), key: row.underlying_key, iv }]
  })
}

function amountYi(amount: number): number {
  if (amount >= 1e10) return amount / 1e8
  if (amount >= 1e6) return amount / 1e4
  return amount
}

function formatYi(amount: number): string {
  return `${amountYi(amount).toFixed(0)} 亿`
}

function lastFinite(values: Array<number | null>, end: number, size: number): number[] {
  const out: number[] = []
  for (let i = end; i >= 0 && out.length < size; i--) {
    const value = values[i]
    if (value != null && Number.isFinite(value)) out.push(value)
  }
  return out.reverse()
}

/** Published score faces the same way as 近20日超额. These sleeves were backwards. */
function oppose(score: number): number {
  return round1(100 - score)
}

function trailingAverage(values: Array<number | null>, index: number, window: number): number | null {
  const sample = lastFinite(values, index, window)
  if (sample.length < window) return null
  return sample.reduce((sum, item) => sum + item, 0) / sample.length
}

type Scored<T> = T & { date: string; score: number }

function packStrategy<T extends { date: string; score: number }>(
  key: string,
  name: string,
  group: string,
  points: Array<Scored<T>>,
  describe: (last: Scored<T>, prev: Scored<T> | null, delta: number | null) => {
    rating: string
    headline: string
    factors: EnvFactor[]
    notes: string[]
  },
): EnvStrategy {
  const last = points[points.length - 1]
  if (!last) return emptyStrategy(key, name, group, `${name}缺少足够行情，这一期先不打分。`)
  const prev = points.length > 5 ? points[points.length - 6] : null
  const history = points.map((point) => ({ date: point.date, score: point.score }))
  const end = history.length - 1
  const raw = smoothedScoreAt(history, end)
  const prevRaw = end >= 5 ? smoothedScoreAt(history, end - 5) : null
  const delta = raw == null || prevRaw == null ? null : round1(raw - prevRaw)
  const described = describe(last, prev, delta)
  const headline = headlineFromHistory({
    key,
    name,
    rating: described.rating,
    history,
    notes: described.notes,
  })
  return {
    key,
    name,
    group,
    asOf: last.date,
    score: headline?.score ?? last.score,
    alphaScore: headline?.alphaScore ?? headline?.score ?? last.score,
    marketBeta: null,
    betaScore: headline?.betaScore ?? null,
    market10d: headline?.market10d ?? null,
    totalScore: headline?.totalScore ?? headline?.score ?? last.score,
    totalDelta: headline?.totalDelta ?? headline?.delta5 ?? delta,
    market10: [],
    rating: headline?.rating ?? described.rating,
    tone: headline?.tone ?? toneOf(last.score),
    delta5: headline?.delta5 ?? delta,
    compareDate: headline?.compareDate ?? prev?.date ?? null,
    history,
    headline: described.headline,
    factors: rescaleWeights(described.factors),
    notes: headline?.notes ?? described.notes,
  }
}

function rescaleWeights(factors: EnvFactor[]): EnvFactor[] {
  // Some sleeves show extra inputs that are not their own weighted term
  // (日间的路径效率先取最大值，再进总分). Leave those weights alone.
  if (factors.some((factor) => factor.weight == null)) return factors
  const total = factors.reduce((sum, factor) => sum + (factor.weight ?? 0), 0)
  if (!(total > 0) || Math.abs(total - 1) < 0.02) return factors
  return factors.map((factor) => ({
    ...factor,
    weight: Math.round(((factor.weight ?? 0) / total) * 1000) / 1000,
  }))
}

function boardHeight(limitUps: Array<{ date: string; code: string }>, dates: string[]): Map<string, number> {
  const byDate = new Map<string, Set<string>>()
  for (const row of limitUps) {
    const set = byDate.get(row.date) ?? new Set<string>()
    set.add(row.code)
    byDate.set(row.date, set)
  }
  const height = new Map<string, number>()
  dates.forEach((date, index) => {
    const today = byDate.get(date)
    if (!today?.size) {
      height.set(date, 0)
      return
    }
    let best = 1
    for (const code of today) {
      let run = 1
      for (let back = index - 1; back >= 0; back--) {
        if (!byDate.get(dates[back])?.has(code)) break
        run += 1
      }
      if (run > best) best = run
    }
    height.set(date, best)
  })
  return height
}

/** Last 5 trading days' average amount versus the 5 days before that. Not a score input. */
function amountWeekChange(stock: StockDay[], index: number): number | null {
  if (index < 9) return null
  const recent = mean(stock.slice(index - 4, index + 1).map((day) => day.amount))
  const prior = mean(stock.slice(index - 9, index - 4).map((day) => day.amount))
  if (!(prior > 0)) return null
  return recent / prior - 1
}

function amountWowPhrase(wow: number | null): string {
  if (wow == null) return "周环比样本不够"
  const pct = `${wow >= 0 ? "+" : ""}${(wow * 100).toFixed(1)}%`
  const tone = Math.abs(wow) < 0.05 ? "基本平稳" : wow > 0 ? "较上周放量" : "较上周缩量"
  return `5 日均额周环比 ${pct}，${tone}`
}

const QUANT_WEIGHT = { amp: 0.4, xs: 0.25, margin: 0.25, amt: 0.1 }
const QUANT_AMP_SMOOTH = 5
const QUANT_FAST_WINDOW = 40
/** Exchange margin prints in this source lag the session. Keep the last print for two weeks. */
const MARGIN_CARRY_DAYS = 15

function carriedMargin(dates: string[], prints: QuantPrint[]): Array<number | null> {
  const sorted = [...prints].sort((a, b) => (a.date < b.date ? -1 : 1))
  let cursor = 0
  let last: QuantPrint | null = null
  return dates.map((date) => {
    while (cursor < sorted.length && sorted[cursor].date <= date) {
      last = sorted[cursor]
      cursor += 1
    }
    if (!last) return null
    const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last.date}T00:00:00Z`)) / 86_400_000
    return gap <= MARGIN_CARRY_DAYS ? last.value : null
  })
}

function buildQuant(stock: StockDay[], marginPrints: QuantPrint[]): EnvStrategy {
  const points: Scored<{
    amp: number | null
    ampPct: number | null
    xs: number | null
    xsPct: number | null
    amt: number
    amtPct: number
    amtWow: number | null
    margin: number | null
    marginPct: number | null
  }>[] = []
  const marginSeries = carriedMargin(stock.map((day) => day.date), marginPrints)
  const ampSeries: Array<number | null> = stock.map((day) => day.amp)
  const ampSmooth = ampSeries.map((_, index) => trailingAverage(ampSeries, index, QUANT_AMP_SMOOTH))
  const xsSeries: Array<number | null> = stock.map((day) => day.xsVol)
  for (let i = 0; i < stock.length; i++) {
    if (i < 20) continue
    const day = stock[i]
    const amtWindow = stock.slice(Math.max(0, i - PCT_WINDOW + 1), i + 1).map((item) => item.amount)
    const amtPct = pctRank(amtWindow, day.amount)
    const amtWow = amountWeekChange(stock, i)
    const marginValue = marginSeries[i]
    const marginWindow = lastFinite(marginSeries, i, PCT_WINDOW)
    const marginPct = marginValue == null || marginWindow.length < 15 ? null : pctRank(marginWindow, marginValue)
    const ampValue = ampSmooth[i]
    const ampWindow = lastFinite(ampSmooth, i, QUANT_FAST_WINDOW)
    const ampPct = ampValue == null || ampWindow.length < 15 ? null : pctRank(ampWindow, ampValue)
    const xsValue = xsSeries[i]
    const xsWindow = lastFinite(xsSeries, i, QUANT_FAST_WINDOW)
    const xsPct = xsValue == null || xsWindow.length < 15 ? null : pctRank(xsWindow, xsValue)
    const score = weightedScore([
      ampPct == null ? null : { score: 100 - ampPct, weight: QUANT_WEIGHT.amp },
      xsPct == null ? null : { score: 100 - xsPct, weight: QUANT_WEIGHT.xs },
      marginPct == null ? null : { score: 100 - marginPct, weight: QUANT_WEIGHT.margin },
      { score: 100 - amtPct, weight: QUANT_WEIGHT.amt },
    ])
    if (score == null) continue
    points.push({
      date: day.date,
      score,
      amp: ampValue,
      ampPct,
      xs: xsValue,
      xsPct,
      amt: day.amount,
      amtPct,
      amtWow,
      margin: marginValue,
      marginPct,
    })
  }
  return packStrategy("quant", "宽基量化", "股票", points, (last) => {
    const tape = last.xsPct == null ? "截面波动样本不够" : last.xsPct < 40 ? "截面波动偏低，和近期超额更合拍" : last.xsPct > 70 ? "截面波动偏高" : "截面波动中性"
    return {
      rating: bandRating(last.score),
      headline: `振幅分位 ${last.ampPct == null ? "—" : last.ampPct.toFixed(0)}，截面波动分位 ${last.xsPct == null ? "—" : last.xsPct.toFixed(0)}，两融分位 ${last.marginPct == null ? "—" : last.marginPct.toFixed(0)}，成交分位 ${last.amtPct.toFixed(0)}`,
      factors: [
        last.ampPct == null ? null : {
          key: "amp",
          label: "日内振幅",
          score: round1(100 - last.ampPct),
          weight: QUANT_WEIGHT.amp,
          detail: `近 5 日平均振幅 ${last.amp == null ? "—" : `${(last.amp * 100).toFixed(2)}%`}，40 日分位 ${last.ampPct.toFixed(0)}。分位越低，这一项越高`,
        },
        last.xsPct == null ? null : {
          key: "xs",
          label: "截面波动",
          score: round1(100 - last.xsPct),
          weight: QUANT_WEIGHT.xs,
          detail: `个股日收益标准差 ${(last.xs == null ? 0 : last.xs * 100).toFixed(2)}%，40 日分位 ${last.xsPct.toFixed(0)}。分位越低，这一项越高`,
        },
        last.marginPct == null ? null : {
          key: "margin",
          label: "两融余额",
          score: round1(100 - last.marginPct),
          weight: QUANT_WEIGHT.margin,
          detail: `两融余额 ${formatYi(last.margin ?? 0)}，60 日分位 ${last.marginPct.toFixed(0)}。分位越低，这一项越高`,
        },
        {
          key: "amt",
          label: "成交热度",
          score: round1(100 - last.amtPct),
          weight: QUANT_WEIGHT.amt,
          detail: `全 A 成交额 ${formatYi(last.amt)}，60 日分位 ${last.amtPct.toFixed(0)}。分位越低，这一项越高。${amountWowPhrase(last.amtWow)}`,
        },
      ].filter((factor): factor is EnvFactor => factor != null),
      notes: [
        `${tape}。振幅和截面波动低的时候，分数和近 20 日超额更合拍；两融和成交偏冷的时候，随后的超额更好。`,
        `全 A 成交额 ${formatYi(last.amt)}，分位 ${last.amtPct.toFixed(0)}。${amountWowPhrase(last.amtWow)}。${last.margin == null ? "" : `两融余额 ${formatYi(last.margin)}，分位 ${last.marginPct?.toFixed(0) ?? "—"}。`}`,
      ],
    }
  })
}

function buildSentiment(stock: StockDay[], limitUps: Array<{ date: string; code: string }>): EnvStrategy {
  const height = boardHeight(limitUps, stock.map((day) => day.date))
  const points: Scored<{
    up: number
    down: number
    broken: number
    promo: number | null
    height: number
    ratioScore: number
    sealScore: number
    promoScore: number
    heightScore: number
    countPct: number
  }>[] = []
  for (let i = 0; i < stock.length; i++) {
    if (i < 15) continue
    const day = stock[i]
    const up = day.sealedUp
    const down = day.sealedDown
    const broken = day.brokenUp
    const ratio = down > 0 ? up / down : up > 0 ? 3 : 1
    const ratioScore = clamp(((ratio - 0.3) / 1.7) * 100)
    const touched = up + broken
    const sealScore = touched > 0 ? (up / touched) * 100 : 50
    const promo = day.yesterdayUp > 0 ? day.promoted / day.yesterdayUp : null
    const promoScore = promo == null ? 50 : clamp(((promo - 0.08) / 0.42) * 100)
    const boards = height.get(day.date) ?? 0
    const heightScore = clamp(boards * 18)
    const countWindow = stock.slice(Math.max(0, i - PCT_WINDOW + 1), i + 1).map((item) => item.sealedUp)
    const countPct = pctRank(countWindow, up)
    const score = weightedScore([
      { score: ratioScore, weight: 0.28 },
      { score: sealScore, weight: 0.22 },
      { score: promoScore, weight: 0.18 },
      { score: heightScore, weight: 0.12 },
      { score: countPct, weight: 0.2 },
    ])
    if (score == null) continue
    points.push({
      date: day.date,
      score: oppose(score),
      up,
      down,
      broken,
      promo,
      height: boards,
      ratioScore,
      sealScore,
      promoScore,
      heightScore,
      countPct,
    })
  }
  return packStrategy("momentum", "强势股", "股票", points, (last) => {
    const rating = bandRating(last.score)
    const ratio = last.down > 0 ? last.up / last.down : last.up
    const breakRate = last.up + last.broken > 0 ? (last.broken / (last.up + last.broken)) * 100 : 0
    return {
      rating,
      headline: `涨停 ${last.up} / 跌停 ${last.down}，炸板率 ${breakRate.toFixed(0)}%`,
      factors: [
        { key: "ratio", label: "涨跌停", score: round1(last.ratioScore), weight: 0.28, detail: `涨停 ${last.up} 家，跌停 ${last.down} 家，比值 ${ratio.toFixed(2)}` },
        { key: "seal", label: "封板", score: round1(last.sealScore), weight: 0.22, detail: `触及涨停后收住 ${last.sealScore.toFixed(0)}%，炸板率 ${breakRate.toFixed(1)}%` },
        { key: "promo", label: "晋级", score: round1(last.promoScore), weight: 0.18, detail: last.promo == null ? "昨日涨停样本不足" : `昨日涨停今日继续封板 ${ (last.promo * 100).toFixed(1) }%` },
        { key: "height", label: "连板高度", score: round1(last.heightScore), weight: 0.12, detail: `最高连板 ${last.height} 板` },
        { key: "count", label: "涨停家数", score: round1(last.countPct), weight: 0.2, detail: `封板家数的 60 日分位 ${last.countPct.toFixed(0)}` },
      ],
      notes: [
        `涨停 ${last.up} 家对跌停 ${last.down} 家，比值 ${ratio.toFixed(2)}。炸板率 ${breakRate.toFixed(1)}%，最高连板 ${last.height} 板。`,
        last.promo == null
          ? "昨日涨停家数太少，晋级率这天不稳定。"
          : `晋级率 ${(last.promo * 100).toFixed(1)}%。${last.promo >= 0.35 ? "接力还在。" : "接力偏弱，情绪更多是低位，不是主升。"}`,
        "涨跌停按 10% / 20% / 30% 板块阈值近似，没有单独识别 ST 的 5% 板。",
        "涨停生态越热，这五项目前加出来的分越高，但近 20 日超额越差。环境分用 100 减这个加权分。",
      ],
    }
  })
}

type ProdSeries = { dates: string[]; close: number[]; ret: Array<number | null>; volume: number[] }

function commoditySeries(products: Map<string, CommodityBar[]>): Map<string, ProdSeries> {
  const out = new Map<string, ProdSeries>()
  for (const [product, bars] of products) {
    const ret: Array<number | null> = [null]
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].close
      const change = prev > 0 ? bars[i].close / prev - 1 : null
      ret.push(change == null || Math.abs(change) > 0.08 ? null : change)
    }
    out.set(product, {
      dates: bars.map((bar) => bar.date),
      close: bars.map((bar) => bar.close),
      ret,
      volume: bars.map((bar) => bar.volume),
    })
  }
  return out
}

function retsEnding(series: ProdSeries, date: string, size: number): { rets: number[]; volume: number } | null {
  const index = series.dates.lastIndexOf(date)
  if (index < 0) return null
  const rets: number[] = []
  let volume = 0
  let volumeDays = 0
  for (let i = index; i >= 0 && rets.length < size; i--) {
    const value = series.ret[i]
    if (value != null) rets.push(value)
    if (i > index - size) {
      volume += series.volume[i]
      volumeDays += 1
    }
  }
  if (series.dates[index] !== date) return null
  return { rets: rets.reverse(), volume: volumeDays ? volume / volumeDays : 0 }
}

function buildCta(products: Map<string, CommodityBar[]>): EnvStrategy {
  const series = commoditySeries(products)
  const dates = [...new Set([...series.values()].flatMap((item) => item.dates))].sort()
  type CtaPoint = {
    trending: number
    active: number
    coverage: number
    vol: number
    volPct: number
    volumeRatio: number
  }
  const volHistory: number[] = []
  const points: Scored<CtaPoint>[] = []
  for (const date of dates) {
    const stats: Array<{ er: number; net: number; vol: number; volume: number }> = []
    for (const product of series.values()) {
      const window = retsEnding(product, date, 20)
      if (!window || window.rets.length < 15) continue
      const net = window.rets.reduce((sum, value) => sum + value, 0)
      const path = window.rets.reduce((sum, value) => sum + Math.abs(value), 0)
      const er = path > 1e-9 ? Math.abs(net) / path : 0
      stats.push({ er, net, vol: Math.sqrt(variance(window.rets)), volume: window.volume })
    }
    if (stats.length < 20) continue
    const volumeFloor = [...stats].map((item) => item.volume).sort((a, b) => a - b)[Math.floor(stats.length * 0.15)] ?? 0
    const active = stats.filter((item) => item.volume >= volumeFloor && item.volume > 0)
    if (active.length < 15) continue
    const trending = active.filter((item) => item.er >= 0.25 && Math.abs(item.net) >= 0.03).length
    const coverage = trending / active.length
    const vol = mean(active.map((item) => item.vol))
    volHistory.push(vol)
    const volPct = pctRank(volHistory.slice(-PCT_WINDOW), vol)
    const volumeToday = mean(active.map((item) => item.volume))
    const volumeBase = mean(volHistory.length ? [volumeToday] : [volumeToday])
    void volumeBase
    const todayVolumes = active.map((item) => item.volume)
    const ratio = mean(todayVolumes) > 0 ? 1 : 1
    // Volume ratio uses the raw bars below; placeholder replaced after the loop body collects it.
    const trendScore = clamp((coverage / 0.45) * 100)
    const volScore = ctaVolScore(volPct)
    const score = weightedScore([
      { score: trendScore, weight: 0.7 },
      { score: volScore, weight: 0.15 },
      { score: 50, weight: 0.15 },
    ])
    if (score == null) continue
    points.push({
      date,
      score,
      trending,
      active: active.length,
      coverage,
      vol: vol * 100,
      volPct,
      volumeRatio: ratio,
    })
  }
  // Rebuild volume ratios properly. The loop above could not see prior-day totals without extra state.
  applyCtaVolume(points, series)
  return packStrategy("cta", "商品CTA", "商品", points, (last) => ({
    rating: `${last.trending}/${last.active} 走趋势`,
    headline: `${last.trending}/${last.active} 个品种走出趋势，波动分位 ${last.volPct.toFixed(0)}`,
    factors: [
      { key: "trend", label: "趋势覆盖", score: round1(clamp((last.coverage / 0.45) * 100)), weight: 0.7, detail: `${last.active} 个活跃品种里 ${last.trending} 个走趋势，占 ${(last.coverage * 100).toFixed(1)}%` },
      { key: "vol", label: "波动水位", score: round1(ctaVolScore(last.volPct)), weight: 0.15, detail: `20 日平均日波动 ${last.vol.toFixed(2)}%，60 日分位 ${last.volPct.toFixed(0)}。太低没行情，太高容易来回打脸` },
      { key: "volume", label: "成交比", score: round1(clamp(((last.volumeRatio - 0.5) / 1) * 100)), weight: 0.15, detail: `活跃品种成交量相对近 20 日为 ${last.volumeRatio.toFixed(2)} 倍` },
    ],
    notes: [
      `${last.active} 个有成交的商品主力里，${last.trending} 个近 20 日方向清楚（效率至少 0.25，且累计涨跌超过 3%），覆盖面 ${(last.coverage * 100).toFixed(1)}%。`,
      `这批品种的 20 日平均日波动是 ${last.vol.toFixed(2)}%，处在近 60 日的 ${last.volPct.toFixed(0)} 分位。${last.coverage < 0.2 ? "趋势品种不到两成，能顺着做的合约不多。" : "趋势覆盖还够用。"}`,
      "换月日涨跌超过 8% 的跳空已从路径里拿掉，避免连续合约换月被看成趋势。",
    ],
  }))
}

function ctaVolScore(volPct: number): number {
  return clamp(100 - Math.abs(volPct - 60) * 0.9)
}

function applyCtaVolume(points: Scored<{ volumeRatio: number; trending: number; active: number; coverage: number; vol: number; volPct: number }>[], series: Map<string, ProdSeries>) {
  const totals: number[] = []
  for (const point of points) {
    let total = 0
    let count = 0
    for (const product of series.values()) {
      const index = product.dates.lastIndexOf(point.date)
      if (index < 0) continue
      total += product.volume[index]
      count += 1
    }
    totals.push(count ? total : 0)
  }
  points.forEach((point, index) => {
    const prior = totals.slice(Math.max(0, index - 20), index).filter((value) => value > 0)
    const base = prior.length ? mean(prior) : 0
    point.volumeRatio = base > 0 ? totals[index] / base : 1
    const volumeScore = clamp(((point.volumeRatio - 0.5) / 1) * 100)
    const trendScore = clamp((point.coverage / 0.45) * 100)
    const volScore = ctaVolScore(point.volPct)
    const score = weightedScore([
      { score: trendScore, weight: 0.7 },
      { score: volScore, weight: 0.15 },
      { score: volumeScore, weight: 0.15 },
    ])
    if (score != null) point.score = score
  })
}

function buildCb(indexes: Map<string, IndexDay[]>): EnvStrategy {
  const rows = indexes.get("000832.SH") ?? []
  if (rows.length < 30) {
    return emptyStrategy("cb", "转债指增", "债券", "库里没有中证转债指数行情，转债环境先空着。个券债底、溢价和 Delta 目前也没有日频数据。")
  }
  const points: Scored<{
    ret20: number
    retPct: number
    levelPct: number
    volPct: number
    activity: number | null
    activityPct: number | null
  }>[] = []
  const retHist: number[] = []
  const vols: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (i < 20) continue
    const ret20 = rows[i].close / rows[i - 20].close - 1
    const rets: number[] = []
    for (let k = i - 19; k <= i; k++) rets.push(rows[k].close / rows[k - 1].close - 1)
    const vol = Math.sqrt(variance(rets))
    vols.push(vol)
    const levelWindow = rows.slice(Math.max(0, i - 249), i + 1).map((row) => row.close)
    const levelPct = pctRank(levelWindow, rows[i].close)
    retHist.push(ret20)
    const retPct = pctRank(retHist.slice(-PCT_WINDOW), ret20)
    const volPct = pctRank(vols.slice(-PCT_WINDOW), vol)
    let activity: number | null = null
    let activityPct: number | null = null
    if (rows[i].amount != null && rows[i].amount > 0) {
      const recent = rows.slice(Math.max(0, i - 19), i + 1).map((row) => row.amount).filter((value): value is number => value != null && value > 0)
      const base = recent.length >= 5 ? mean(recent.slice(0, -1)) : 0
      if (base > 0) {
        activity = rows[i].amount / base
        const ratios: number[] = []
        for (let k = 20; k <= i; k++) {
          const past = rows.slice(Math.max(0, k - 19), k).map((row) => row.amount).filter((value): value is number => value != null && value > 0)
          const pastBase = past.length ? mean(past) : 0
          if (pastBase > 0 && rows[k].amount != null) ratios.push(rows[k].amount / pastBase)
        }
        activityPct = pctRank(ratios.slice(-PCT_WINDOW), activity)
      }
    }
    const score = weightedScore([
      { score: retPct, weight: 0.4 },
      { score: 100 - levelPct, weight: 0.25 },
      { score: clamp(100 - Math.abs(volPct - 60) * 1.3), weight: 0.2 },
      activityPct == null ? null : { score: activityPct, weight: 0.15 },
    ])
    if (score == null) continue
    points.push({ date: rows[i].date, score: oppose(score), ret20: ret20 * 100, retPct, levelPct, volPct, activity, activityPct })
  }
  return packStrategy("cb", "转债指增", "债券", points, (last) => ({
    rating: bandRating(last.score),
    headline: last.activity == null
        ? `中证转债 20 日 ${last.ret20 >= 0 ? "+" : ""}${last.ret20.toFixed(2)}%，${last.levelPct < 2 ? "点位在近一年低位" : `位置分位 ${last.levelPct.toFixed(0)}`}`
      : `${last.levelPct < 2 ? "指数在近一年低位" : `指数位置分位 ${last.levelPct.toFixed(0)}`}，成交是均量的 ${last.activity.toFixed(2)} 倍`,
    factors: [
      { key: "trend", label: "指数动量", score: round1(last.retPct), weight: 0.4, detail: `中证转债 20 日收益 ${last.ret20 >= 0 ? "+" : ""}${last.ret20.toFixed(2)}%，分位 ${last.retPct.toFixed(0)}` },
      { key: "level", label: "指数位置", score: round1(100 - last.levelPct), weight: 0.25, detail: last.levelPct < 2 ? "点位在近一年最低附近，债性保护通常更厚" : `指数点位处于近一年 ${last.levelPct.toFixed(0)} 分位。位置越低，债性保护通常越厚` },
      { key: "vol", label: "波动水位", score: round1(clamp(100 - Math.abs(last.volPct - 60) * 1.3)), weight: 0.2, detail: `20 日波动分位 ${last.volPct.toFixed(0)}` },
      last.activityPct == null ? null : {
        key: "activity",
        label: "成交活跃",
        score: round1(last.activityPct),
        weight: 0.15,
        detail: `成交额相对近 20 日为 ${last.activity?.toFixed(2)} 倍，分位 ${last.activityPct.toFixed(0)}`,
      },
    ].filter((factor): factor is EnvFactor => factor != null),
    notes: [
      "这里用中证转债指数看环境，不是逐只转债的债底、转股溢价和 Delta。那些个券字段目前没有日频入库。",
      "指数动量越高，原来的分数越高，但近 20 日超额越差。环境分用 100 减这个加权分。",
      `指数 20 日 ${last.ret20 >= 0 ? "上涨" : "下跌"} ${Math.abs(last.ret20).toFixed(2)}%，点位分位 ${last.levelPct.toFixed(0)}。指增要的是还有价差、同时成交没有枯掉。`,
    ],
  }))
}

type DomBar = {
  date: string
  contract: string
  open: number
  high: number
  low: number
  close: number
  days: number
  basis: number | null
  backBasis: number | null
}

function expiryDays(contract: string, date: string): number | null {
  return calendarDaysToCffexExpiry(contract, new Date(`${date}T04:00:00Z`))
}

function spotOn(
  product: (typeof INDEX_PRODUCTS)[number],
  date: string,
  spots: Map<string, Map<string, number>>,
  indexes: Map<string, IndexDay[]>,
): number | null {
  const direct = spots.get(product)?.get(date)
  if (direct != null && direct > 0) return direct
  const index = indexes.get(SPOT_INDEX[product])
  if (!index) return null
  for (let i = index.length - 1; i >= 0; i--) {
    if (index[i].date <= date && index[i].close > 0) return index[i].close
  }
  return null
}

function dominantBooks(
  contracts: ContractRow[],
  spots: Map<string, Map<string, number>>,
  indexes: Map<string, IndexDay[]>,
): Map<string, DomBar[]> {
  const grouped = new Map<string, ContractRow[]>()
  for (const row of contracts) {
    const product = row.contract.replace(/[0-9].*$/, "")
    const list = grouped.get(`${row.date}|${product}`) ?? []
    list.push(row)
    grouped.set(`${row.date}|${product}`, list)
  }
  const out = new Map<string, DomBar[]>()
  for (const product of INDEX_PRODUCTS) {
    const dates = [...new Set(contracts.filter((row) => row.contract.startsWith(product)).map((row) => row.date))].sort()
    const bars: DomBar[] = []
    for (const date of dates) {
      const book = (grouped.get(`${date}|${product}`) ?? [])
        .map((row) => ({ ...row, days: expiryDays(row.contract, date) }))
        .filter((row) => row.days != null && row.days >= 2 && row.days <= 220)
        .sort((a, b) => b.oi - a.oi)
      const front = book[0]
      const back = book[1]
      if (!front || front.days == null) continue
      const spot = spotOn(product, date, spots, indexes)
      const basis = spot != null ? annualizedBasisPct(front.close, spot, front.days) : null
      const backBasis = back && back.days != null && spot != null
        ? annualizedBasisPct(back.close, spot, back.days)
        : null
      bars.push({
        date,
        contract: front.contract,
        open: front.open,
        high: front.high,
        low: front.low,
        close: front.close,
        days: front.days,
        basis,
        backBasis,
      })
    }
    out.set(product, bars)
  }
  return out
}

function buildArb(books: Map<string, DomBar[]>, commodities: Map<string, CommodityBar[]>): EnvStrategy {
  const ctaDates = [...new Set([...commodities.values()].flatMap((bars) => bars.map((bar) => bar.date)))].sort()
  const series = commoditySeries(commodities)
  const dispersionByDate = new Map<string, number>()
  for (const date of ctaDates) {
    const nets: number[] = []
    for (const product of series.values()) {
      const window = retsEnding(product, date, 20)
      if (!window || window.rets.length < 15) continue
      nets.push(window.rets.reduce((sum, value) => sum + value, 0))
    }
    if (nets.length >= 15) dispersionByDate.set(date, Math.sqrt(variance(nets)) * 100)
  }
  const ifBars = books.get("IM") ?? books.get("IF") ?? []
  const slopeHist: number[] = []
  const basisHist: number[] = []
  const dispHist: number[] = []
  const volHist: number[] = []
  const points: Scored<{
    slope: number
    slopePct: number
    basis: number
    basisPct: number
    dispersion: number
    dispersionPct: number
    volPct: number
  }>[] = []
  const dates = [...new Set(INDEX_PRODUCTS.flatMap((product) => (books.get(product) ?? []).map((bar) => bar.date)))].sort()
  for (const date of dates) {
    const slopes: number[] = []
    const bases: number[] = []
    for (const product of INDEX_PRODUCTS) {
      const bar = (books.get(product) ?? []).find((item) => item.date === date)
      if (!bar) continue
      if (bar.basis != null) bases.push(Math.abs(bar.basis))
      if (bar.basis != null && bar.backBasis != null) slopes.push(Math.abs(bar.backBasis - bar.basis))
    }
    if (bases.length < 2 || slopes.length < 2) continue
    const slope = mean(slopes)
    const basis = mean(bases)
    slopeHist.push(slope)
    basisHist.push(basis)
    const dispersion = dispersionByDate.get(date)
    if (dispersion != null) dispHist.push(dispersion)
    const volWindow = ifBars.filter((bar) => bar.date <= date).slice(-21)
    let vol: number | null = null
    if (volWindow.length >= 16) {
      const rets: number[] = []
      for (let i = 1; i < volWindow.length; i++) {
        if (volWindow[i].contract !== volWindow[i - 1].contract) continue
        rets.push(volWindow[i].close / volWindow[i - 1].close - 1)
      }
      if (rets.length >= 12) vol = Math.sqrt(variance(rets)) * 100
    }
    if (vol != null) volHist.push(vol)
    if (slopeHist.length < 20 || dispHist.length < 15 || volHist.length < 15) continue
    const slopePct = pctRank(slopeHist.slice(-PCT_WINDOW), slope)
    const basisPct = pctRank(basisHist.slice(-PCT_WINDOW), basis)
    const dispersionPct = dispersion == null ? null : pctRank(dispHist.slice(-PCT_WINDOW), dispersion)
    const volPct = vol == null ? null : pctRank(volHist.slice(-PCT_WINDOW), vol)
    const score = weightedScore([
      { score: slopePct, weight: 0.3 },
      { score: basisPct, weight: 0.25 },
      dispersionPct == null ? null : { score: dispersionPct, weight: 0.3 },
      volPct == null ? null : { score: volPct, weight: 0.15 },
    ])
    if (score == null || dispersionPct == null || volPct == null || dispersion == null) continue
    points.push({ date, score: oppose(score), slope, slopePct, basis, basisPct, dispersion, dispersionPct, volPct })
  }
  return packStrategy("arb", "套利", "衍生品", points, (last) => {
    const rating = last.score >= 58 ? "环境偏好" : last.score >= 48 ? "中性" : "机会偏少"
    const factors: EnvFactor[] = [
      { key: "calendar", label: "跨期结构", score: round1(last.slopePct), weight: 0.3, detail: `股指远近月年化基差差 ${last.slope.toFixed(2)} 个百分点，分位 ${last.slopePct.toFixed(0)}` },
      { key: "basis", label: "期现基差", score: round1(last.basisPct), weight: 0.25, detail: `四个股指主力年化基差绝对值平均 ${last.basis.toFixed(2)}%，分位 ${last.basisPct.toFixed(0)}` },
      { key: "cross", label: "跨品种价差", score: round1(last.dispersionPct), weight: 0.3, detail: `商品 20 日收益标准差 ${last.dispersion.toFixed(2)} 个百分点，分位 ${last.dispersionPct.toFixed(0)}` },
      { key: "vol", label: "波动率", score: round1(last.volPct), weight: 0.15, detail: `中证1000主力 20 日波动分位 ${last.volPct.toFixed(0)}。分位低时这一维几乎不贡献` },
    ]
    const contrib = factors.map((factor) => `${factor.label} ${factor.score.toFixed(1)}（贡献 ${(factor.score * (factor.weight ?? 0)).toFixed(1)}）`).join("，")
    return {
      rating,
      headline: `跨期分位 ${last.slopePct.toFixed(0)}，期现分位 ${last.basisPct.toFixed(0)}，跨品种分位 ${last.dispersionPct.toFixed(0)}`,
      factors,
      notes: [
        `四维权重沿用跨期 30%、期现 25%、跨品种 30%、波动率 15%。${contrib}。`,
        last.volPct < 35
          ? "波动率这一维偏低，价差机会主要靠期限结构和品种之间的分化，不靠波动本身。"
          : "波动率还在给价差提供活动空间。",
        "期现和跨期只覆盖 IH / IF / IC / IM 的持仓量最大两档合约。到期不足两天的合约不参与，避免分母把年化基差放大失真。",
        "价差和波动的分位越高，原来的分数越高，但近 20 日超额越差。环境分用 100 减这个加权分。",
      ],
    }
  })
}

type OptionName = {
  key: string
  label: string
  sector: string
  iv: number
  pct: number
  samples: number
}

function optionSeries(points: IvPoint[]): Map<string, { dates: string[]; iv: number[] }> {
  const buckets = new Map<string, Array<{ date: string; iv: number }>>()
  for (const point of points) {
    const list = buckets.get(point.key) ?? []
    list.push({ date: point.date, iv: point.iv })
    buckets.set(point.key, list)
  }
  const out = new Map<string, { dates: string[]; iv: number[] }>()
  for (const [key, rows] of buckets) {
    rows.sort((a, b) => a.date.localeCompare(b.date))
    out.set(key, { dates: rows.map((row) => row.date), iv: rows.map((row) => row.iv) })
  }
  return out
}

function volumeBook(
  commodities: Map<string, CommodityBar[]>,
  indexes: Map<string, IndexDay[]>,
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const [product, bars] of commodities) {
    const book = new Map<string, number>()
    for (const bar of bars) if (bar.volume > 0) book.set(bar.date, bar.volume)
    out.set(product, rollingPercentile(book))
  }
  for (const [code, rows] of indexes) {
    const book = new Map<string, number>()
    for (const row of rows) if (row.amount != null && row.amount > 0) book.set(row.date, row.amount)
    out.set(code, rollingPercentile(book))
  }
  return out
}

function rollingPercentile(book: Map<string, number>): Map<string, number> {
  const dates = [...book.keys()].sort()
  const values = dates.map((date) => book.get(date) ?? 0)
  const out = new Map<string, number>()
  for (let i = 19; i < dates.length; i++) {
    const start = Math.max(0, i + 1 - PCT_WINDOW)
    out.set(dates[i], pctRank(values.slice(start, i + 1), values[i]))
  }
  return out
}

/** Share of variance on the first principal component, in percent. */
function pc1Share(columns: number[][]): number | null {
  const p = columns.length
  const n = columns[0]?.length ?? 0
  if (p < 8 || n < 20) return null
  const center = columns.map((col) => mean(col))
  const cov: number[][] = Array.from({ length: p }, () => Array(p).fill(0))
  for (let t = 0; t < n; t++) {
    for (let a = 0; a < p; a++) {
      const da = columns[a][t] - center[a]
      for (let b = a; b < p; b++) {
        const value = da * (columns[b][t] - center[b])
        cov[a][b] += value
        if (a !== b) cov[b][a] += value
      }
    }
  }
  let trace = 0
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      cov[a][b] /= n - 1
      if (a !== b) cov[b][a] = cov[a][b]
    }
    trace += cov[a][a]
  }
  if (!(trace > 0)) return null
  let vector = Array.from({ length: p }, () => 1 / Math.sqrt(p))
  let lambda = 0
  for (let iter = 0; iter < 48; iter++) {
    const next = Array(p).fill(0)
    for (let a = 0; a < p; a++) {
      for (let b = 0; b < p; b++) next[a] += cov[a][b] * vector[b]
    }
    const norm = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0))
    if (!(norm > 0)) return null
    vector = next.map((value) => value / norm)
    lambda = 0
    for (let a = 0; a < p; a++) {
      let row = 0
      for (let b = 0; b < p; b++) row += cov[a][b] * vector[b]
      lambda += vector[a] * row
    }
  }
  return (lambda / trace) * 100
}

function commodityPc1(commodities: Map<string, CommodityBar[]>, date: string): number | null {
  const byProduct = new Map<string, Map<string, number>>()
  const dateSet = new Set<string>()
  for (const [product, bars] of commodities) {
    if (!COMMODITY_OPTION_SECTOR[product.toLowerCase()]) continue
    const index = bars.findIndex((bar) => bar.date === date)
    if (index < 25) continue
    const rets = new Map<string, number>()
    for (let i = Math.max(1, index - 55); i <= index; i++) {
      const prev = bars[i - 1].close
      if (!(prev > 0)) continue
      const change = bars[i].close / prev - 1
      if (Math.abs(change) > 0.08) continue
      rets.set(bars[i].date, change)
      dateSet.add(bars[i].date)
    }
    if (rets.size >= 20) byProduct.set(product, rets)
  }
  const dates = [...dateSet].sort().slice(-40)
  if (dates.length < 20) return null
  const columns: number[][] = []
  for (const rets of byProduct.values()) {
    if (dates.every((item) => rets.has(item))) columns.push(dates.map((item) => rets.get(item) ?? 0))
  }
  return pc1Share(columns)
}

function buildOption(
  points: IvPoint[],
  commodityPoints: IvPoint[],
  commodities: Map<string, CommodityBar[]>,
  indexes: Map<string, IndexDay[]>,
): EnvStrategy {
  const books = optionSeries([...points, ...commodityPoints])
  const chosen: Array<{ key: string; label: string; sector: string; dates: string[]; iv: number[] }> = []
  for (const item of OPTION_KEYS) {
    const primary = books.get(item.key)
    const fallback = books.get(item.fallback)
    const series = primary && primary.iv.length >= 60 ? primary : fallback
    if (!series || series.iv.length < 60) continue
    chosen.push({ key: item.key, label: item.label, sector: item.sector, dates: series.dates, iv: series.iv })
  }
  for (const [key, sector] of Object.entries(COMMODITY_OPTION_SECTOR)) {
    const series = books.get(key)
    if (!series || series.iv.length < 60) continue
    chosen.push({
      key,
      label: UNDERLYING_CN_LABELS[key] ?? key.toUpperCase(),
      sector,
      dates: series.dates,
      iv: series.iv,
    })
  }
  if (chosen.length < 6) {
    return emptyStrategy("option-sell", "期权卖权", "衍生品", "隐含波动率序列不足，卖权环境先空着。")
  }
  const activity = volumeBook(commodities, indexes)
  const byDate = new Map<string, OptionName[]>()
  const liqByDate = new Map<string, number[]>()
  for (const item of chosen) {
    const volumeKey = COMMODITY_OPTION_SECTOR[item.key] ? item.key.toUpperCase() : EQUITY_AMOUNT[item.key]
    const volume = volumeKey ? activity.get(volumeKey) : undefined
    for (let index = 59; index < item.iv.length; index++) {
      const date = item.dates[index]
      const window = item.iv.slice(Math.max(0, index - 251), index + 1)
      const list = byDate.get(date) ?? []
      list.push({
        key: item.key,
        label: item.label,
        sector: item.sector,
        iv: item.iv[index],
        pct: pctRank(window, item.iv[index]),
        samples: window.length,
      })
      byDate.set(date, list)
      const volPct = volume?.get(date)
      if (volPct != null) {
        const bucket = liqByDate.get(date) ?? []
        bucket.push(volPct)
        liqByDate.set(date, bucket)
      }
    }
  }
  const scored: Scored<{ names: OptionName[]; liq: number | null }>[] = []
  for (const [date, names] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (names.length < 6) continue
    let score = mean(names.map((item) => item.pct))
    if (score > 82) score = 82 + (score - 82) * 0.5
    const liqBucket = liqByDate.get(date) ?? []
    const liq = liqBucket.length >= 8 ? mean(liqBucket) : null
    scored.push({ date, score: round1(score), names, liq })
  }
  return packStrategy("option-sell", "期权卖权", "衍生品", scored, (last) => {
    const ranked = [...last.names].sort((a, b) => b.pct - a.pct)
    const rich = ranked.filter((item) => item.pct >= 65)
    const sectors = new Set(rich.map((item) => item.sector))
    const local = rich.length > 0 && rich.length / last.names.length < 0.25
    const pc1 = commodityPc1(commodities, last.date)
    const composite = last.liq == null ? null : round1(last.score * 0.7 + last.liq * 0.3)
    const timing = last.score >= 70 && !local
      ? "可卖"
      : last.score < 45
        ? "偏薄"
        : local || (pc1 != null && pc1 >= 35)
          ? "观望"
          : "中性"
    const rating = last.score >= 70 && !local
      ? "可卖"
      : local
        ? "中性，观望"
        : last.score >= 55
          ? "局部可做，谨慎参与"
          : last.score >= 45
            ? "中性"
            : "权利金偏薄"
    const top = ranked.slice(0, 3).map((item) => `${item.label} ${item.pct.toFixed(0)}分`)
    const shown = ranked.filter((item) => item.pct >= 65).slice(0, 8)
    const leaders = shown.length >= 3 ? shown : ranked.slice(0, 3)
    const equitySamples = last.names.filter((item) => item.sector === "股指")
    const commoditySamples = last.names.filter((item) => item.sector !== "股指")
    const sectorOrder = ["股指", "农产品", "黑色", "有色", "能化"]
    const sectorLine = sectorOrder.flatMap((sector) => {
      const items = last.names.filter((item) => item.sector === sector)
      if (!items.length) return []
      const best = [...items].sort((a, b) => b.pct - a.pct)[0]
      return [`${sector} ${mean(items.map((item) => item.pct)).toFixed(0)}（最高 ${best.label} ${best.pct.toFixed(0)}）`]
    }).join("，")
    return {
      rating,
      headline: rich.length
        ? `可卖 ${rich.length}/${last.names.length}，覆盖 ${sectors.size} 个板块，最高 ${top.join("、")}`
        : `${last.names.length} 个品种的隐含波动都不算厚`,
      factors: [
        {
          key: "book",
          label: "全市场隐波",
          score: last.score,
          detail: `${last.names.length} 个品种等权。股指用近 ${equitySamples.length ? Math.round(mean(equitySamples.map((item) => item.samples))) : "—"} 个交易日，商品期权用近 ${commoditySamples.length ? Math.round(mean(commoditySamples.map((item) => item.samples))) : "—"} 个交易日`,
        },
        last.liq == null ? null : {
          key: "liq",
          label: "流动性",
          score: round1(last.liq),
          detail: "每个品种当天成交相对自己近 60 日的分位，再取平均。商品用主力成交量，股指用对应指数成交额",
        },
        ...leaders.map((item) => ({
          key: `px:${item.key}`,
          label: item.label,
          score: round1(item.pct),
          detail: `${item.sector}，IV ${item.iv.toFixed(2)}，样本 ${item.samples} 天，分位 ${item.pct.toFixed(0)}`,
        })),
      ].filter((factor): factor is EnvFactor => factor != null),
      notes: [
        `可卖品种 ${rich.length} 个，覆盖 ${sectors.size} 个板块。分位不低于 65 的有 ${rich.slice(0, 8).map((item) => `${item.label} ${item.pct.toFixed(0)}`).join("、") || "没有"}。`,
        last.liq == null
          ? "流动性序列不够，综合分先只看隐波。"
          : `全市场隐波分位 ${last.score.toFixed(1)}，流动性分位 ${last.liq.toFixed(1)}，综合分 ${composite?.toFixed(1)}（隐波 70%，流动性 30%）。择时信号${timing}。`,
        pc1 == null
          ? "商品收益还排不齐，第一主成分先不算。"
          : `商品近 40 日收益的第一主成分解释 ${pc1.toFixed(1)}% 的波动。${pc1 >= 35 ? "品种在同一方向上走，卖权的尾部更集中。" : "这是温和趋势：共同方向不强，权利金厚薄更多是品种自己的事。"}`,
        sectorLine ? `板块平均分位：${sectorLine}。` : "",
        local
          ? "权利金偏厚只出现在少数品种上，没有铺满全市场。"
          : rich.length
            ? "偏厚的品种已经不止一处，卖权可以多看几个板块。"
            : "没有品种的分位达到 65，收到的权利金偏薄。",
        "股指这边是 50ETF、300ETF、500ETF、中证1000、创业板、科创50。商品期权用库里的平值隐波；这段历史从 2026 年中才开始，分位是这段样本里的位置。",
      ].filter((line) => line.length > 0),
    }
  })
}

function pathStats(bars: DomBar[]) {
  const ret: Array<number | null> = [null]
  const amp: number[] = []
  const efficiency: number[] = []
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const span = bar.high - bar.low
    amp.push(bar.open > 0 ? (span / bar.open) * 100 : 0)
    efficiency.push(span > 0 ? (Math.abs(bar.close - bar.open) / span) * 100 : 0)
    if (i === 0) continue
    const prev = bars[i - 1]
    ret.push(prev.contract === bar.contract && prev.close > 0 ? bar.close / prev.close - 1 : null)
  }
  return { ret, amp, efficiency }
}

function rollingAvg(values: number[], index: number, size: number): number | null {
  if (index < size - 1) return null
  return mean(values.slice(index - size + 1, index + 1))
}

function buildIntraday(books: Map<string, DomBar[]>): EnvStrategy {
  const prepared = INDEX_PRODUCTS.map((product) => {
    const bars = books.get(product) ?? []
    return { product, bars, ...pathStats(bars) }
  }).filter((item) => item.bars.length >= 30)
  if (!prepared.length) return emptyStrategy("intraday", "股指多空日内", "衍生品", "没有股指主力合约的日 K，日内环境先空着。")
  const anchor = prepared.find((item) => item.product === "IM") ?? prepared[0]
  const ampMeans: number[] = []
  const points: Scored<{ amp: number; ampPct: number; er: number; byProduct: string }>[] = []
  for (let i = 0; i < anchor.bars.length; i++) {
    const date = anchor.bars[i].date
    const amps: number[] = []
    const ers: number[] = []
    const bits: string[] = []
    for (const item of prepared) {
      const index = item.bars.findIndex((bar) => bar.date === date)
      if (index < 4) continue
      const amp = rollingAvg(item.amp, index, 5)
      const er = rollingAvg(item.efficiency, index, 5)
      if (amp == null || er == null) continue
      amps.push(amp)
      ers.push(er)
      bits.push(`${item.product} ${amp.toFixed(2)}%`)
    }
    if (amps.length < 2) continue
    const amp = mean(amps)
    const er = mean(ers)
    ampMeans.push(amp)
    if (ampMeans.length < 20) continue
    const ampPct = pctRank(ampMeans.slice(-PCT_WINDOW), amp)
    const erScore = clamp(((er - 8) / 32) * 100)
    const score = weightedScore([
      { score: ampPct, weight: 0.7 },
      { score: erScore, weight: 0.3 },
    ])
    if (score == null) continue
    points.push({ date, score: oppose(score), amp, ampPct, er, byProduct: bits.join("，") })
  }
  return packStrategy("intraday", "股指多空日内", "衍生品", points, (last) => {
    const rating = bandRating(last.score)
    return {
      rating,
      headline: `近 5 日平均振幅 ${last.amp.toFixed(2)}%，实体占振幅 ${last.er.toFixed(0)}`,
      factors: [
        { key: "amp", label: "日内振幅", score: round1(last.ampPct), weight: 0.7, detail: `IH/IF/IC/IM 近 5 日平均振幅 ${last.amp.toFixed(2)}%，分位 ${last.ampPct.toFixed(0)}` },
        { key: "er", label: "实体效率", score: round1(clamp(((last.er - 8) / 32) * 100)), weight: 0.3, detail: `收盘相对开盘的位移占当天振幅 ${last.er.toFixed(1)}%。过低说明盘中在来回锯` },
      ],
      notes: [
        `四个股指主力近 5 日振幅：${last.byProduct}。平均 ${last.amp.toFixed(2)}%。`,
        last.er < 12
          ? "振幅里的净位移很小，盘中有波动也容易来回扫，方向单不好拿。"
          : "盘中不是死水，价格能顺着一个方向拉开一段。",
        "这是主力合约日 K 的实体/振幅，不是 5 分钟路径，所以没有计算分钟级别的方差比。",
        "振幅和实体效率越高，原来的分数越高，但近 20 日超额越差。环境分用 100 减这个加权分。",
      ],
    }
  })
}

function validRets(ret: Array<number | null>, end: number, size: number): number[] {
  const out: number[] = []
  for (let i = end; i >= 0 && out.length < size; i--) {
    const value = ret[i]
    if (value != null) out.push(value)
  }
  return out.reverse()
}

function maxRun(values: number[]): number {
  let best = 0
  let run = 0
  let prev = 0
  for (const value of values) {
    const sign = Math.sign(value)
    if (sign === 0) {
      run = 0
      prev = 0
      continue
    }
    run = sign === prev ? run + 1 : 1
    prev = sign
    if (run > best) best = run
  }
  return best
}

function buildSwing(books: Map<string, DomBar[]>): EnvStrategy {
  const bars = books.get("IM") ?? []
  if (bars.length < 40) return emptyStrategy("swing", "股指多空日间", "衍生品", "中证1000主力日 K 不够，日间环境先空着。")
  const { ret, amp } = pathStats(bars)
  const points: Scored<{
    pathEff: number
    vr4: number
    ac1: number
    run: number
    overnightShare: number
    contRate: number
    corr: number | null
    tStat: number | null
    n: number
    ampPct: number
  }>[] = []
  const ampMeans: number[] = []
  for (let i = 0; i < bars.length; i++) {
    const recent = validRets(ret, i, 20)
    const longer = validRets(ret, i, 120)
    if (recent.length < 15 || longer.length < 40) continue
    const path = recent.reduce((sum, value) => sum + Math.abs(value), 0)
    const pathEff = path > 1e-9 ? (Math.abs(recent.reduce((sum, value) => sum + value, 0)) / path) * 100 : 0
    const vr4 = variance(longer) > 0 ? varianceRatio(longer, 4) : null
    const lag = correlation(longer.slice(0, -1), longer.slice(1))
    if (vr4 == null || lag == null) continue
    const links = overnightLinks(bars, i, 120)
    const ampAvg = rollingAvg(amp, i, 5)
    if (ampAvg == null || links.n < 20) continue
    ampMeans.push(ampAvg)
    if (ampMeans.length < 15) continue
    const ampPct = pctRank(ampMeans.slice(-PCT_WINDOW), ampAvg)
    const trendScore = clamp((pathEff / 40) * 100)
    const revertScore = clamp((-lag) * 250 + (1 - vr4) * 70)
    const structure = Math.max(trendScore, revertScore)
    const corrEdge = links.corr == null ? 0 : clamp(Math.abs(links.corr) * 180)
    const score = weightedScore([
      { score: ampPct, weight: 0.35 },
      { score: structure, weight: 0.5 },
      { score: corrEdge, weight: 0.15 },
    ])
    if (score == null) continue
    points.push({
      date: bars[i].date,
      score: oppose(score),
      pathEff,
      vr4,
      ac1: lag,
      run: maxRun(recent),
      overnightShare: links.share * 100,
      contRate: links.cont * 100,
      corr: links.corr,
      tStat: links.corr == null ? null : tStatOfCorr(links.corr, links.n),
      n: links.n,
      ampPct,
    })
  }
  return packStrategy("swing", "股指多空日间", "衍生品", points, (last) => {
    const trendScore = clamp((last.pathEff / 40) * 100)
    const revertScore = clamp((-last.ac1) * 250 + (1 - last.vr4) * 70)
    const reverting = last.ac1 < -0.1 || last.vr4 < 0.85
    const rating = last.pathEff >= 30 && trendScore >= revertScore
      ? "趋势段"
      : last.pathEff < 28 && reverting
        ? "来回磨，偏反转"
        : last.pathEff < 28
          ? "来回磨"
          : last.score >= 64
            ? "良（可做）"
            : last.score >= 50
              ? "中性"
              : "谨慎"
    const corrText = last.corr == null
      ? "隔夜衔接样本不足"
      : `隔夜衔接相关 ${last.corr.toFixed(3)}${last.tStat == null ? "" : `（t=${last.tStat.toFixed(2)}，n=${last.n}）`}`
    return {
      rating,
      headline: last.pathEff >= 30
        ? `20 日走出来的净距离占路程 ${last.pathEff.toFixed(1)}%，偏趋势`
        : `20 日净距离只占路程 ${last.pathEff.toFixed(1)}%，日线还在磨`,
      factors: [
        { key: "path", label: "路径效率", score: round1(trendScore), detail: `近 20 日 |净涨跌| / 路程 = ${last.pathEff.toFixed(1)}%。30 以上才像一段顺势` },
        { key: "revert", label: "反转结构", score: round1(revertScore), detail: `日收益自相关 ${last.ac1.toFixed(3)}，4 日方差比 ${last.vr4.toFixed(2)}。小于 1 偏均值回归` },
        { key: "amp", label: "日间振幅", score: round1(last.ampPct), weight: 0.35, detail: `近 5 日振幅分位 ${last.ampPct.toFixed(0)}` },
        { key: "overnight", label: "隔夜", score: round1(last.corr == null ? 0 : clamp(Math.abs(last.corr) * 180)), weight: 0.15, detail: `涨跌里约 ${last.overnightShare.toFixed(0)}% 发生在收盘到次日开盘。同向衔接 ${last.contRate.toFixed(0)}%` },
      ],
      notes: [
        `放到中证1000主力的日线上看，近 20 日净距离只占折腾路程的 ${last.pathEff.toFixed(1)}%，最长连续同向 ${last.run} 天。`,
        `方差比 VR4 = ${last.vr4.toFixed(2)}，日收益自相关 ${last.ac1.toFixed(3)}。${reverting ? "隔日容易走反，趋势单会被来回抹平。" : "还没有强到每天都反向，但也没有走出单边。"}`,
        `白天涨跌和下一跳隔夜：同向比例 ${last.contRate.toFixed(1)}%，${corrText}。换月当天的跳空不计入。`,
        "振幅和结构越清楚，原来的分数越高，但近 20 日超额越差。环境分用 100 减这个加权分。",
      ],
    }
  })
}

function varianceRatio(rets: number[], k: number): number | null {
  const base = variance(rets)
  if (!(base > 0) || rets.length < k * 4) return null
  const rolled: number[] = []
  for (let i = k - 1; i < rets.length; i++) {
    let sum = 0
    for (let j = 0; j < k; j++) sum += rets[i - j]
    rolled.push(sum)
  }
  return variance(rolled) / (k * base)
}

function overnightLinks(bars: DomBar[], end: number, size: number): { share: number; cont: number; corr: number | null; n: number } {
  const dayMoves: number[] = []
  const gaps: number[] = []
  let gapAbs = 0
  let dayAbs = 0
  let same = 0
  let paired = 0
  for (let i = Math.max(1, end - size); i <= end; i++) {
    const prev = bars[i - 1]
    const bar = bars[i]
    if (prev.contract !== bar.contract) continue
    const gap = bar.open - prev.close
    const day = prev.close - prev.open
    gapAbs += Math.abs(gap)
    dayAbs += Math.abs(bar.close - bar.open)
    if (Math.sign(day) !== 0 && Math.sign(gap) !== 0) {
      paired += 1
      if (Math.sign(day) === Math.sign(gap)) same += 1
      dayMoves.push(day)
      gaps.push(gap)
    }
  }
  const denom = gapAbs + dayAbs
  return {
    share: denom > 0 ? gapAbs / denom : 0,
    cont: paired > 0 ? same / paired : 0.5,
    corr: correlation(dayMoves, gaps),
    n: dayMoves.length,
  }
}

function lastOnOrBefore(dates: string[], date: string): number {
  let lo = 0
  let hi = dates.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid] <= date) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

function fitMarketBeta(
  points: Array<{ date: string; total: number | null }>,
  dates: string[],
  closes: number[],
): number | null {
  const closeOf = (date: string) => {
    const index = lastOnOrBefore(dates, date)
    return index < 0 ? null : closes[index]
  }
  const xs: number[] = []
  const ys: number[] = []
  let prevDate: string | null = null
  let prevTotal: number | null = null
  for (const point of points) {
    if (!(point.total != null && point.total > 0)) continue
    if (prevDate != null && prevTotal != null && point.total !== prevTotal) {
      const start = closeOf(prevDate)
      const end = closeOf(point.date)
      if (start != null && end != null && start > 0 && end > 0) {
        xs.push(end / start - 1)
        ys.push(point.total / prevTotal - 1)
      }
    }
    if (point.total !== prevTotal) {
      prevTotal = point.total
      prevDate = point.date
    }
  }
  if (xs.length < 40) return null
  const mx = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const my = ys.reduce((sum, value) => sum + value, 0) / ys.length
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  if (den < 1e-18) return null
  return num / den
}

async function attachMarketBeta(strategies: EnvStrategy[]): Promise<void> {
  const dates = strategies.flatMap((item) => item.history.map((point) => point.date)).sort()
  const from = dates[0]
  const to = dates[dates.length - 1]
  if (!from || !to) return
  let series: { date: string; value: number }[]
  try {
    const loaded = await loadPrivateFundBenchmarkSeries("IF", shiftIso(from, -40), to)
    series = loaded.data
  } catch (err) {
    console.error("[strategy-environment] 沪深300", err)
    return
  }
  const closeDates = series.map((point) => point.date)
  const closes = series.map((point) => point.value)
  for (const strategy of strategies) {
    const saved = await readStrategySnapshot<{ points?: Array<{ date: string; total: number | null }> }>(`compare:${strategy.key}`)
    strategy.marketBeta = fitMarketBeta(saved?.body?.points ?? [], closeDates, closes)
    strategy.market10 = strategy.history.map((point) => {
      const end = lastOnOrBefore(closeDates, point.date)
      const start = end - 10
      if (end < 0 || start < 0) return null
      const base = closes[start]
      const last = closes[end]
      if (!(base > 0) || !(last > 0)) return null
      return (last / base - 1) * 100
    })
    const headline = headlineFromHistory(strategy)
    if (!headline) continue
    strategy.score = headline.score
    strategy.alphaScore = headline.alphaScore
    strategy.betaScore = headline.betaScore
    strategy.market10d = headline.market10d
    strategy.totalScore = headline.totalScore
    strategy.totalDelta = headline.totalDelta
    strategy.delta5 = headline.delta5
    strategy.compareDate = headline.compareDate
    strategy.tone = headline.tone
    strategy.rating = headline.rating
    strategy.notes = headline.notes
  }
}

function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function hasHistory(item: { history?: Array<unknown> } | null | undefined): boolean {
  return (item?.history?.length ?? 0) > 0
}

/**
 * A timed-out side query used to be saved as an empty sleeve. The page then
 * kept showing that empty card, because it reads the snapshot and does not
 * rescore on open. Keep the last scored sleeve when a rebuild comes back blank.
 */
async function keepScoredStrategies(fresh: StrategyEnvironmentPayload): Promise<StrategyEnvironmentPayload> {
  const stored = await readStrategySnapshot<StrategyEnvironmentPayload>("board")
  const previous = stored?.body?.strategies ?? []
  if (!previous.length) return fresh
  let kept = 0
  const strategies = fresh.strategies.map((item) => {
    if (hasHistory(item)) return item
    const old = previous.find((prev) => prev.key === item.key)
    if (!hasHistory(old)) return item
    kept += 1
    console.warn(`[strategy-environment] ${item.key} came back empty (${item.headline}); kept the stored score`)
    return old as EnvStrategy
  })
  if (!kept) return fresh
  const asOf = strategies.map((item) => item.asOf).filter((item): item is string => !!item).sort().at(-1) ?? fresh.asOf
  return { asOf, strategies }
}

async function compute(): Promise<StrategyEnvironmentPayload> {
  const [stock, limitUps, indexes, futures, spots, commodities, iv, commodityIv, extras] = await Promise.all([
    safe("stock", loadStock, [] as StockDay[]),
    safe("limit-up", loadLimitUps, [] as Array<{ date: string; code: string }>),
    safe("index", loadIndexes, new Map<string, IndexDay[]>()),
    safe("futures", loadFutures, [] as ContractRow[]),
    safe("spots", loadSpots, new Map<string, Map<string, number>>()),
    safe("commodities", loadCommodities, new Map<string, CommodityBar[]>()),
    safe("iv", loadIv, [] as IvPoint[]),
    safe("commodity-iv", loadCommodityIv, [] as IvPoint[]),
    safe("quant-extras", loadQuantExtras, { style: new Map<string, number>(), margin: [] as QuantPrint[] }),
  ])
  const books = dominantBooks(futures, spots, indexes)
  const strategies = [
    stock.length ? buildQuant(stock, extras.margin) : emptyStrategy("quant", "宽基量化", "股票", "A 股日行情不足，宽基环境先空着。"),
    stock.length ? buildSentiment(stock, limitUps) : emptyStrategy("momentum", "强势股", "股票", "A 股日行情不足，强势股环境先空着。"),
    buildCta(commodities),
    buildCb(indexes),
    buildArb(books, commodities),
    buildOption(iv, commodityIv, commodities, indexes),
    buildIntraday(books),
    buildSwing(books),
  ]
  await attachMarketBeta(strategies)
  const asOf = strategies.map((item) => item.asOf).filter((item): item is string => !!item).sort().at(-1) ?? null
  return { asOf, strategies }
}

export async function loadStrategyEnvironment(force = false): Promise<StrategyEnvironmentPayload> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    const stored = await readStrategySnapshot<StrategyEnvironmentPayload>("board")
    if (stored?.body?.strategies?.length && stored.updatedAt > cache.at) {
      cache = { at: Date.now(), data: stored.body }
      return stored.body
    }
    return cache.data
  }
  if (!force) {
    const stored = await readStrategySnapshot<StrategyEnvironmentPayload>("board")
    if (stored?.body?.strategies?.length) {
      cache = { at: Date.now(), data: stored.body }
      return stored.body
    }
  }
  const started = Date.now()
  const data = await keepScoredStrategies(await compute())
  console.info(`[strategy-environment] computed in ${Date.now() - started}ms asOf=${data.asOf ?? "none"}`)
  cache = { at: Date.now(), data }
  try {
    await writeStrategySnapshot("board", data)
  } catch (err) {
    console.error("[strategy-environment] snapshot write", err)
  }
  return data
}
