import { query } from "@/lib/db"
import { fundMatchesObservationCategory, type StrategyObservationLabels } from "@/lib/ma/strategy-observation"
import { type PrivateFundBenchmarkKey } from "@/lib/ma/private-fund-benchmark-options"
import { shareClassFromProductName } from "@/lib/server/share-class-product"
import { sqlResolvedStrategyExprs, sqlType6LatestStrategyJoin } from "@/lib/server/fund-strategy-resolve"
import { isPrivateFundBenchmarkKey, loadPrivateFundBenchmarkSeries } from "@/lib/server/private-fund-benchmarks"
import { loadStrategyEnvironment } from "@/lib/server/strategy-environment"
import { readStrategySnapshot, writeStrategySnapshot } from "@/lib/server/strategy-environment-snapshot"

export type StrategyComparePoint = {
  date: string
  score: number
  peer: number | null
  /** Cumulative index of the benchmark return that was subtracted from the same prints. */
  beta: number | null
  /** Cumulative index of the products' own return, before subtracting the benchmark. */
  total: number | null
}

export type StrategyCompareFund = {
  beian: string
  name: string
  values: Array<number | null>
}

export type StrategyComparePayload = {
  key: string
  peerLabel: string
  peerBasis: string
  peerVersion: string
  peerCount: number
  points: StrategyComparePoint[]
  funds: StrategyCompareFund[]
}

type PeerFund = StrategyObservationLabels & { beian: string }

const CACHE_MS = 10 * 60 * 1000
const MIN_PEER_PRINTS = 5
const MAX_STEP = 0.2
const MAX_FUNDS = 5
const MAX_SPAN_DAYS = 40
const BENCH_LAG_DAYS = 10
const PEER_VERSION = "excess-v2"

const QUANT_SLEEVES: Array<{ category: string; code: string; name: string }> = [
  { category: "300指增", code: "000300.SH", name: "沪深300" },
  { category: "A500指增", code: "000510.SH", name: "中证A500" },
  { category: "500指增", code: "000905.SH", name: "中证500" },
  { category: "1000指增", code: "000852.SH", name: "中证1000" },
  { category: "量化选股", code: "000985.SH", name: "中证全指" },
]

type BenchSpec = { code: string | null; basis: string }

function shiftDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

/** A chosen benchmark replaces the strategy default for every fund, including 宽基量化 sleeves. */
async function loadOverrideBench(benchKey: string, from: string, to: string): Promise<{ basis: string; closes: ClosePoint[] }> {
  if (!isPrivateFundBenchmarkKey(benchKey)) throw new Error("这个基准不能用")
  const series = await loadPrivateFundBenchmarkSeries(benchKey as PrivateFundBenchmarkKey, from, to)
  const closes = series.data.flatMap((point) =>
    point.value > 0 ? [{ date: point.date.slice(0, 10), close: point.value }] : [],
  )
  if (closes.length < 2) throw new Error("这个基准没有行情")
  return { basis: `超额减${series.label}。`, closes }
}

function benchForStrategy(key: string): BenchSpec {
  if (key === "quant") {
    return {
      code: null,
      basis: "300指增减沪深300，500指增减中证500，1000指增减中证1000，A500指增减中证A500，量化选股减中证全指。每一段先等权，再把当天有公布的几段等权。",
    }
  }
  const single: Record<string, BenchSpec> = {
    momentum: { code: "000985.SH", basis: "强势股减中证全指。" },
    cta: { code: "NHCI", basis: "商品CTA减南华商品指数。" },
    cb: { code: "000832.SH", basis: "转债指增减中证转债。" },
    arb: { code: null, basis: "套利没有单一市场指数，基准收益记 0。" },
    "option-sell": { code: null, basis: "期权卖权没有单一市场指数，基准收益记 0。" },
    intraday: { code: null, basis: "股指多空已经对冲方向，基准收益记 0。" },
    swing: { code: null, basis: "股指多空已经对冲方向，基准收益记 0。" },
  }
  return single[key] ?? { code: null, basis: "基准收益记 0。" }
}

function isEquityLongShort(fund: PeerFund): boolean {
  const blob = `${fund.l2}${fund.l3}${fund.name}`
  if (/指增|FOF|中性/.test(blob)) return false
  return fund.l2 === "股票多空" || /股指多空|指数多空|股票多空/.test(blob)
}

const PEER_RULES: Record<string, { label: string; match: (fund: PeerFund) => boolean }> = {
  quant: {
    label: "量化选股、300/500/1000/A500指增",
    match: (fund) =>
      ["量化选股", "300指增", "500指增", "1000指增", "A500指增"].some((category) =>
        fundMatchesObservationCategory(category, fund),
      ),
  },
  momentum: {
    label: "名称或策略里带强势股、打板",
    match: (fund) => /强势股|打板/.test(`${fund.l2}${fund.l3}${fund.name}`),
  },
  cta: {
    label: "量化期货",
    match: (fund) => fundMatchesObservationCategory("量化期货", fund),
  },
  cb: {
    label: "可转债多头",
    match: (fund) => fundMatchesObservationCategory("可转债多头", fund),
  },
  arb: {
    label: "套利策略",
    match: (fund) => fundMatchesObservationCategory("套利策略", fund),
  },
  "option-sell": {
    label: "期权策略",
    match: (fund) => fundMatchesObservationCategory("期权策略", fund),
  },
  intraday: {
    label: "股票多空。库里没有单独的股指日内分类",
    match: isEquityLongShort,
  },
  swing: {
    label: "股票多空。库里没有单独的股指日间分类",
    match: isEquityLongShort,
  },
}

let fundCache: { at: number; funds: PeerFund[] } | null = null
const peerCache = new Map<string, {
  at: number
  peer: Array<number | null>
  beta: Array<number | null>
  total: Array<number | null>
  count: number
  label: string
  basis: string
}>()

function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00Z`)
  const b = Date.parse(`${later}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 99
  return Math.round((b - a) / 86_400_000)
}

async function loadPeerFunds(): Promise<PeerFund[]> {
  if (fundCache && Date.now() - fundCache.at < CACHE_MS) return fundCache.funds
  const expr = sqlResolvedStrategyExprs("t6", "i")
  const rows = await query<{
    beian_hao: string
    product_name: string | null
    strategy_l1: string | null
    strategy_l2: string | null
    strategy_l3: string | null
  }>(
    `SELECT i.beian_hao, i.product_name,
            ${expr.l1} AS strategy_l1, ${expr.l2} AS strategy_l2, ${expr.l3} AS strategy_l3
     FROM private_fund_info i
     ${sqlType6LatestStrategyJoin("i.beian_hao", "t6")}
     WHERE i.latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'
       AND NULLIF(BTRIM(i.beian_hao), '') IS NOT NULL`,
  )
  const funds = rows.flatMap((row) => {
    const name = row.product_name ?? ""
    if (shareClassFromProductName(name)) return []
    return [{
      beian: row.beian_hao.trim().toUpperCase(),
      name,
      l1: row.strategy_l1 ?? "",
      l2: row.strategy_l2 ?? "",
      l3: row.strategy_l3 ?? "",
    }]
  })
  fundCache = { at: Date.now(), funds }
  return funds
}

type NavPoint = { date: string; nav: number }

async function loadNavs(beians: string[], from: string, to: string): Promise<Map<string, NavPoint[]>> {
  const out = new Map<string, NavPoint[]>()
  if (!beians.length) return out
  for (let offset = 0; offset < beians.length; offset += 400) {
    const chunk = beians.slice(offset, offset + 400)
    const rows = await query<{ beian_hao: string; price_date: string; nav: number }>(
      `SELECT upper(beian_hao) AS beian_hao, price_date::text AS price_date, cumulative_nav::float8 AS nav
       FROM private_fund_nav
       WHERE upper(beian_hao) = ANY($1::text[])
         AND price_date >= $2::date
         AND price_date <= $3::date
         AND cumulative_nav IS NOT NULL
         AND cumulative_nav::float8 > 0
       ORDER BY beian_hao, price_date`,
      [chunk, from, to],
    )
    for (const row of rows) {
      const nav = Number(row.nav)
      if (!(nav > 0)) continue
      const list = out.get(row.beian_hao) ?? []
      const date = String(row.price_date).slice(0, 10)
      const prev = list[list.length - 1]
      if (prev?.date === date) prev.nav = nav
      else list.push({ date, nav })
      out.set(row.beian_hao, list)
    }
  }
  return out
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

type ClosePoint = { date: string; close: number }

function closeOnOrBefore(series: ClosePoint[], date: string): number | null {
  let lo = 0
  let hi = series.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (series[mid].date <= date) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (found < 0) return null
  if (daysBetween(series[found].date, date) > BENCH_LAG_DAYS) return null
  return series[found].close
}

type SleeveParts = {
  excess: Array<number | null>
  beta: Array<number | null>
  total: Array<number | null>
}

function meanOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Same prints for all three series, so excess = total − beta on each date.
 * Beta is the benchmark return over that print. A cash benchmark contributes 0.
 */
function sleeveParts(dates: string[], books: NavPoint[][], bench: ClosePoint[] | null, minPrints: number): SleeveParts {
  const pos = books.map(() => 0)
  const excess: Array<number | null> = []
  const beta: Array<number | null> = []
  const total: Array<number | null> = []
  for (const date of dates) {
    const excesses: number[] = []
    const betas: number[] = []
    const totals: number[] = []
    for (let i = 0; i < books.length; i++) {
      const book = books[i]
      while (pos[i] < book.length && book[pos[i]].date < date) pos[i] += 1
      if (pos[i] <= 0 || pos[i] >= book.length || book[pos[i]].date !== date) continue
      const current = book[pos[i]]
      const previous = book[pos[i] - 1]
      if (!(previous.nav > 0) || daysBetween(previous.date, date) > MAX_SPAN_DAYS) continue
      const fundRet = current.nav / previous.nav - 1
      if (Math.abs(fundRet) > MAX_STEP) continue
      let benchRet = 0
      if (bench) {
        const start = closeOnOrBefore(bench, previous.date)
        const end = closeOnOrBefore(bench, date)
        if (start == null || end == null || !(start > 0)) continue
        benchRet = end / start - 1
      }
      excesses.push(fundRet - benchRet)
      betas.push(benchRet)
      totals.push(fundRet)
    }
    if (excesses.length < minPrints) {
      excess.push(null)
      beta.push(null)
      total.push(null)
      continue
    }
    excess.push(meanOf(excesses))
    beta.push(meanOf(betas))
    total.push(meanOf(totals))
  }
  return { excess, beta, total }
}

/** Mean excess of funds that published a new NAV on this date. Excess is the fund return since its previous print, minus the benchmark return over the same dates. */
function sleeveExcess(dates: string[], books: NavPoint[][], bench: ClosePoint[] | null, minPrints: number): Array<number | null> {
  return sleeveParts(dates, books, bench, minPrints).excess
}

function blendParts(parts: SleeveParts[]): SleeveParts {
  return {
    excess: blendExcess(parts.map((part) => part.excess)),
    beta: blendExcess(parts.map((part) => part.beta)),
    total: blendExcess(parts.map((part) => part.total)),
  }
}

function blendExcess(parts: Array<Array<number | null>>): Array<number | null> {
  const length = parts[0]?.length ?? 0
  const out: Array<number | null> = []
  for (let i = 0; i < length; i++) {
    const ready = parts.map((row) => row[i]).filter((value): value is number => value != null)
    out.push(ready.length ? ready.reduce((sum, value) => sum + value, 0) / ready.length : null)
  }
  return out
}

function compoundExcess(daily: Array<number | null>): Array<number | null> {
  let level = 100
  let started = false
  return daily.map((excess) => {
    if (excess != null) {
      level *= 1 + excess
      started = true
    }
    return started ? round2(level) : null
  })
}

function cleanBeian(value: string): string | null {
  const code = value.trim().toUpperCase()
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null
}

function sameCurve(saved: StrategyComparePayload, strategy: { history: Array<{ date: string; score: number }> }, basis: string): boolean {
  const points = saved.points
  const history = strategy.history
  if (saved.peerVersion !== PEER_VERSION || saved.peerBasis !== basis) return false
  if (!points || points.length !== history.length || points.length < 2) return false
  const last = history.length - 1
  return points[0].date === history[0].date
    && points[last].date === history[last].date
    && points[last].score === history[last].score
}

async function loadCloses(codes: string[], from: string): Promise<Map<string, ClosePoint[]>> {
  const out = new Map<string, ClosePoint[]>()
  const indexCodes = codes.filter((code) => code !== "NHCI")
  if (indexCodes.length) {
    const rows = await query<{ trade_date: string; ts_code: string; close: number }>(
      `SELECT trade_date::text AS trade_date, ts_code, close::float8 AS close
       FROM raw_ashare_index_daily
       WHERE ts_code = ANY($1::text[])
         AND trade_date >= $2::date - 80
         AND close > 0
       ORDER BY ts_code, trade_date`,
      [indexCodes, from],
    )
    for (const row of rows) {
      const close = Number(row.close)
      if (!(close > 0)) continue
      const list = out.get(row.ts_code) ?? []
      list.push({ date: String(row.trade_date).slice(0, 10), close })
      out.set(row.ts_code, list)
    }
  }
  if (codes.includes("NHCI")) {
    const rows = await query<{ trade_date: string; close: number }>(
      `SELECT trade_date::text AS trade_date, close::float8 AS close
       FROM raw_nhci_daily
       WHERE trade_date >= $1::date - 80
         AND close > 0
       ORDER BY trade_date`,
      [from],
    )
    out.set("NHCI", rows.flatMap((row) => {
      const close = Number(row.close)
      return close > 0 ? [{ date: String(row.trade_date).slice(0, 10), close }] : []
    }))
  }
  return out
}

function quantSleeve(fund: PeerFund): (typeof QUANT_SLEEVES)[number] | null {
  return QUANT_SLEEVES.find((sleeve) => fundMatchesObservationCategory(sleeve.category, fund)) ?? null
}

export async function loadStrategyCompare(key: string, fundCodes: string[], benchKey = ""): Promise<StrategyComparePayload | null> {
  const env = await loadStrategyEnvironment(false)
  const strategy = env.strategies.find((item) => item.key === key)
  if (!strategy || strategy.history.length < 2) return null
  const dates = strategy.history.map((point) => point.date)
  const rule = PEER_RULES[key] ?? { label: "没有对应的策略分类", match: () => false }
  const lastScore = strategy.history[strategy.history.length - 1]?.score
  const override = benchKey ? await loadOverrideBench(benchKey, shiftDays(dates[0], -90), dates[dates.length - 1]) : null
  const benchSpec = override ? { code: benchKey, basis: override.basis } : benchForStrategy(key)
  const cacheKey = `${PEER_VERSION}|${key}|${benchKey || "default"}|${benchSpec.basis}|${dates[0]}|${dates[dates.length - 1]}|${lastScore}`
  let cached = peerCache.get(cacheKey)
  if ((!cached || Date.now() - cached.at >= CACHE_MS) && !override) {
    const stored = await readStrategySnapshot<StrategyComparePayload>(`compare:${key}`)
    if (stored && sameCurve(stored.body, strategy, benchSpec.basis)) {
      cached = {
        at: Date.now(),
        peer: stored.body.points.map((point) => point.peer),
        beta: stored.body.points.map((point) => point.beta ?? null),
        total: stored.body.points.map((point) => point.total ?? null),
        count: stored.body.peerCount,
        label: stored.body.peerLabel,
        basis: benchSpec.basis,
      }
    }
  }
  if (!cached || Date.now() - cached.at >= CACHE_MS) {
    const funds = (await loadPeerFunds()).filter(rule.match)
    const from = dates[0]
    const books = await loadNavs(funds.map((fund) => fund.beian), from, dates[dates.length - 1])
    const usable = funds.flatMap((fund) => {
      const points = books.get(fund.beian)
      return points && points.length >= 2 ? [{ fund, points }] : []
    })
    const codes = override
      ? []
      : key === "quant"
        ? QUANT_SLEEVES.map((sleeve) => sleeve.code)
        : benchSpec.code ? [benchSpec.code] : []
    const closes = await loadCloses(codes, from)
    const parts = override
      ? sleeveParts(dates, usable.map((item) => item.points), override.closes, MIN_PEER_PRINTS)
      : key === "quant"
        ? blendParts(QUANT_SLEEVES.map((sleeve) => {
            const sleeveBooks = usable.flatMap((item) => quantSleeve(item.fund)?.code === sleeve.code ? [item.points] : [])
            return sleeveParts(dates, sleeveBooks, closes.get(sleeve.code) ?? [], MIN_PEER_PRINTS)
          }))
        : sleeveParts(dates, usable.map((item) => item.points), benchSpec.code ? closes.get(benchSpec.code) ?? [] : null, MIN_PEER_PRINTS)
    cached = {
      at: Date.now(),
      peer: compoundExcess(parts.excess),
      beta: compoundExcess(parts.beta),
      total: compoundExcess(parts.total),
      count: usable.length,
      label: rule.label,
      basis: benchSpec.basis,
    }
    const snapshot: StrategyComparePayload = {
      key,
      peerLabel: cached.label,
      peerBasis: cached.basis,
      peerVersion: PEER_VERSION,
      peerCount: cached.count,
      points: dates.map((date, index) => ({
        date,
        score: strategy.history[index].score,
        peer: cached!.peer[index] ?? null,
        beta: cached!.beta[index] ?? null,
        total: cached!.total[index] ?? null,
      })),
      funds: [],
    }
    if (!override) {
      try {
        await writeStrategySnapshot(`compare:${key}`, snapshot)
      } catch (err) {
        console.error(`[strategy-environment] compare snapshot ${key}`, err)
      }
    }
  }
  peerCache.set(cacheKey, cached)
  const wanted = [...new Set(fundCodes.map(cleanBeian).filter((code): code is string => !!code))].slice(0, MAX_FUNDS)
  const navs = await loadNavs(wanted, dates[0], dates[dates.length - 1])
  const known = new Map((await loadPeerFunds()).map((fund) => [fund.beian, fund]))
  const names = wanted.length
    ? await query<{ beian_hao: string; product_name: string | null }>(
        `SELECT beian_hao, product_name FROM private_fund_info WHERE upper(beian_hao) = ANY($1::text[])`,
        [wanted],
      )
    : []
  const nameOf = new Map(names.map((row) => [row.beian_hao.trim().toUpperCase(), row.product_name ?? row.beian_hao]))
  const fundCodesNeeded = override ? [] : wanted.map((beian) => {
    const fund = known.get(beian) ?? null
    if (key === "quant") return quantSleeve(fund ?? { beian, name: "", l1: "", l2: "", l3: "" })?.code ?? "000985.SH"
    return benchSpec.code
  }).filter((code): code is string => !!code)
  const fundCloses = await loadCloses([...new Set(fundCodesNeeded)], dates[0])
  return {
    key,
    peerLabel: cached.label,
    peerBasis: cached.basis,
    peerVersion: PEER_VERSION,
    peerCount: cached.count,
    points: dates.map((date, index) => ({
      date,
      score: strategy.history[index].score,
      peer: cached.peer[index] ?? null,
      beta: cached.beta[index] ?? null,
      total: cached.total[index] ?? null,
    })),
    funds: wanted.map((beian) => {
      const fund = known.get(beian) ?? null
      const code = key === "quant"
        ? quantSleeve(fund ?? { beian, name: nameOf.get(beian) ?? "", l1: "", l2: "", l3: "" })?.code ?? "000985.SH"
        : benchSpec.code
      const points = navs.get(beian) ?? []
      const bench = override ? override.closes : code ? fundCloses.get(code) ?? [] : null
      return {
        beian,
        name: nameOf.get(beian) ?? beian,
        values: compoundExcess(sleeveExcess(dates, points.length >= 2 ? [points] : [], bench, 1)),
      }
    }),
  }
}

const NAV_VERSION = "nav-v2"
const NAV_STALE_DAYS = 14

const NAV_LINES: Array<{ key: string; name: string; ruleKey: string }> = [
  { key: "quant", name: "宽基量化", ruleKey: "quant" },
  { key: "momentum", name: "强势股", ruleKey: "momentum" },
  { key: "cta", name: "商品CTA", ruleKey: "cta" },
  { key: "cb", name: "转债指增", ruleKey: "cb" },
  { key: "arb", name: "套利", ruleKey: "arb" },
  { key: "option-sell", name: "期权卖权", ruleKey: "option-sell" },
  { key: "long-short", name: "股指多空", ruleKey: "intraday" },
]

export type StrategyNavSeries = {
  key: string
  name: string
  count: number
  values: Array<number | null>
}

export type StrategyNavOverlay = {
  version: string
  stamp: string
  note: string
  dates: string[]
  series: StrategyNavSeries[]
}

let navCache: { at: number; stamp: string; body: StrategyNavOverlay } | null = null

function envStamp(strategies: Array<{ key: string; history: Array<{ date: string; score: number }> }>): string {
  return strategies
    .map((item) => {
      const last = item.history[item.history.length - 1]
      return `${item.key}:${item.history.length}:${last?.date ?? ""}:${last?.score ?? ""}`
    })
    .join("|")
}

function latestOn(points: NavPoint[], date: string, cursor: { index: number }): NavPoint | null {
  while (cursor.index < points.length && points[cursor.index].date <= date) cursor.index += 1
  const point = cursor.index > 0 ? points[cursor.index - 1] : null
  if (!point || daysBetween(point.date, date) > NAV_STALE_DAYS) return null
  return point
}

/** Equal-weight index. A fund with no new print contributes 0 that day, so its earlier gain is not applied again and is not treated as the whole sleeve. */
function peerIndex(dates: string[], books: NavPoint[][]): Array<number | null> {
  const cursors = books.map(() => ({ index: 0 }))
  const seen = books.map(() => null as number | null)
  let index = 100
  const out: Array<number | null> = []
  for (const date of dates) {
    let retSum = 0
    let base = 0
    const next = new Map<number, number>()
    for (let i = 0; i < books.length; i++) {
      const point = latestOn(books[i], date, cursors[i])
      if (!point) continue
      next.set(i, point.nav)
      const prev = seen[i]
      if (prev == null || !(prev > 0)) continue
      base += 1
      if (point.nav === prev) continue
      const ret = point.nav / prev - 1
      if (Math.abs(ret) <= MAX_STEP) retSum += ret
    }
    if (base >= MIN_PEER_PRINTS) index *= 1 + retSum / base
    for (const [i, nav] of next) seen[i] = nav
    out.push(base >= MIN_PEER_PRINTS ? round2(index) : null)
  }
  return out
}

/** Equal-weight cumulative NAV of each strategy's products. Benchmark return is 0, so the lines can be compared with each other. */
export async function loadStrategyAverageNav(): Promise<StrategyNavOverlay | null> {
  const env = await loadStrategyEnvironment(false)
  if (!env.strategies.length) return null
  const stamp = `${NAV_VERSION}|${envStamp(env.strategies)}`
  if (navCache && navCache.stamp === stamp && Date.now() - navCache.at < CACHE_MS) return navCache.body
  const stored = await readStrategySnapshot<StrategyNavOverlay>("compare:nav")
  if (stored && stored.body.version === NAV_VERSION && stored.body.stamp === stamp && stored.body.series.length) {
    navCache = { at: Date.now(), stamp, body: stored.body }
    return stored.body
  }
  const dates = [...new Set(env.strategies.flatMap((item) => item.history.map((point) => point.date)))].sort()
  if (dates.length < 2) return null
  const funds = await loadPeerFunds()
  const groups = NAV_LINES.map((line) => {
    const rule = PEER_RULES[line.ruleKey]
    const matched = rule ? funds.filter(rule.match) : []
    const name = line.key === "long-short" ? line.name : env.strategies.find((item) => item.key === line.ruleKey)?.name ?? line.name
    return { ...line, name, matched }
  })
  const books = await loadNavs(
    [...new Set(groups.flatMap((group) => group.matched.map((fund) => fund.beian)))],
    dates[0],
    dates[dates.length - 1],
  )
  const series = groups.flatMap((group) => {
    const usable = group.matched.flatMap((fund) => {
      const points = books.get(fund.beian)
      return points && points.length >= 2 ? [{ fund, points }] : []
    })
    if (!usable.length) return []
    return [{ key: group.key, name: group.name, count: usable.length, values: peerIndex(dates, usable.map((item) => item.points)) }]
  })
  if (!series.length) return null
  const body: StrategyNavOverlay = {
    version: NAV_VERSION,
    stamp,
    note: "每条线是该策略产品的等权累计净值，起点 100，不减指数。当天没公布的产品收益记 0，新公布的那段涨跌只算一次。股指多空的日内和日间没有分开的产品，合成一条。当天至少 5 只有净值时，这条线才往前走。",
    dates,
    series,
  }
  try {
    await writeStrategySnapshot("compare:nav", body)
  } catch (err) {
    console.error("[strategy-environment] nav snapshot", err)
  }
  navCache = { at: Date.now(), stamp, body }
  return body
}
