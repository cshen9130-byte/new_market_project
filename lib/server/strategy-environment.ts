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
  deltaPhrase,
  emptyStrategy,
  mean,
  pctRank,
  round1,
  tStatOfCorr,
  toneOf,
  variance,
  weightedScore,
  type EnvFactor,
  type EnvStrategy,
  type StrategyEnvironmentPayload,
} from "@/lib/ma/strategy-environment"
import { UNDERLYING_CN_LABELS } from "@/lib/option-iv-labels"
import { query, queryUnbounded } from "@/lib/db"

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
  sealedUp: number
  brokenUp: number
  sealedDown: number
  promoted: number
  yesterdayUp: number
}

type CrowdingDay = { date: string; hhi: number | null }
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
              LAG(close::float8) OVER (PARTITION BY ts_code ORDER BY trade_date) AS prev
       FROM raw_ashare_daily
       WHERE trade_date >= CURRENT_DATE - $1::int
         AND close > 0
     ),
     flagged AS (
       SELECT trade_date, ts_code, amount, close, high, low, prev,
              CASE
                WHEN code ~ '^(300|301|688|689)' THEN 0.198
                WHEN code ~ '^(8|43|83|87|92)' THEN 0.298
                ELSE 0.098
              END AS lim
       FROM px
     ),
     sealed AS (
       SELECT trade_date, ts_code, amount, close, high, low, prev, lim,
              CASE
                WHEN prev > 0 AND high > 0 AND close / prev - 1 >= lim AND close >= high * 0.998 THEN 1
                ELSE 0
              END AS is_sealed
       FROM flagged
     ),
     marked AS (
       SELECT trade_date, amount, close, high, low, prev, lim, is_sealed,
              LAG(is_sealed) OVER (PARTITION BY ts_code ORDER BY trade_date) AS prev_sealed
       FROM sealed
     )
     SELECT trade_date::text AS trade_date,
            SUM(amount)::float8 AS amount,
            COUNT(*)::int AS n,
            STDDEV_SAMP(close / prev - 1) FILTER (WHERE ABS(close / prev - 1) < 0.35)::float8 AS xs_vol,
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

async function loadCrowding(): Promise<CrowdingDay[]> {
  const rows = await query<{ trade_date: string; hhi: string | number | null }>(
    `SELECT trade_date::text AS trade_date, hhi::float8 AS hhi
     FROM derived_ashare_crowding_daily
     WHERE trade_date >= CURRENT_DATE - $1::int
     ORDER BY trade_date`,
    [LOOKBACK_DAYS],
  )
  return rows.map((row) => ({ date: ymd(row.trade_date), hhi: num(row.hhi) }))
}

async function loadIndexes(): Promise<Map<string, IndexDay[]>> {
  const rows = await query<{
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
  const rows = await query<{
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
  const rows = await query<{ trade_date: string; symbol: string; close: string | number }>(
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
  const rows = await query<{
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
  const rows = await query<{ trade_date: string; underlying_key: string; iv: string | number }>(
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
  const rows = await query<{ trade_date: string; underlying_key: string; iv: string | number }>(
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

function mapByDate<T extends { date: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.date, row]))
}

function lastFinite(values: Array<number | null>, end: number, size: number): number[] {
  const out: number[] = []
  for (let i = end; i >= 0 && out.length < size; i--) {
    const value = values[i]
    if (value != null && Number.isFinite(value)) out.push(value)
  }
  return out.reverse()
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
  const delta = prev ? round1(last.score - prev.score) : null
  const described = describe(last, prev, delta)
  return {
    key,
    name,
    group,
    asOf: last.date,
    score: last.score,
    rating: described.rating,
    tone: toneOf(last.score),
    delta5: delta,
    compareDate: prev?.date ?? null,
    history: points.map((point) => ({ date: point.date, score: point.score })),
    headline: described.headline,
    factors: rescaleWeights(described.factors),
    notes: [`${name} ${last.score.toFixed(1)} 分，${deltaPhrase(delta, prev?.date ?? null)}。`, ...described.notes],
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

function buildQuant(
  stock: StockDay[],
  crowding: CrowdingDay[],
  indexes: Map<string, IndexDay[]>,
): EnvStrategy {
  const hhi = mapByDate(crowding)
  const csi = new Map((indexes.get("000300.SH") ?? []).map((row) => [row.date, row.amount]))
  const points: Scored<{
    xs: number
    xsPct: number
    amt: number
    amtPct: number
    hhi: number | null
    hhiPct: number | null
    csiShare: number | null
    csiPct: number | null
  }>[] = []
  const hhiSeries: Array<number | null> = stock.map((day) => hhi.get(day.date)?.hhi ?? null)
  const csiSeries: Array<number | null> = stock.map((day) => {
    const indexAmount = csi.get(day.date)
    if (indexAmount == null || !(day.amount > 0)) return null
    const ratio = indexAmount / day.amount
    return ratio > 0.02 && ratio < 0.8 ? ratio * 100 : null
  })
  for (let i = 0; i < stock.length; i++) {
    if (i < 20) continue
    const day = stock[i]
    const xsWindow = stock.slice(Math.max(0, i - PCT_WINDOW + 1), i + 1).map((item) => item.xsVol)
    const amtWindow = stock.slice(Math.max(0, i - PCT_WINDOW + 1), i + 1).map((item) => item.amount)
    const xsPct = pctRank(xsWindow, day.xsVol)
    const amtPct = pctRank(amtWindow, day.amount)
    const hhiValue = hhiSeries[i]
    const hhiWindow = lastFinite(hhiSeries, i, PCT_WINDOW)
    const hhiPct = hhiValue == null || hhiWindow.length < 15 ? null : pctRank(hhiWindow, hhiValue)
    const csiValue = csiSeries[i]
    const csiWindow = lastFinite(csiSeries, i, PCT_WINDOW)
    const csiPct = csiValue == null || csiWindow.length < 15 ? null : pctRank(csiWindow, csiValue)
    const score = weightedScore([
      { score: xsPct, weight: 0.4 },
      { score: amtPct, weight: 0.25 },
      hhiPct == null ? null : { score: 100 - hhiPct, weight: 0.2 },
      csiPct == null ? null : { score: 100 - csiPct, weight: 0.15 },
    ])
    if (score == null) continue
    points.push({
      date: day.date,
      score,
      xs: day.xsVol * 100,
      xsPct,
      amt: day.amount,
      amtPct,
      hhi: hhiValue,
      hhiPct,
      csiShare: csiValue,
      csiPct,
    })
  }
  return packStrategy("quant", "宽基量化", "股票", points, (last) => {
    const liquidity = last.amtPct < 35 ? "偏薄" : last.amtPct > 70 ? "充裕" : "中性"
    const dispersion = last.xsPct > 65 ? "离散度还在，个股之间有差可做" : last.xsPct < 35 ? "截面被压扁，alpha 难做" : "离散度中性"
    const rating = last.amtPct < 30 && last.score < 68 ? "谨慎" : bandRating(last.score)
    return {
      rating,
      headline: `成交${liquidity}，截面波动分位 ${last.xsPct.toFixed(0)}`,
      factors: [
        { key: "xs", label: "截面波动", score: round1(last.xsPct), weight: 0.4, detail: `日收益标准差 ${last.xs.toFixed(2)}%，60 日分位 ${last.xsPct.toFixed(0)}` },
        { key: "amt", label: "成交活跃", score: round1(last.amtPct), weight: 0.25, detail: `全 A 成交额 ${formatYi(last.amt)}，60 日分位 ${last.amtPct.toFixed(0)}` },
        last.hhiPct == null ? null : {
          key: "hhi",
          label: "成交分散",
          score: round1(100 - last.hhiPct),
          weight: 0.2,
          detail: `成交额 HHI ${last.hhi == null ? "—" : last.hhi.toFixed(4)}，集中度分位 ${last.hhiPct.toFixed(0)}。越分散越好`,
        },
        last.csiPct == null ? null : {
          key: "csi",
          label: "沪深300占比",
          score: round1(100 - last.csiPct),
          weight: 0.15,
          detail: `沪深300成交占全 A ${last.csiShare?.toFixed(1)}%，分位 ${last.csiPct.toFixed(0)}。占比越低，宽基以外的空间越大`,
        },
      ].filter((factor): factor is EnvFactor => factor != null),
      notes: [
        `全 A 成交额 ${formatYi(last.amt)}，近 60 日里处于 ${last.amtPct.toFixed(0)} 分位，流动性${liquidity}。截面波动率 ${last.xs.toFixed(2)}%，分位 ${last.xsPct.toFixed(0)}。`,
        `${dispersion}。分数同时看成交有没有挤在少数股票上${last.csiShare == null ? "" : `，以及沪深300是否占了 ${last.csiShare.toFixed(1)}% 的成交`}。`,
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
      score,
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
    const rating = last.score < 45 ? "情绪低迷" : last.score < 60 ? "情绪中性" : "情绪偏热"
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
    points.push({ date: rows[i].date, score, ret20: ret20 * 100, retPct, levelPct, volPct, activity, activityPct })
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
    points.push({ date, score, slope, slopePct, basis, basisPct, dispersion, dispersionPct, volPct })
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
    points.push({ date, score, amp, ampPct, er, byProduct: bits.join("，") })
  }
  return packStrategy("intraday", "股指多空日内", "衍生品", points, (last) => {
    const rating = last.ampPct < 30 && last.er < 12
      ? "偏静"
      : last.score >= 64 && last.er >= 15
        ? "良（可做）"
        : last.score >= 64
          ? "有振幅，方向弱"
          : last.score < 45
            ? "偏静"
            : "中性"
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
      score,
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

async function compute(): Promise<StrategyEnvironmentPayload> {
  const [stock, limitUps, crowding, indexes, futures, spots, commodities, iv, commodityIv] = await Promise.all([
    safe("stock", loadStock, [] as StockDay[]),
    safe("limit-up", loadLimitUps, [] as Array<{ date: string; code: string }>),
    safe("crowding", loadCrowding, [] as CrowdingDay[]),
    safe("index", loadIndexes, new Map<string, IndexDay[]>()),
    safe("futures", loadFutures, [] as ContractRow[]),
    safe("spots", loadSpots, new Map<string, Map<string, number>>()),
    safe("commodities", loadCommodities, new Map<string, CommodityBar[]>()),
    safe("iv", loadIv, [] as IvPoint[]),
    safe("commodity-iv", loadCommodityIv, [] as IvPoint[]),
  ])
  const books = dominantBooks(futures, spots, indexes)
  const strategies = [
    stock.length ? buildQuant(stock, crowding, indexes) : emptyStrategy("quant", "宽基量化", "股票", "A 股日行情不足，宽基环境先空着。"),
    stock.length ? buildSentiment(stock, limitUps) : emptyStrategy("momentum", "强势股", "股票", "A 股日行情不足，强势股环境先空着。"),
    buildCta(commodities),
    buildCb(indexes),
    buildArb(books, commodities),
    buildOption(iv, commodityIv, commodities, indexes),
    buildIntraday(books),
    buildSwing(books),
  ]
  const asOf = strategies.map((item) => item.asOf).filter((item): item is string => !!item).sort().at(-1) ?? null
  return { asOf, strategies }
}

export async function loadStrategyEnvironment(force = false): Promise<StrategyEnvironmentPayload> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data
  const started = Date.now()
  const data = await compute()
  console.info(`[strategy-environment] computed in ${Date.now() - started}ms asOf=${data.asOf ?? "none"}`)
  cache = { at: Date.now(), data }
  return data
}
