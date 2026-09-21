/**
 * Infer parts of a CTA's rulebook from fills + prices.
 * Propose common quant hypotheses, drop those that conflict, keep only
 * statistically significant traces. The ML/scoring core is usually unrecoverable;
 * filters, horizon, universe and sizing often leave evidence.
 */

export type InferOpen = {
  date: string
  product: string
  buyOpen: number
  sellOpen: number
}

export type InferPos = {
  date: string
  product: string
  sector: string
  buyLots: number
  sellLots: number
  mv: number
}

export type InferPx = {
  product: string
  date: string
  close: number
  volume: number
}

export type InferNhci = {
  date: string
  close: number
}

export type InferBookDay = {
  date: string
  equity: number
  margin: number
  riskPct: number
}

export type InferMeta = {
  medianHold: number | null
  hedgeAvg: number
  lockShare: number
  nightLotsShare: number
  corrNhci: number | null
  from: string
  to: string
}

export type InferFinding = {
  id: string
  family: string
  stance: "support" | "reject"
  title: string
  detail: string
  q: number | null
  stat: string
}

export type SizingBucket = {
  label: string
  meanX: number
  meanY: number
  n: number
}

export type BookVolChart = {
  mktName: string
  rho: number | null
  p: number | null
  n: number
  points: { date: string; mktVol: number; leverage: number }[]
  buckets: SizingBucket[]
}

export type CrossVolChart = {
  rho: number | null
  p: number | null
  n: number
  points: { product: string; vol: number; weight: number }[]
  buckets: SizingBucket[]
}

export type StrategyInference = {
  headline: string
  conclusions: string[]
  plan: string[]
  unclassified: string[]
  supported: InferFinding[]
  rejected: InferFinding[]
  tested: number
  shown: number
  charts?: {
    bookVol: BookVolChart | null
    crossVol: CrossVolChart | null
  }
}

type Ind = {
  close: number
  volume: number
  ma20: number | null
  ma60: number | null
  rsi14: number | null
  ret5: number | null
  ret20: number | null
  ret60: number | null
  vol20: number | null
  high20: boolean
  low20: boolean
  golden: boolean
  death: boolean
}

type PropTest = {
  id: string
  family: string
  supportTitle: string
  rejectTitle: string
  supportDetail: (t: PropTest, pOn: number, pOff: number) => string
  rejectDetail: (t: PropTest, pOn: number, pOff: number) => string
  oppositeTitle?: string
  oppositeDetail?: (t: PropTest, pOn: number, pOff: number) => string
  invert?: boolean
  a: number
  nOn: number
  c: number
  nOff: number
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax)
  return sign * y
}

function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

function twoSidedP(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(1, 2 * (1 - normCdf(Math.abs(z))))
}

function twoProp(a: number, nOn: number, c: number, nOff: number): { pOn: number; pOff: number; or: number; z: number; p: number } {
  const pOn = nOn > 0 ? a / nOn : 0
  const pOff = nOff > 0 ? c / nOff : 0
  const n = nOn + nOff
  const p = n > 0 ? (a + c) / n : 0
  const se = p > 0 && p < 1 ? Math.sqrt(p * (1 - p) * (1 / nOn + 1 / nOff)) : 0
  const z = se > 0 ? (pOn - pOff) / se : 0
  const orNum = a * (nOff - c)
  const orDen = c * (nOn - a)
  const or = orDen > 0 ? orNum / orDen : (orNum > 0 ? Infinity : 1)
  return { pOn, pOff, or, z, p: twoSidedP(z) }
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const r = Array(xs.length).fill(0)
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j < idx.length && idx[j].v === idx[i].v) j++
    const avg = (i + j - 1) / 2 + 1
    for (let k = i; k < j; k++) r[idx[k].i] = avg
    i = j
  }
  return r
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 10) return null
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx
    const y = ys[i] - my
    num += x * y
    dx += x * x
    dy += y * y
  }
  const den = Math.sqrt(dx * dy)
  if (den < 1e-12) return null
  return num / den
}

function spearman(xs: number[], ys: number[]): { rho: number; p: number; n: number } | null {
  if (xs.length !== ys.length || xs.length < 20) return null
  const rho = pearson(ranks(xs), ranks(ys))
  if (rho == null) return null
  const n = xs.length
  const t = rho * Math.sqrt((n - 2) / Math.max(1e-12, 1 - rho * rho))
  return { rho, p: twoSidedP(t), n }
}

function bhQ(ps: number[]): number[] {
  const n = ps.length
  if (!n) return []
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const q = Array(n).fill(1)
  let running = 1
  for (let k = n; k >= 1; k--) {
    running = Math.min(running, order[k - 1].p * n / k)
    q[order[k - 1].i] = running
  }
  return q
}

function sma(xs: number[], i: number, n: number): number | null {
  if (i + 1 < n) return null
  let s = 0
  for (let j = i - n + 1; j <= i; j++) s += xs[j]
  return s / n
}

function rsi14(closes: number[], i: number): number | null {
  if (i < 14) return null
  let up = 0, dn = 0
  for (let j = i - 13; j <= i; j++) {
    const d = closes[j] - closes[j - 1]
    if (d > 0) up += d
    else dn -= d
  }
  const au = up / 14
  const ad = dn / 14
  if (ad < 1e-12) return 100
  return 100 - 100 / (1 + au / ad)
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

function fmtOr(or: number): string {
  if (!Number.isFinite(or)) return "∞"
  return or.toFixed(2)
}

function buildIndicators(px: InferPx[]): Map<string, Map<string, Ind>> {
  const byProd = new Map<string, InferPx[]>()
  for (const r of px) {
    if (r.close <= 0) continue
    const list = byProd.get(r.product) ?? []
    list.push(r)
    byProd.set(r.product, list)
  }
  const out = new Map<string, Map<string, Ind>>()
  for (const [prod, rows] of byProd) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    const closes = sorted.map((r) => r.close)
    const vols: number[] = []
    const volByDate = new Map<string, number>()
    for (let i = 1; i < sorted.length; i++) {
      const prev = closes[i - 1]
      const ret = prev > 0 ? closes[i] / prev - 1 : 0
      const slice: number[] = []
      for (let j = Math.max(1, i - 19); j <= i; j++) {
        const p = closes[j - 1]
        if (p > 0) slice.push(closes[j] / p - 1)
      }
      const v = slice.length >= 10 ? stdev(slice) : null
      if (v != null) {
        vols.push(v)
        volByDate.set(sorted[i].date, v)
      }
    }
    const volSorted = [...vols].sort((a, b) => a - b)
    const volCut = volSorted[Math.floor(volSorted.length * 0.8)] ?? Infinity
    const volLow = volSorted[Math.floor(volSorted.length * 0.2)] ?? 0
    const amount = sorted.map((r) => r.volume)
    const amtSorted = [...amount].filter((x) => x > 0).sort((a, b) => a - b)
    const amtCut = amtSorted[Math.floor(amtSorted.length * 0.2)] ?? 0

    const map = new Map<string, Ind>()
    for (let i = 0; i < sorted.length; i++) {
      const ma20 = sma(closes, i, 20)
      const ma60 = sma(closes, i, 60)
      const prev20 = i > 0 ? sma(closes, i - 1, 20) : null
      const prev60 = i > 0 ? sma(closes, i - 1, 60) : null
      let high20 = false
      let low20 = false
      if (i >= 19) {
        let mx = -Infinity, mn = Infinity
        for (let j = i - 19; j < i; j++) {
          mx = Math.max(mx, closes[j])
          mn = Math.min(mn, closes[j])
        }
        high20 = closes[i] >= mx
        low20 = closes[i] <= mn
      }
      const v = volByDate.get(sorted[i].date)
      map.set(sorted[i].date, {
        close: closes[i],
        volume: sorted[i].volume,
        ma20,
        ma60,
        rsi14: rsi14(closes, i),
        ret5: i >= 5 && closes[i - 5] > 0 ? closes[i] / closes[i - 5] - 1 : null,
        ret20: i >= 20 && closes[i - 20] > 0 ? closes[i] / closes[i - 20] - 1 : null,
        ret60: i >= 60 && closes[i - 60] > 0 ? closes[i] / closes[i - 60] - 1 : null,
        vol20: v ?? null,
        high20,
        low20,
        golden: prev20 != null && prev60 != null && ma20 != null && ma60 != null && prev20 <= prev60 && ma20 > ma60,
        death: prev20 != null && prev60 != null && ma20 != null && ma60 != null && prev20 >= prev60 && ma20 < ma60,
      })
      const ind = map.get(sorted[i].date)!
      ;(ind as Ind & { hiVol?: boolean; loVol?: boolean; loLiq?: boolean }).hiVol = v != null && v >= volCut
      ;(ind as Ind & { hiVol?: boolean; loVol?: boolean; loLiq?: boolean }).loVol = v != null && v <= volLow
      ;(ind as Ind & { hiVol?: boolean; loVol?: boolean; loLiq?: boolean }).loLiq = amtCut > 0 && sorted[i].volume > 0 && sorted[i].volume <= amtCut
    }
    out.set(prod, map)
  }
  return out
}

type FlagInd = Ind & { hiVol?: boolean; loVol?: boolean; loLiq?: boolean }

function collect2x2(
  days: Array<{ open: boolean; signal: boolean | null }>,
): { a: number; nOn: number; c: number; nOff: number } | null {
  let a = 0, nOn = 0, c = 0, nOff = 0
  for (const d of days) {
    if (d.signal == null) continue
    if (d.signal) {
      nOn += 1
      if (d.open) a += 1
    } else {
      nOff += 1
      if (d.open) c += 1
    }
  }
  if (nOn < 20 || nOff < 20) return null
  if (a + c < 15) return null
  return { a, nOn, c, nOff }
}

function effectOk(pOn: number, pOff: number, or: number): boolean {
  const lift = Math.abs(pOn - pOff)
  const ratio = pOff > 1e-6 ? pOn / pOff : (pOn > 0 ? 99 : 1)
  return lift >= 0.08 || ratio >= 1.35 || ratio <= 1 / 1.35 || or >= 1.4 || or <= 1 / 1.4
}

function rollingVol(series: InferNhci[], n = 20): Map<string, number> {
  const sorted = [...series].filter((r) => r.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  const out = new Map<string, number>()
  const rets: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].close
    rets.push(prev > 0 ? sorted[i].close / prev - 1 : 0)
    if (rets.length >= n) {
      out.set(sorted[i].date, stdev(rets.slice(rets.length - n)))
    }
  }
  return out
}

function fmtX(n: number): string {
  return `${n.toFixed(2)}x`
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

function r3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function annVolPct(dailyStd: number): number {
  return dailyStd * Math.sqrt(252) * 100
}

function quintileMeans(xs: number[], ys: number[]): SizingBucket[] {
  const labels = ["低", "偏低", "中", "偏高", "高"]
  const n = xs.length
  if (n < 10 || xs.length !== ys.length) return []
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  return labels.map((label, q) => {
    const a = Math.floor(n * q / 5)
    const b = Math.floor(n * (q + 1) / 5)
    const slice = order.slice(a, b)
    return {
      label,
      meanX: r2(mean(slice.map((s) => xs[s.i]))),
      meanY: r3(mean(slice.map((s) => ys[s.i]))),
      n: slice.length,
    }
  })
}

function strideSample<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr
  const step = arr.length / cap
  const out: T[] = []
  for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]!)
  return out
}

export function inferQuantStrategy(input: {
  opens: InferOpen[]
  positions: InferPos[]
  prices: InferPx[]
  meta: InferMeta
  bookDays?: InferBookDay[]
  nhci?: InferNhci[]
}): StrategyInference {
  const { opens, positions, prices, meta, bookDays = [], nhci = [] } = input
  const ind = buildIndicators(prices)

  const openBy = new Map<string, InferOpen>()
  const openCount = new Map<string, number>()
  for (const o of opens) {
    const k = `${o.product}|${o.date}`
    openBy.set(k, o)
    openCount.set(o.product, (openCount.get(o.product) ?? 0) + ((o.buyOpen + o.sellOpen) > 0 ? 1 : 0))
  }
  const active = [...openCount.entries()].filter(([, n]) => n >= 8).map(([p]) => p)
  const activeSet = new Set(active)
  const sectorOf = new Map<string, string>()
  for (const p of positions) {
    if (p.product && p.sector) sectorOf.set(p.product, p.sector)
  }

  const eligible: Array<{
    product: string
    sector: string
    date: string
    open: boolean
    long: boolean | null
    i: FlagInd
  }> = []
  for (const prod of active) {
    const series = ind.get(prod)
    if (!series) continue
    const sector = sectorOf.get(prod) ?? "其他"
    for (const [date, i] of series) {
      if (date < meta.from || date > meta.to) continue
      const o = openBy.get(`${prod}|${date}`)
      const buy = o?.buyOpen ?? 0
      const sell = o?.sellOpen ?? 0
      const opened = buy + sell > 0
      let long: boolean | null = null
      if (buy > sell * 1.2) long = true
      else if (sell > buy * 1.2) long = false
      eligible.push({ product: prod, sector, date, open: opened, long, i: i as FlagInd })
    }
  }

  const tests: PropTest[] = []
  const addProp = (
    spec: Omit<PropTest, "a" | "nOn" | "c" | "nOff">,
    rows: Array<{ open: boolean; signal: boolean | null }>,
  ) => {
    const t = collect2x2(rows)
    if (!t) return
    tests.push({ ...spec, ...t })
  }

  addProp({
    id: "open_above_ma20",
    family: "入场",
    supportTitle: "做多更常出现在价格站上 20 日均线时",
    rejectTitle: "排除「站上 20 日均线才做多」",
    supportDetail: (_t, on, off) => `有开多的日子里，价格在 MA20 上方的开仓率 ${pct(on)}，下方 ${pct(off)}。像趋势过滤，不是精确交叉信号。`,
    rejectDetail: (_t, on, off) => `MA20 上方开仓率 ${pct(on)}，下方 ${pct(off)}，与「均线上方做多」相反或无此纪律。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.ma20 != null ? d.i.close > d.i.ma20 : null,
  })))

  addProp({
    id: "open_above_ma60",
    family: "入场",
    supportTitle: "做多更常出现在价格站上 60 日均线时",
    rejectTitle: "排除「中期均线上方才做多」",
    supportDetail: (_t, on, off) => `MA60 上方开多率 ${pct(on)}，下方 ${pct(off)}。中期趋势过滤痕迹。`,
    rejectDetail: (_t, on, off) => `MA60 上方开多率 ${pct(on)} vs 下方 ${pct(off)}，不像中期均线过滤器。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.ma60 != null ? d.i.close > d.i.ma60 : null,
  })))

  addProp({
    id: "golden_cross",
    family: "入场",
    supportTitle: "20/60 日均线金叉日更常开多",
    rejectTitle: "排除「均线金叉开多」这条常见 CTA 规则",
    supportDetail: (_t, on, off) => `金叉日开多率 ${pct(on)}，非金叉 ${pct(off)}。成交上能看到交叉规则的痕迹（不必是唯一规则）。`,
    rejectDetail: (_t, on, off) => `金叉日开多率 ${pct(on)} vs ${pct(off)}，不像在用 MA20/MA60 金叉做入场。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.ma20 != null && d.i.ma60 != null ? d.i.golden : null,
  })))

  addProp({
    id: "breakout_20",
    family: "入场",
    supportTitle: "创 20 日新高时更常开多（突破）",
    rejectTitle: "排除「20 日新高突破开多」",
    supportDetail: (_t, on, off) => `新高日开多率 ${pct(on)}，其余 ${pct(off)}。偏 Donchian / 通道突破。`,
    rejectDetail: (_t, on, off) => `新高日开多率 ${pct(on)} vs ${pct(off)}，不是明显的 20 日突破策略。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.high20,
  })))

  addProp({
    id: "breakdown_20",
    family: "入场",
    supportTitle: "创 20 日新低时更常开空",
    rejectTitle: "排除「20 日新低开空」",
    supportDetail: (_t, on, off) => `新低日开空率 ${pct(on)}，其余 ${pct(off)}。`,
    rejectDetail: (_t, on, off) => `新低日开空率 ${pct(on)} vs ${pct(off)}，不像对称突破做空。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === false,
    signal: d.i.low20,
  })))

  addProp({
    id: "open_below_ma20_short",
    family: "入场",
    supportTitle: "做空更常出现在价格跌破 20 日均线时",
    rejectTitle: "排除「均线下方才做空」",
    supportDetail: (_t, on, off) => `MA20 下方开空率 ${pct(on)}，上方 ${pct(off)}。`,
    rejectDetail: (_t, on, off) => `MA20 下方开空率 ${pct(on)} vs 上方 ${pct(off)}，空头不像在用 20 日均线过滤。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === false,
    signal: d.i.ma20 != null ? d.i.close < d.i.ma20 : null,
  })))

  addProp({
    id: "death_cross",
    family: "入场",
    supportTitle: "20/60 日均线死叉日更常开空",
    rejectTitle: "排除「均线死叉开空」",
    supportDetail: (_t, on, off) => `死叉日开空率 ${pct(on)}，非死叉 ${pct(off)}。`,
    rejectDetail: (_t, on, off) => `死叉日开空率 ${pct(on)} vs ${pct(off)}，不像在用均线死叉做空。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === false,
    signal: d.i.ma20 != null && d.i.ma60 != null ? d.i.death : null,
  })))

  addProp({
    id: "follow_ret5",
    family: "入场",
    supportTitle: "开多与该品种 5 日涨跌同向（短动量）",
    rejectTitle: "排除「跟着 5 日动量做多」",
    supportDetail: (_t, on, off) => `近 5 日上涨时开多率 ${pct(on)}，下跌时 ${pct(off)}。`,
    rejectDetail: (_t, on, off) => `5 日上涨时开多率 ${pct(on)} vs ${pct(off)}。`,
    oppositeTitle: "开多更常出现在 5 日回调后（短周期反转）",
    oppositeDetail: (_t, on, off) => `近 5 日上涨时开多率 ${pct(on)}，下跌时 ${pct(off)}。更像短线逆势。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.ret5 == null ? null : d.i.ret5 > 0,
  })))

  addProp({
    id: "follow_ret20",
    family: "入场",
    supportTitle: "开多方向与该品种 20 日涨跌同向（时间序列动量）",
    rejectTitle: "排除「跟着 20 日动量做多」",
    supportDetail: (_t, on, off) => `品种近 20 日上涨时开多率 ${pct(on)}，下跌时 ${pct(off)}。典型 TSMOM。`,
    rejectDetail: (_t, on, off) => `20 日上涨时开多率 ${pct(on)}，下跌时 ${pct(off)}。`,
    oppositeTitle: "开多更常出现在 20 日下跌之后（偏反转）",
    oppositeDetail: (_t, on, off) => `20 日上涨时开多率 ${pct(on)}，下跌时 ${pct(off)}。更像逆 20 日动量，不是趋势跟随。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.ret20 == null ? null : d.i.ret20 > 0,
  })))

  addProp({
    id: "follow_ret60",
    family: "入场",
    supportTitle: "开多与该品种 60 日涨跌同向（中期动量）",
    rejectTitle: "排除「跟着 60 日动量做多」",
    supportDetail: (_t, on, off) => `近 60 日上涨时开多率 ${pct(on)}，下跌时 ${pct(off)}。`,
    rejectDetail: (_t, on, off) => `60 日上涨时开多率 ${pct(on)} vs ${pct(off)}。`,
    oppositeTitle: "开多更常出现在 60 日下跌之后（中期反转）",
    oppositeDetail: (_t, on, off) => `60 日上涨时开多率 ${pct(on)}，下跌时 ${pct(off)}。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.ret60 == null ? null : d.i.ret60 > 0,
  })))

  addProp({
    id: "short_follow_ret20",
    family: "入场",
    supportTitle: "开空与该品种 20 日跌势同向（空头动量）",
    rejectTitle: "排除「跟着 20 日下跌开空」",
    supportDetail: (_t, on, off) => `近 20 日下跌时开空率 ${pct(on)}，上涨时 ${pct(off)}。`,
    rejectDetail: (_t, on, off) => `20 日下跌时开空率 ${pct(on)} vs ${pct(off)}，空头不像在追跌。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === false,
    signal: d.i.ret20 == null ? null : d.i.ret20 < 0,
  })))

  addProp({
    id: "rsi_oversold_long",
    family: "入场",
    supportTitle: "RSI<30 时更常开多（超卖过滤 / 反转）",
    rejectTitle: "排除「RSI 超卖才做多」",
    supportDetail: (_t, on, off) => `RSI14<30 时开多率 ${pct(on)}，其余 ${pct(off)}。`,
    rejectDetail: (_t, on, off) => `超卖日开多率 ${pct(on)} vs ${pct(off)}，不像 RSI 抄底。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.rsi14 == null ? null : d.i.rsi14 < 30,
  })))

  addProp({
    id: "rsi_overbought_long",
    family: "过滤",
    invert: true,
    supportTitle: "RSI>70 时显著更少开多（超买过滤）",
    rejectTitle: "排除「超买少做多」",
    supportDetail: (_t, on, off) => `RSI>70 开多率 ${pct(on)}，其余 ${pct(off)}。像过热刹车，不是打分核心。`,
    rejectDetail: (_t, on, off) => `RSI>70 开多率 ${pct(on)} vs ${pct(off)}。`,
    oppositeTitle: "RSI>70 时仍更常开多（追涨，没有超买刹车）",
    oppositeDetail: (_t, on, off) => `RSI>70 开多率 ${pct(on)} vs 其余 ${pct(off)}。追涨，不是超买禁止。`,
  }, eligible.map((d) => ({
    open: d.open && d.long === true,
    signal: d.i.rsi14 == null ? null : d.i.rsi14 > 70,
  })))

  addProp({
    id: "skip_high_vol",
    family: "过滤",
    invert: true,
    supportTitle: "品种 20 日波动最高一档时显著更少开仓（波动上限）",
    rejectTitle: "排除「高波动就不做」",
    supportDetail: (_t, on, off) => `高波动日开仓率 ${pct(on)}，其余 ${pct(off)}。像波动预算 / 不在极端 σ 开新仓。`,
    rejectDetail: (_t, on, off) => `高波动日开仓率 ${pct(on)} vs ${pct(off)}，没有波动上限过滤。`,
    oppositeTitle: "高波动档反而更常开仓（波动扩张交易）",
    oppositeDetail: (_t, on, off) => `高波动日开仓率 ${pct(on)}，其余 ${pct(off)}。不像在躲波动，更像吃波动。`,
  }, eligible.map((d) => ({
    open: d.open,
    signal: d.i.hiVol == null ? null : d.i.hiVol === true,
  })))

  addProp({
    id: "skip_low_vol",
    family: "过滤",
    invert: true,
    supportTitle: "品种波动最低一档更少开仓（波动地板，嫌市场太静）",
    rejectTitle: "排除「低波动不做」",
    supportDetail: (_t, on, off) => `低波动日开仓率 ${pct(on)}，其余 ${pct(off)}。`,
    rejectDetail: (_t, on, off) => `低波动日开仓率 ${pct(on)} vs ${pct(off)}。`,
  }, eligible.map((d) => ({
    open: d.open,
    signal: d.i.loVol == null ? null : d.i.loVol === true,
  })))

  addProp({
    id: "skip_low_liq",
    family: "过滤",
    invert: true,
    supportTitle: "成交量最低一档显著更少开仓（流动性过滤）",
    rejectTitle: "排除「只在流动性差时回避」；低量日开仓并不更少",
    supportDetail: (_t, on, off) => `低量日开仓率 ${pct(on)}，其余 ${pct(off)}。像先过滤流动性再打分。`,
    rejectDetail: (_t, on, off) => `低量日开仓率 ${pct(on)} vs ${pct(off)}，成交上看不到流动性门槛。`,
  }, eligible.map((d) => ({
    open: d.open,
    signal: d.i.loLiq == null ? null : d.i.loLiq === true,
  })))

  const sectors = [...new Set(eligible.map((d) => d.sector).filter((s) => s && s !== "其他"))]
  for (const sector of sectors) {
    const rows = eligible.filter((d) => d.sector === sector)
    addProp({
      id: `skip_high_vol:${sector}`,
      family: "过滤",
      invert: true,
      supportTitle: `${sector}板块高波动时显著更少开仓`,
      rejectTitle: `排除「${sector}有波动上限」`,
      supportDetail: (_t, on, off) => `${sector} 高波动日开仓率 ${pct(on)}，其余 ${pct(off)}。`,
      rejectDetail: (_t, on, off) => `${sector} 高波动日开仓率 ${pct(on)} vs ${pct(off)}。`,
    }, rows.map((d) => ({
      open: d.open,
      signal: d.i.hiVol == null ? null : d.i.hiVol === true,
    })))
    addProp({
      id: `skip_low_liq:${sector}`,
      family: "过滤",
      invert: true,
      supportTitle: `${sector}板块低流动性时显著更少开仓`,
      rejectTitle: `排除「${sector}有流动性门槛」`,
      supportDetail: (_t, on, off) => `${sector} 低量日开仓率 ${pct(on)}，其余 ${pct(off)}。`,
      rejectDetail: (_t, on, off) => `${sector} 低量日开仓率 ${pct(on)} vs ${pct(off)}。`,
    }, rows.map((d) => ({
      open: d.open,
      signal: d.i.loLiq == null ? null : d.i.loLiq === true,
    })))
  }

  type Cand = InferFinding & { p: number; keep: boolean }
  const cands: Cand[] = []

  for (const t of tests) {
    const st = twoProp(t.a, t.nOn, t.c, t.nOff)
    if (!effectOk(st.pOn, st.pOff, st.or)) continue
    const invert = Boolean(t.invert)
    const supportsHypothesis = invert ? st.pOn < st.pOff : st.pOn > st.pOff
    let stance: "support" | "reject"
    let title: string
    let detail: string
    if (supportsHypothesis) {
      stance = "support"
      title = t.supportTitle
      detail = t.supportDetail(t, st.pOn, st.pOff)
    } else if (t.oppositeTitle) {
      stance = "support"
      title = t.oppositeTitle
      detail = (t.oppositeDetail ?? t.rejectDetail)(t, st.pOn, st.pOff)
    } else {
      stance = "reject"
      title = t.rejectTitle
      detail = t.rejectDetail(t, st.pOn, st.pOff)
    }
    cands.push({
      id: t.id,
      family: t.family,
      stance,
      title,
      detail: `${detail} OR=${fmtOr(st.or)}，开仓 ${t.a}/${t.nOn} vs ${t.c}/${t.nOff}。`,
      q: null,
      stat: `p=${st.p < 0.001 ? "<0.001" : st.p.toFixed(3)}`,
      p: st.p,
      keep: true,
    })
  }

  // Inverse-vol weights
  const wX: number[] = []
  const wInv: number[] = []
  const wVol: number[] = []
  const wProd: string[] = []
  const lotX: number[] = []
  const lotInv: number[] = []
  const byDate = new Map<string, InferPos[]>()
  for (const p of positions) {
    if (!activeSet.has(p.product) && activeSet.size) {
      // still allow all products with prices
    }
    const list = byDate.get(p.date) ?? []
    list.push(p)
    byDate.set(p.date, list)
  }
  for (const [date, rows] of byDate) {
    const gross = rows.reduce((s, r) => s + Math.abs(r.mv), 0)
    if (gross <= 0 || rows.length < 3) continue
    for (const r of rows) {
      const i = ind.get(r.product)?.get(date) as FlagInd | undefined
      if (!i?.vol20 || i.vol20 < 1e-8) continue
      const inv = 1 / i.vol20
      wX.push(Math.abs(r.mv) / gross)
      wInv.push(inv)
      wVol.push(i.vol20)
      wProd.push(r.product)
      lotX.push(Math.abs(r.buyLots) + Math.abs(r.sellLots))
      lotInv.push(inv)
    }
  }
  const spW = spearman(wX, wInv)
  if (spW && Math.abs(spW.rho) >= 0.22) {
    cands.push({
      id: "inv_vol_weight",
      family: "仓位",
      stance: "support",
      title: spW.rho > 0 ? "品种之间高波动合约市值权重更小（截面 1/σ）" : "品种之间高波动合约市值权重更大，不像风险平价",
      detail: `同一天里 |市值权重| 与该品种 1/σ20 的 Spearman ρ=${spW.rho.toFixed(2)}（n=${spW.n} 个品种日）。这是截面分配：RB 比 AU 更吵就少配一点钱，不是把整本账户的杠杆/回撤压下去。${spW.rho > 0 ? "更像品种层风险平价。" : "没有压高波动品种。"}`,
      q: null,
      stat: `ρ=${spW.rho.toFixed(2)}，p=${spW.p < 0.001 ? "<0.001" : spW.p.toFixed(3)}`,
      p: spW.p,
      keep: true,
    })
  }
  const spL = spearman(lotX, lotInv)
  if (spL && Math.abs(spL.rho) >= 0.22) {
    cands.push({
      id: "inv_vol_lots",
      family: "仓位",
      stance: "support",
      title: spL.rho > 0 ? "手数也与 1/σ20 正相关" : "手数不随波动缩小，高波动品种手数更大",
      detail: `手数 vs 1/σ20，ρ=${spL.rho.toFixed(2)}（n=${spL.n}）。`,
      q: null,
      stat: `ρ=${spL.rho.toFixed(2)}，p=${spL.p < 0.001 ? "<0.001" : spL.p.toFixed(3)}`,
      p: spL.p,
      keep: true,
    })
  }

  let bookVolTested = 0
  const nhVol = rollingVol(nhci, 20)
  const univVol = new Map<string, number>()
  const volByDateAcc = new Map<string, number[]>()
  for (const [prod, series] of ind) {
    if (!activeSet.has(prod) && activeSet.size) continue
    for (const [date, i] of series) {
      if (i.vol20 == null || i.vol20 <= 0) continue
      const list = volByDateAcc.get(date) ?? []
      list.push(i.vol20)
      volByDateAcc.set(date, list)
    }
  }
  for (const [date, vs] of volByDateAcc) {
    const sorted = [...vs].sort((a, b) => a - b)
    univVol.set(date, sorted[Math.floor(sorted.length / 2)])
  }
  const bookByDate = new Map(bookDays.map((d) => [d.date, d]))
  const levX: number[] = []
  const mktY: number[] = []
  const ruX: number[] = []
  const riskX: number[] = []
  const bookDates: string[] = []
  for (const [date, rows] of byDate) {
    if (date < meta.from || date > meta.to) continue
    const book = bookByDate.get(date)
    if (!book || book.equity <= 0) continue
    const mkt = nhVol.get(date) ?? univVol.get(date)
    if (mkt == null || mkt <= 0) continue
    const gross = rows.reduce((s, r) => s + Math.abs(r.mv), 0)
    if (gross <= 0) continue
    const lev = gross / book.equity
    levX.push(lev)
    mktY.push(mkt)
    ruX.push(lev * mkt)
    riskX.push(book.riskPct)
    bookDates.push(date)
  }
  const spLev = spearman(levX, mktY)
  const spRu = spearman(ruX, mktY)
  const spRisk = spearman(riskX, mktY)
  if (spLev) bookVolTested += 1
  if (spRu) bookVolTested += 1
  const mktName = nhVol.size >= 20 ? "南华指数 20 日波动" : "品种池中位 20 日波动"
  let hiLev = 0
  let loLev = 0
  let hiRu = 0
  let loRu = 0
  let nHi = 0
  let nLo = 0
  if (mktY.length >= 20) {
    const vs = [...mktY].sort((a, b) => a - b)
    const hiCut = vs[Math.floor(vs.length * 0.8)]
    const loCut = vs[Math.floor(vs.length * 0.2)]
    const hiL: number[] = []
    const loL: number[] = []
    const hiR: number[] = []
    const loR: number[] = []
    for (let i = 0; i < mktY.length; i++) {
      if (mktY[i] >= hiCut) {
        hiL.push(levX[i])
        hiR.push(ruX[i])
      }
      if (mktY[i] <= loCut) {
        loL.push(levX[i])
        loR.push(ruX[i])
      }
    }
    hiLev = mean(hiL)
    loLev = mean(loL)
    hiRu = mean(hiR)
    loRu = mean(loR)
    nHi = hiL.length
    nLo = loL.length
  }
  const bucketBit = nHi >= 10 && nLo >= 10
    ? `高波动档平均总敞口 ${fmtX(hiLev)}（n=${nHi}），低波动档 ${fmtX(loLev)}（n=${nLo}）。`
    : ""
  const cutOk = Boolean(spLev && spLev.rho <= -0.2 && spLev.p <= 0.05)
  const addOk = Boolean(spLev && spLev.rho >= 0.2 && spLev.p <= 0.05)
  const riskUp = Boolean(spRu && spRu.rho >= 0.2 && spRu.p <= 0.05)
  const riskDn = Boolean(spRu && spRu.rho <= -0.2 && spRu.p <= 0.05)
  const riskPctBit = spRisk && Math.abs(spRisk.rho) >= 0.2 && spRisk.p <= 0.05
    ? ` 风险度 vs 市场波动 ρ=${spRisk.rho.toFixed(2)}。`
    : ""
  if (cutOk && spLev) {
    cands.push({
      id: "book_vol_cut",
      family: "风控",
      stance: "support",
      title: "市场波动升高时显著降低总敞口（组合层风险预算）",
      detail: `总敞口（持仓市值合计/权益）vs ${mktName}，Spearman ρ=${spLev.rho.toFixed(2)}（n=${spLev.n}）。${bucketBit}${
        riskUp ? "减了仓，但敞口×波动仍随市场波动上升，减得不够把风险打平。" : "组合风险没有随市场波动同比放大。"
      }${riskPctBit}这是整本账户的仓位，不是品种之间的 1/σ 分配。`,
      q: null,
      stat: `ρ=${spLev.rho.toFixed(2)}，p=${spLev.p < 0.001 ? "<0.001" : spLev.p.toFixed(3)}`,
      p: spLev.p,
      keep: true,
    })
  } else if (addOk && spLev) {
    cands.push({
      id: "book_vol_add",
      family: "风控",
      stance: "support",
      title: "市场波动升高时总敞口反而更大",
      detail: `总敞口 vs ${mktName}，ρ=${spLev.rho.toFixed(2)}（n=${spLev.n}）。${bucketBit}高波动时仓位没降反升，组合风险被放大。${riskPctBit}不是品种层 1/σ。`,
      q: null,
      stat: `ρ=${spLev.rho.toFixed(2)}，p=${spLev.p < 0.001 ? "<0.001" : spLev.p.toFixed(3)}`,
      p: spLev.p,
      keep: true,
    })
  } else if (riskUp && spRu) {
    cands.push({
      id: "book_vol_hold",
      family: "风控",
      stance: "support",
      title: "市场波动升高时总敞口不减，组合风险随波动上升",
      detail: `敞口×市场波动 vs ${mktName}，ρ=${spRu.rho.toFixed(2)}（n=${spRu.n}）。${
        spLev ? `总敞口本身 vs 波动 ρ=${spLev.rho.toFixed(2)}，没有显著减仓。` : ""
      }${bucketBit}${nHi >= 10 && loRu > 0 ? `高波动档风险单位约为低波动档的 ${(hiRu / loRu).toFixed(2)} 倍。` : ""}仓位扛着不动，波动来了风险就上去。${riskPctBit}这和品种之间谁多谁少是两件事。`,
      q: null,
      stat: `ρ=${spRu.rho.toFixed(2)}，p=${spRu.p < 0.001 ? "<0.001" : spRu.p.toFixed(3)}`,
      p: spRu.p,
      keep: true,
    })
  } else if (riskDn && spRu && !cutOk) {
    cands.push({
      id: "book_vol_overcut",
      family: "风控",
      stance: "support",
      title: "市场波动升高时组合风险不升反降（减仓过度）",
      detail: `敞口×波动 vs ${mktName}，ρ=${spRu.rho.toFixed(2)}（n=${spRu.n}）。${bucketBit}${riskPctBit}`,
      q: null,
      stat: `ρ=${spRu.rho.toFixed(2)}，p=${spRu.p < 0.001 ? "<0.001" : spRu.p.toFixed(3)}`,
      p: spRu.p,
      keep: true,
    })
  }

  const globalCands = cands.filter((c) => !c.id.includes(":"))
  const sleeveCands = cands.filter((c) => c.id.includes(":"))
  const qg = bhQ(globalCands.map((c) => c.p))
  globalCands.forEach((c, i) => { c.q = qg[i] })
  const qs = bhQ(sleeveCands.map((c) => c.p))
  sleeveCands.forEach((c, i) => { c.q = qs[i] })
  const shown = [...globalCands, ...sleeveCands].filter((c) => (c.q ?? 1) <= 0.1 && c.p <= 0.05)

  const supported = shown.filter((c) => c.stance === "support").map(({ keep, p, ...rest }) => rest)
  const rejected = shown.filter((c) => c.stance === "reject").map(({ keep, p, ...rest }) => rest)

  // Structural conflicts / facts (no p-value, always available)
  const structuralReject: InferFinding[] = []
  const structuralSupport: InferFinding[] = []
  const hold = meta.medianHold
  if (hold != null) {
    if (hold >= 2) {
      structuralReject.push({
        id: "not_intraday",
        family: "周期",
        stance: "reject",
        title: "排除纯日内刮头皮",
        detail: `平仓持仓中位数 ${hold.toFixed(1)} 天，不是当天进出的高频。`,
        q: null,
        stat: `中位数 ${hold.toFixed(1)} 天`,
      })
    } else if (hold <= 0.5) {
      structuralSupport.push({
        id: "intraday",
        family: "周期",
        stance: "support",
        title: "持仓以当日为主",
        detail: `平仓中位数 ${hold.toFixed(1)} 天，更像日内 / 隔夜极短。`,
        q: null,
        stat: `中位数 ${hold.toFixed(1)} 天`,
      })
    }
    if (hold >= 2 && hold <= 8) {
      structuralSupport.push({
        id: "short_swing",
        family: "周期",
        stance: "support",
        title: "短周期持仓（约数日）",
        detail: `中位数 ${hold.toFixed(1)} 天，像短周期 CTA / 波段，不是 20 日以上的长趋势。`,
        q: null,
        stat: `中位数 ${hold.toFixed(1)} 天`,
      })
    }
    if (hold > 8) {
      structuralSupport.push({
        id: "medium_trend",
        family: "周期",
        stance: "support",
        title: "中长周期持仓",
        detail: `中位数 ${hold.toFixed(1)} 天，更接近经典中周期趋势。`,
        q: null,
        stat: `中位数 ${hold.toFixed(1)} 天`,
      })
    }
  }
  if (meta.hedgeAvg >= 0.45 && meta.lockShare < 0.08) {
    structuralSupport.push({
      id: "cross_hedge",
      family: "结构",
      stance: "support",
      title: "跨品种对冲，不是同合约锁仓",
      detail: `平均对冲度 ${(meta.hedgeAvg * 100).toFixed(0)}%，同合约双开 ${(meta.lockShare * 100).toFixed(0)}%。`,
      q: null,
      stat: `对冲度 ${(meta.hedgeAvg * 100).toFixed(0)}%`,
    })
  } else if (meta.lockShare >= 0.15) {
    structuralSupport.push({
      id: "lock",
      family: "结构",
      stance: "support",
      title: "同一合约双开占比高，偏锁仓 / 套利",
      detail: `双开 ${(meta.lockShare * 100).toFixed(0)}%。`,
      q: null,
      stat: `双开 ${(meta.lockShare * 100).toFixed(0)}%`,
    })
  } else if (meta.hedgeAvg < 0.18) {
    structuralSupport.push({
      id: "directional",
      family: "结构",
      stance: "support",
      title: "方向性持仓为主",
      detail: `平均对冲度 ${(meta.hedgeAvg * 100).toFixed(0)}%，不是多空市值对锁的组合。`,
      q: null,
      stat: `对冲度 ${(meta.hedgeAvg * 100).toFixed(0)}%`,
    })
  }
  if (meta.nightLotsShare >= 0 && meta.nightLotsShare < 0.12) {
    structuralSupport.push({
      id: "day_only",
      family: "过滤",
      stance: "support",
      title: "夜盘几乎不开（时段过滤）",
      detail: `夜盘成交手数占比 ${(meta.nightLotsShare * 100).toFixed(0)}%。`,
      q: null,
      stat: `夜盘 ${(meta.nightLotsShare * 100).toFixed(0)}%`,
    })
  } else if (meta.nightLotsShare > 0.55) {
    structuralSupport.push({
      id: "night_active",
      family: "过滤",
      stance: "support",
      title: "夜盘是主要成交时段",
      detail: `夜盘手数 ${(meta.nightLotsShare * 100).toFixed(0)}%。`,
      q: null,
      stat: `夜盘 ${(meta.nightLotsShare * 100).toFixed(0)}%`,
    })
  }

  // Universe stability
  const dates = [...new Set(opens.map((o) => o.date))].sort()
  if (dates.length >= 20) {
    const mid = dates[Math.floor(dates.length / 2)]
    const a = new Set(opens.filter((o) => o.date < mid && o.buyOpen + o.sellOpen > 0).map((o) => o.product))
    const b = new Set(opens.filter((o) => o.date >= mid && o.buyOpen + o.sellOpen > 0).map((o) => o.product))
    const inter = [...a].filter((x) => b.has(x)).length
    const union = new Set([...a, ...b]).size
    const jac = union ? inter / union : 0
    if (a.size >= 4 && b.size >= 4) {
      if (jac >= 0.7) {
        structuralSupport.push({
          id: "universe_stable",
          family: "品种池",
          stance: "support",
          title: "交易品种池前后半段高度重叠（稳定宇宙）",
          detail: `前半 ${a.size} 个品种、后半 ${b.size} 个，Jaccard ${jac.toFixed(2)}。不像在轮动题材。`,
          q: null,
          stat: `Jaccard ${jac.toFixed(2)}`,
        })
      } else if (jac <= 0.4) {
        structuralSupport.push({
          id: "universe_rotate",
          family: "品种池",
          stance: "support",
          title: "交易品种前后半段重叠低（轮动宇宙）",
          detail: `前半 ${a.size} 个、后半 ${b.size} 个，Jaccard ${jac.toFixed(2)}。池子在换。`,
          q: null,
          stat: `Jaccard ${jac.toFixed(2)}`,
        })
      }
    }
  }

  const sectorDates = [...new Set(opens.map((o) => o.date))].sort()
  if (sectorDates.length >= 20) {
    const mid = sectorDates[Math.floor(sectorDates.length / 2)]
    const sectorOfOpen = (prod: string) => sectorOf.get(prod) ?? "其他"
    const a = new Set(
      opens.filter((o) => o.date < mid && o.buyOpen + o.sellOpen > 0).map((o) => sectorOfOpen(o.product)).filter((s) => s !== "其他"),
    )
    const b = new Set(
      opens.filter((o) => o.date >= mid && o.buyOpen + o.sellOpen > 0).map((o) => sectorOfOpen(o.product)).filter((s) => s !== "其他"),
    )
    const inter = [...a].filter((x) => b.has(x)).length
    const union = new Set([...a, ...b]).size
    const jac = union ? inter / union : 0
    if (a.size >= 3 && b.size >= 3) {
      if (jac >= 0.75) {
        structuralSupport.push({
          id: "sector_stable",
          family: "品种池",
          stance: "support",
          title: "交易板块前后半段稳定",
          detail: `前半 ${[...a].join("、")}，后半 ${[...b].join("、")}，Jaccard ${jac.toFixed(2)}。`,
          q: null,
          stat: `Jaccard ${jac.toFixed(2)}`,
        })
      } else if (jac <= 0.45) {
        structuralSupport.push({
          id: "sector_rotate",
          family: "品种池",
          stance: "support",
          title: "交易板块前后半段在换",
          detail: `前半 ${[...a].join("、")}，后半 ${[...b].join("、")}，Jaccard ${jac.toFixed(2)}。`,
          q: null,
          stat: `Jaccard ${jac.toFixed(2)}`,
        })
      }
    }
  }

  const prodVolHits: string[] = []
  for (const prod of active) {
    const t = collect2x2(eligible.filter((d) => d.product === prod).map((d) => ({
      open: d.open,
      signal: d.i.hiVol == null ? null : d.i.hiVol === true,
    })))
    if (!t) continue
    const st = twoProp(t.a, t.nOn, t.c, t.nOff)
    if (st.p <= 0.01 && effectOk(st.pOn, st.pOff, st.or) && st.pOn < st.pOff) {
      prodVolHits.push(prod)
    }
  }
  if (prodVolHits.length) {
    structuralSupport.push({
      id: "product_vol_cap",
      family: "过滤",
      stance: "support",
      title: `这些品种高波动时更少开仓：${prodVolHits.join("、")}`,
      detail: "品种层 p≤0.01 且效应够大。可能是合约保证金/流动性约束，不一定写在策略里。",
      q: null,
      stat: `${prodVolHits.length} 个品种`,
    })
  }

  const hhis: number[] = []
  const nHeld: number[] = []
  for (const rows of byDate.values()) {
    const gross = rows.reduce((s, r) => s + Math.abs(r.mv), 0)
    if (gross <= 0) continue
    let hhi = 0
    let n = 0
    for (const r of rows) {
      const w = Math.abs(r.mv) / gross
      if (w <= 0) continue
      hhi += w * w
      n += 1
    }
    if (n >= 2) {
      hhis.push(hhi)
      nHeld.push(n)
    }
  }
  if (hhis.length >= 20) {
    const meanHhi = mean(hhis)
    const meanN = mean(nHeld)
    if (meanHhi >= 0.22) {
      structuralSupport.push({
        id: "weight_concentrated",
        family: "仓位",
        stance: "support",
        title: "组合权重偏集中，不是均匀撒网",
        detail: `日均持仓品种 ${meanN.toFixed(1)} 个，市值 HHI ${meanHhi.toFixed(2)}（1/HHI ≈ ${(1 / meanHhi).toFixed(1)} 个有效品种）。`,
        q: null,
        stat: `HHI ${meanHhi.toFixed(2)}`,
      })
    } else if (meanHhi <= 0.1 && meanN >= 8) {
      structuralSupport.push({
        id: "weight_diversified",
        family: "仓位",
        stance: "support",
        title: "组合权重分散，接近多品种配置",
        detail: `日均持仓 ${meanN.toFixed(1)} 个品种，市值 HHI ${meanHhi.toFixed(2)}。`,
        q: null,
        stat: `HHI ${meanHhi.toFixed(2)}`,
      })
    }
  }

  const allSupportRaw = [...supported, ...structuralSupport]
  const allRejectRaw = [...rejected, ...structuralReject]

  const TREND_IDS = new Set([
    "open_above_ma20", "open_above_ma60", "golden_cross", "breakout_20", "breakdown_20",
    "open_below_ma20_short", "death_cross", "follow_ret5", "follow_ret20", "follow_ret60", "short_follow_ret20",
  ])

  const collapse = (rows: InferFinding[]): InferFinding[] => {
    const trend = rows.filter((f) => TREND_IDS.has(f.id))
    const sleeveVol = rows.filter((f) => f.id.startsWith("skip_high_vol:") && f.stance === "support")
    const sleeveLiq = rows.filter((f) => f.id.startsWith("skip_low_liq:") && f.stance === "support")
    const rest = rows.filter((f) =>
      !TREND_IDS.has(f.id)
      && !f.id.startsWith("skip_high_vol:")
      && !f.id.startsWith("skip_low_liq:"),
    )
    const dropChase = trend.length >= 2
    const out = dropChase ? rest.filter((f) => f.id !== "rsi_overbought_long") : [...rest]
    if (trend.length >= 2) {
      const fade = trend.filter((f) => /反转/.test(f.title))
      const follow = trend.filter((f) => !/反转/.test(f.title))
      const core = follow.length >= fade.length ? follow : fade
      out.unshift({
        id: "trend_cluster",
        family: "入场",
        stance: "support",
        title: fade.length > follow.length
          ? "入场偏反转族（多个逆动量检验同时显著）"
          : "入场偏趋势族（均线 / 动量 / 突破同时显著）",
        detail: core.map((f) => f.title).join("；") + "。这些规则高度相关，当作同一族，不是多套独立策略。",
        q: null,
        stat: `${core.length} 条同向`,
      })
    } else {
      out.unshift(...trend)
    }
    if (sleeveVol.length) {
      out.push({
        id: "sector_vol_cap",
        family: "过滤",
        stance: "support",
        title: `这些板块高波动时更少开仓：${sleeveVol.map((f) => f.id.split(":")[1]).join("、")}`,
        detail: sleeveVol.map((f) => f.detail).join(" "),
        q: null,
        stat: `${sleeveVol.length} 个板块`,
      })
    }
    if (sleeveLiq.length) {
      out.push({
        id: "sector_liq_cap",
        family: "过滤",
        stance: "support",
        title: `这些板块低流动性时更少开仓：${sleeveLiq.map((f) => f.id.split(":")[1]).join("、")}`,
        detail: sleeveLiq.map((f) => f.detail).join(" "),
        q: null,
        stat: `${sleeveLiq.length} 个板块`,
      })
    }
    return out
  }

  const allSupport = collapse(allSupportRaw)
  const allReject = allRejectRaw.filter((f) => {
    if (f.id.includes(":")) return false
    if (f.id === "rsi_oversold_long" && allSupport.some((s) => s.id === "trend_cluster")) return false
    return true
  })

  const plan: string[] = []
  plan.push("先按成交结构分类，再对常见量化规则做假设检验：均线/突破/5·20·60 日动量、RSI、波动/流动性过滤（含板块层）、品种之间 1/σ 权重、组合层是否在市场波动升高时减总敞口、品种/板块池是否稳定。")
  if (hold != null) plan.push(`持仓中位数 ${hold.toFixed(1)} 天 → 先验当作${hold <= 1 ? "日内/超短" : hold <= 8 ? "短周期 CTA" : "中周期 CTA"}，用开仓日去证伪。`)
  if (meta.hedgeAvg >= 0.4) plan.push("对冲度偏高 → 先验当作多空组合，重点看过滤和仓位，而不是单边突破。")
  else plan.push("对冲度不高 → 先验当作方向性系统，检验是否趋势、是否突破、是否有波动上限。")
  plan.push("机器学习/打分核心通常还原不了；只报告成交里留下显著痕迹的过滤器和约束。不显著的规则不展示。相关的趋势规则会收成一族，避免每个账户看起来都一样。")

  const unclassified = [
    "为何选这个品种而不是同板块另一个（截面打分 / 模型部分）",
    "精确入场阈值、多因子合成权重",
    "止损是固定点数、ATR 还是时间止损（需要 tick 路径）",
  ]
  if (!shown.some((c) => /golden|breakout|ma20|ma60|follow_ret|trend_cluster/.test(c.id))) {
    unclassified.push("入场是否还有未检验的短周期均线或盘口信号（目前只测了 20/60 日和 5/20/60 日动量）")
  }

  const byId = (id: string) => allSupport.find((f) => f.id === id)
  const headlineBits = [
    byId("book_vol_cut") ?? byId("book_vol_hold") ?? byId("book_vol_add") ?? byId("book_vol_overcut"),
    byId("skip_high_vol"),
    byId("skip_low_liq"),
    byId("skip_low_vol"),
    byId("inv_vol_weight"),
    byId("day_only") ?? byId("night_active"),
    allSupport.find((f) => f.family === "周期"),
    byId("trend_cluster") ?? allSupport.find((f) => f.family === "入场"),
    byId("weight_concentrated") ?? byId("weight_diversified"),
  ].filter((x): x is InferFinding => Boolean(x))
  const seenHead = new Set<string>()
  const uniqueHead = headlineBits.filter((f) => {
    if (seenHead.has(f.id)) return false
    seenHead.add(f.id)
    return true
  })
  const headline = uniqueHead.length
    ? uniqueHead.slice(0, 2).map((f) => f.title).join("；")
    : (allSupport[0]?.title ?? "成交里没有过门槛的公开规则痕迹")

  const conclusions: string[] = []
  const cycle = allSupport.find((f) => f.family === "周期")
  const struct = allSupport.find((f) => f.family === "结构")
  if (cycle || struct) {
    conclusions.push([cycle?.detail, struct?.detail].filter(Boolean).join(" "))
  }
  const entries = allSupport.filter((f) => f.family === "入场")
  const entryRejects = allReject.filter((f) => f.family === "入场")
  if (entries.length) {
    conclusions.push(`入场痕迹：${entries.map((f) => f.title).join("；")}。`)
  } else if (entryRejects.length) {
    conclusions.push(`常见均线/突破/动量入场大多对不上：${entryRejects.slice(0, 3).map((f) => f.title).join("；")}。入场更可能在未公开的打分里。`)
  }
  const filts = allSupport.filter((f) => f.family === "过滤")
  if (filts.length) {
    conclusions.push(`过滤器：${filts.map((f) => f.title).join("；")}。这类约束比预测模型更容易从成交还原。`)
  }
  const riskMgmt = allSupport.filter((f) => f.family === "风控")
  if (riskMgmt.length) {
    conclusions.push(`组合风控：${riskMgmt.map((f) => f.title).join("；")}。`)
  }
  const sizes = allSupport.filter((f) => f.family === "仓位")
  if (sizes.length) {
    conclusions.push(`仓位：${sizes.map((f) => f.title).join("；")}。`)
  }
  const univ = allSupport.filter((f) => f.family === "品种池")
  if (univ.length) {
    conclusions.push(univ.map((f) => f.detail).join(" "))
  }
  if (!conclusions.length) {
    conclusions.push("这一区间没有过门槛的规则痕迹。可能样本短，或入场不落在上述公开规则上。")
  }

  return {
    headline,
    conclusions,
    plan,
    unclassified,
    supported: allSupport,
    rejected: allReject,
    tested: tests.length + (spW ? 1 : 0) + (spL ? 1 : 0) + bookVolTested,
    shown: allSupport.length + allReject.length,
    charts: {
      bookVol: levX.length >= 10
        ? {
          mktName,
          rho: spLev?.rho ?? null,
          p: spLev?.p ?? null,
          n: levX.length,
          points: bookDates.map((d, i) => ({
            date: d,
            mktVol: r2(annVolPct(mktY[i]!)),
            leverage: r3(levX[i]!),
          })),
          buckets: quintileMeans(mktY.map(annVolPct), levX),
        }
        : null,
      crossVol: wX.length >= 20
        ? {
          rho: spW?.rho ?? null,
          p: spW?.p ?? null,
          n: wX.length,
          points: strideSample(
            wX.map((w, i) => ({
              product: wProd[i]!,
              vol: r2(annVolPct(wVol[i]!)),
              weight: r3(w * 100),
            })),
            900,
          ),
          buckets: quintileMeans(wVol.map(annVolPct), wX.map((w) => w * 100)),
        }
        : null,
    },
  }
}

export const AKSHARE_CONTINUOUS: Record<string, string> = {
  A: "A0.DCE", AD: "AD0.SHF", AG: "AG0.SHF", AL: "AL0.SHF", AO: "AO0.SHF", AP: "AP0.CZC",
  AU: "AU0.SHF", B: "B0.DCE", BB: "BB0.DCE", BC: "BCM.INE", BR: "BR0.SHF", BU: "BU0.SHF",
  BZ: "BZ0.DCE", C: "C0.DCE", CF: "CF0.CZC", CJ: "CJ0.CZC", CS: "CS0.DCE", CU: "CU0.SHF",
  CY: "CY0.CZC", EB: "EB0.DCE", EC: "ECM.INE", EG: "EG0.DCE", FB: "FB0.DCE", FG: "FG0.CZC",
  FU: "FU0.SHF", HC: "HC0.SHF", I: "I0.DCE", IC: "IC0.CFE", IF: "IF0.CFE", IH: "IH0.CFE",
  IM: "IM0.CFE", J: "J0.DCE", JD: "JD0.DCE", JM: "JM0.DCE", JR: "JR0.CZC", L: "L0.DCE",
  LC: "LCM.GFE", LG: "LG0.DCE", LH: "LH0.DCE", LR: "LR0.CZC", LU: "LUM.INE", M: "M0.DCE",
  MA: "MA0.CZC", NI: "NI0.SHF", NR: "NRM.INE", OI: "OI0.CZC", OP: "OP0.SHF", P: "P0.DCE",
  PB: "PB0.SHF", PD: "PDM.GFE", PF: "PF0.CZC", PG: "PG0.DCE", PK: "PK0.CZC", PL: "PL0.CZC",
  PM: "PM0.CZC", PP: "PP0.DCE", PR: "PR0.CZC", PS: "PSM.GFE", PT: "PTM.GFE", PX: "PX0.CZC",
  RB: "RB0.SHF", RI: "RI0.CZC", RM: "RM0.CZC", RR: "RR0.DCE", RS: "RS0.CZC", RU: "RU0.SHF",
  SA: "SA0.CZC", SC: "SCM.INE", SF: "SF0.CZC", SH: "SH0.CZC", SI: "SIM.GFE", SM: "SM0.CZC",
  SN: "SN0.SHF", SP: "SP0.SHF", SR: "SR0.CZC", SS: "SS0.SHF", TA: "TA0.CZC", T: "T0.CFE",
  TF: "TF0.CFE", TL: "TL0.CFE", TS: "TS0.CFE", UR: "UR0.CZC", V: "V0.DCE", WH: "WH0.CZC",
  WR: "WR0.SHF", Y: "Y0.DCE", ZC: "ZC0.CZC", ZN: "ZN0.SHF",
}

export function productFromAkshare(code: string): string {
  const c = code.trim().toUpperCase()
  for (const [prod, ak] of Object.entries(AKSHARE_CONTINUOUS)) {
    if (ak === c) return prod
  }
  return c.split(".")[0]?.replace(/[0M]$/, "") ?? c
}
