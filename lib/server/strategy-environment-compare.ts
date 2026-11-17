import { query } from "@/lib/db"
import { fundMatchesObservationCategory, type StrategyObservationLabels } from "@/lib/ma/strategy-observation"
import { shareClassFromProductName } from "@/lib/server/share-class-product"
import { sqlResolvedStrategyExprs, sqlType6LatestStrategyJoin } from "@/lib/server/fund-strategy-resolve"
import { loadStrategyEnvironment } from "@/lib/server/strategy-environment"

export type StrategyComparePoint = {
  date: string
  score: number
  peer: number | null
}

export type StrategyCompareFund = {
  beian: string
  name: string
  values: Array<number | null>
}

export type StrategyComparePayload = {
  key: string
  peerLabel: string
  peerCount: number
  points: StrategyComparePoint[]
  funds: StrategyCompareFund[]
}

type PeerFund = StrategyObservationLabels & { beian: string }

const CACHE_MS = 10 * 60 * 1000
const MIN_PEER_PRINTS = 5
const MAX_STEP = 0.2
const MAX_FUNDS = 5

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
const peerCache = new Map<string, { at: number; peer: Array<number | null>; count: number; label: string }>()

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

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

function latestOn(points: NavPoint[], date: string, cursor: { index: number }): NavPoint | null {
  while (cursor.index < points.length && points[cursor.index].date <= date) cursor.index += 1
  const point = cursor.index > 0 ? points[cursor.index - 1] : null
  if (!point || daysBetween(point.date, date) > 14) return null
  return point
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Equal-weight index. A fund that has not published a new NAV contributes 0 that day, so its earlier return is not dropped and is not treated as the whole universe. */
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

function rebase(points: NavPoint[], dates: string[]): Array<number | null> {
  const cursor = { index: 0 }
  const raw = dates.map((date) => latestOn(points, date, cursor)?.nav ?? null)
  const base = raw.find((value) => value != null && value > 0)
  if (base == null) return raw.map(() => null)
  return raw.map((value) => (value == null ? null : round1((value / base) * 100)))
}

function cleanBeian(value: string): string | null {
  const code = value.trim().toUpperCase()
  return /^[A-Z0-9]{4,12}$/.test(code) ? code : null
}

export async function loadStrategyCompare(key: string, fundCodes: string[]): Promise<StrategyComparePayload | null> {
  const env = await loadStrategyEnvironment(false)
  const strategy = env.strategies.find((item) => item.key === key)
  if (!strategy || strategy.history.length < 2) return null
  const dates = strategy.history.map((point) => point.date)
  const rule = PEER_RULES[key] ?? { label: "没有对应的策略分类", match: () => false }
  const cacheKey = `v2|${key}|${dates[0]}|${dates[dates.length - 1]}`
  let cached = peerCache.get(cacheKey)
  if (!cached || Date.now() - cached.at >= CACHE_MS) {
    const funds = (await loadPeerFunds()).filter(rule.match)
    const from = dates[0]
    const books = await loadNavs(funds.map((fund) => fund.beian), from, dates[dates.length - 1])
    const series = funds.flatMap((fund) => {
      const points = books.get(fund.beian)
      return points && points.length >= 2 ? [points] : []
    })
    cached = {
      at: Date.now(),
      peer: series.length >= MIN_PEER_PRINTS ? peerIndex(dates, series) : dates.map(() => null),
      count: series.length,
      label: rule.label,
    }
    peerCache.set(cacheKey, cached)
  }
  const wanted = [...new Set(fundCodes.map(cleanBeian).filter((code): code is string => !!code))].slice(0, MAX_FUNDS)
  const navs = await loadNavs(wanted, dates[0], dates[dates.length - 1])
  const names = wanted.length
    ? await query<{ beian_hao: string; product_name: string | null }>(
        `SELECT beian_hao, product_name FROM private_fund_info WHERE upper(beian_hao) = ANY($1::text[])`,
        [wanted],
      )
    : []
  const nameOf = new Map(names.map((row) => [row.beian_hao.trim().toUpperCase(), row.product_name ?? row.beian_hao]))
  return {
    key,
    peerLabel: cached.label,
    peerCount: cached.count,
    points: dates.map((date, index) => ({
      date,
      score: strategy.history[index].score,
      peer: cached.peer[index] ?? null,
    })),
    funds: wanted.map((beian) => ({
      beian,
      name: nameOf.get(beian) ?? beian,
      values: rebase(navs.get(beian) ?? [], dates),
    })),
  }
}
