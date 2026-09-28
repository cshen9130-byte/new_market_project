/**
 * Scatter charts of linear rules in a trader's book.
 * Many candidate pairs are tested. A chart is kept only when the Pearson
 * relation is significant after BH, still there once tails are clipped,
 * and the quintile means actually walk in a straight-looking line.
 * Same-family pairs (5-day vs 20-day momentum, and so on) keep the steepest
 * one, and at most four charts are returned. Traders therefore get different
 * counts, including zero.
 *
 * X is known from the previous close. Same-day close is not used to explain
 * the same day's position.
 */

export type LinearKind = "pct" | "pct0" | "x" | "num" | "rsi" | "z"

export type LinearScatterChart = {
  id: string
  title: string
  detail: string
  xName: string
  yName: string
  xKind: LinearKind
  yKind: LinearKind
  rho: number
  p: number
  q: number
  n: number
  points: { x: number; y: number; label: string }[]
  bins: { x: number; y: number }[]
  line: { x0: number; y0: number; x1: number; y1: number }
}

export type LinearScatterReport = {
  tested: number
  shown: number
  headline: string
  charts: LinearScatterChart[]
}

export type LinearBookDay = {
  date: string
  equity: number
  pnl: number
  riskPct: number
  ddPct: number
}

export type LinearPos = {
  date: string
  product: string
  buyLots: number
  sellLots: number
  mv: number
  longMv: number
  shortMv: number
}

export type LinearOpen = {
  date: string
  product: string
  buyOpen: number
  sellOpen: number
}

export type LinearPx = {
  product: string
  date: string
  close: number
  volume: number
}

export type LinearNhci = { date: string; close: number }

export type LinearContract = {
  date: string
  product: string
  rk: number
  px: number
  oi: number
  doi: number
}

type Kind = LinearKind

type Candidate = {
  id: string
  family: string
  level: "day" | "product"
  xName: string
  yName: string
  xKind: Kind
  yKind: Kind
  title: (rho: number) => string
  detail: (rho: number) => string
  xs: number[]
  ys: number[]
  labels: string[]
  groups?: string[]
}

type Feat = {
  ret5: number | null
  ret20: number | null
  ret60: number | null
  vol20: number | null
  rsi: number | null
  maDist: number | null
  volRatio: number | null
}

const MAX_CHARTS = 4
const POINT_CAP = 420

export function emptyLinearScatters(headline = "样本不够，没有做直线筛选。"): LinearScatterReport {
  return { tested: 0, shown: 0, headline, charts: [] }
}

function ymd(s: string): string {
  return s.slice(0, 10)
}

function mean(xs: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < xs.length; i++) s += xs[i]!
  return xs.length ? s / xs.length : 0
}

function stdev(xs: ArrayLike<number>): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (let i = 0; i < xs.length; i++) {
    const d = xs[i]! - m
    s += d * d
  }
  return Math.sqrt(s / (xs.length - 1))
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

function pearson(xs: ArrayLike<number>, ys: ArrayLike<number>): number | null {
  const n = xs.length
  if (n < 8 || ys.length !== n) return null
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i]! - mx
    const y = ys[i]! - my
    num += x * y
    dx += x * x
    dy += y * y
  }
  const den = Math.sqrt(dx * dy)
  if (den < 1e-12) return null
  return num / den
}

function pearsonP(r: number, n: number): number {
  if (n < 5) return 1
  if (Math.abs(r) >= 0.999) return 0
  const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r))
  return twoSidedP(t)
}

function bhQ(ps: number[]): number[] {
  const n = ps.length
  if (!n) return []
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const q = Array(n).fill(1)
  let running = 1
  for (let k = n; k >= 1; k--) {
    running = Math.min(running, (order[k - 1]!.p * n) / k)
    q[order[k - 1]!.i] = running
  }
  return q
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const idx = (sorted.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.min(sorted.length - 1, lo + 1)
  const w = idx - lo
  return sorted[lo]! * (1 - w) + sorted[hi]! * w
}

function clampSeries(xs: number[], loQ = 0.02, hiQ = 0.98): { values: number[]; lo: number; hi: number } {
  const sorted = [...xs].sort((a, b) => a - b)
  const lo = quantile(sorted, loQ)
  const hi = quantile(sorted, hiQ)
  return {
    lo,
    hi,
    values: xs.map((v) => Math.min(hi, Math.max(lo, v))),
  }
}

function ols(xs: ArrayLike<number>, ys: ArrayLike<number>): { a: number; b: number; r2: number } | null {
  const n = xs.length
  if (n < 3 || ys.length !== n) return null
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i]!
    const y = ys[i]!
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
  }
  const den = n * sxx - sx * sx
  if (Math.abs(den) < 1e-12) return null
  const b = (n * sxy - sx * sy) / den
  const a = (sy - b * sx) / n
  let rss = 0
  let tss = 0
  const my = sy / n
  for (let i = 0; i < n; i++) {
    const e = ys[i]! - (a + b * xs[i]!)
    rss += e * e
    const d = ys[i]! - my
    tss += d * d
  }
  if (tss < 1e-12) return null
  return { a, b, r2: 1 - rss / tss }
}

function solve3(
  a00: number, a01: number, a02: number,
  a10: number, a11: number, a12: number,
  a20: number, a21: number, a22: number,
  b0: number, b1: number, b2: number,
): [number, number, number] | null {
  const m = [
    [a00, a01, a02, b0],
    [a10, a11, a12, b1],
    [a20, a21, a22, b2],
  ]
  for (let col = 0; col < 3; col++) {
    let piv = col
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r
    }
    if (Math.abs(m[piv]![col]!) < 1e-12) return null
    if (piv !== col) {
      const tmp = m[col]!
      m[col] = m[piv]!
      m[piv] = tmp
    }
    const div = m[col]![col]!
    for (let c = col; c < 4; c++) m[col]![c] = m[col]![c]! / div
    for (let r = 0; r < 3; r++) {
      if (r === col) continue
      const f = m[r]![col]!
      for (let c = col; c < 4; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!
    }
  }
  return [m[0]![3]!, m[1]![3]!, m[2]![3]!]
}

function quadR2(xs: ArrayLike<number>, ys: ArrayLike<number>): number | null {
  const n = xs.length
  if (n < 12 || ys.length !== n) return null
  const mx = mean(xs)
  let s1 = 0
  let s2 = 0
  let s3 = 0
  let s4 = 0
  let t0 = 0
  let t1 = 0
  let t2 = 0
  for (let i = 0; i < n; i++) {
    const z = xs[i]! - mx
    const z2 = z * z
    s1 += z
    s2 += z2
    s3 += z2 * z
    s4 += z2 * z2
    t0 += ys[i]!
    t1 += ys[i]! * z
    t2 += ys[i]! * z2
  }
  const coef = solve3(n, s1, s2, s1, s2, s3, s2, s3, s4, t0, t1, t2)
  if (!coef) return null
  const [a, b, c] = coef
  let rss = 0
  let tss = 0
  const my = t0 / n
  for (let i = 0; i < n; i++) {
    const z = xs[i]! - mx
    const yhat = a + b * z + c * z * z
    const e = ys[i]! - yhat
    rss += e * e
    const d = ys[i]! - my
    tss += d * d
  }
  if (tss < 1e-12) return null
  return 1 - rss / tss
}

function uniqueRounded(xs: ArrayLike<number>, digits = 3): number {
  const s = new Set<string>()
  for (let i = 0; i < xs.length; i++) s.add(xs[i]!.toFixed(digits))
  return s.size
}

function quintileXY(xs: number[], ys: number[]): { x: number; y: number }[] {
  const n = xs.length
  if (n < 25) return []
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const means: { x: number; y: number }[] = []
  for (let q = 0; q < 5; q++) {
    const a = Math.floor((n * q) / 5)
    const b = Math.floor((n * (q + 1)) / 5)
    if (b - a < 3) return []
    let sx = 0
    let sy = 0
    for (let k = a; k < b; k++) {
      sx += xs[order[k]!.i]!
      sy += ys[order[k]!.i]!
    }
    means.push({ x: sx / (b - a), y: sy / (b - a) })
  }
  return means
}

function looksLinear(bins: { y: number }[], sign: number): boolean {
  if (bins.length < 5) return false
  const end = bins[4]!.y - bins[0]!.y
  if (sign * end <= 0) return false
  const span = Math.abs(end)
  if (span < 1e-9) return false
  let maxStep = 0
  for (let i = 1; i < 5; i++) {
    const d = bins[i]!.y - bins[i - 1]!.y
    if (sign * d < 0 && Math.abs(d) > 0.22 * span) return false
    maxStep = Math.max(maxStep, Math.abs(d))
  }
  return maxStep <= 0.85 * span
}

function minAbsR(n: number, level: "day" | "product"): number {
  if (level === "product") return n >= 200 ? 0.42 : 0.5
  if (n < 45) return 0.55
  if (n < 80) return 0.45
  return 0.4
}

function withinPearson(
  xs: number[],
  ys: number[],
  groups: string[],
): { rho: number; n: number } | null {
  const acc = new Map<string, { sx: number; sy: number; n: number }>()
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!
    const row = acc.get(g) ?? { sx: 0, sy: 0, n: 0 }
    row.sx += xs[i]!
    row.sy += ys[i]!
    row.n += 1
    acc.set(g, row)
  }
  const dx: number[] = []
  const dy: number[] = []
  for (let i = 0; i < groups.length; i++) {
    const row = acc.get(groups[i]!)
    if (!row || row.n < 8) continue
    dx.push(xs[i]! - row.sx / row.n)
    dy.push(ys[i]! - row.sy / row.n)
  }
  const rho = pearson(dx, dy)
  if (rho == null) return null
  return { rho, n: dx.length }
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000
}

function stride<T>(arr: T[], cap: number): T[] {
  if (arr.length <= cap) return arr
  const step = arr.length / cap
  const out: T[] = []
  for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]!)
  return out
}

type Passed = {
  cand: Candidate
  rho: number
  p: number
  q: number
  n: number
  a: number
  b: number
  xs: number[]
  ys: number[]
  labels: string[]
  bins: { x: number; y: number }[]
}

function evaluate(cand: Candidate): { p: number; passed: Omit<Passed, "q"> | null; reason: string } | null {
  const n0 = cand.xs.length
  const minN = cand.level === "day" ? 30 : 80
  if (n0 < minN || cand.ys.length !== n0) return null
  if (uniqueRounded(cand.xs) < 6 || uniqueRounded(cand.ys) < 6) return { p: 1, passed: null, reason: "取值太少" }
  const cx = clampSeries(cand.xs)
  const cy = clampSeries(cand.ys)
  const rho = pearson(cx.values, cy.values)
  if (rho == null || !Number.isFinite(rho)) return null
  const raw = pearson(cand.xs, cand.ys)
  const n = cx.values.length
  const p = pearsonP(rho, n)
  const sign = rho > 0 ? 1 : -1
  if (Math.abs(rho) < minAbsR(n, cand.level)) return { p, passed: null, reason: "斜率不够陡" }
  if (raw == null || Math.sign(raw) !== sign || Math.abs(raw) < 0.15) return { p, passed: null, reason: "全样本方向不稳" }
  if (p > 0.01) return { p, passed: null, reason: "p 不够小" }
  const fit = ols(cx.values, cy.values)
  if (!fit) return { p, passed: null, reason: "拟合失败" }
  const q2 = quadR2(cx.values, cy.values)
  if (q2 != null && q2 - fit.r2 > 0.12) return { p, passed: null, reason: "更像曲线" }
  const bins = quintileXY(cx.values, cy.values)
  if (!looksLinear(bins, sign)) return { p, passed: null, reason: "五档不是一条斜线" }
  const sortedX = [...cx.values].sort((a, b) => a - b)
  const move = Math.abs(fit.b * (quantile(sortedX, 0.9) - quantile(sortedX, 0.1)))
  if (move < 0.35 * stdev(cy.values)) return { p, passed: null, reason: "直线抬升太小" }
  if (cand.level === "product" && cand.groups && cand.groups.length === n0) {
    const within = withinPearson(cx.values, cy.values, cand.groups)
    if (!within || within.n < 60 || Math.sign(within.rho) !== sign || Math.abs(within.rho) < 0.2) {
      return { p, passed: null, reason: "品种内部对不上" }
    }
  }
  const shownX: number[] = []
  const shownY: number[] = []
  const shownL: string[] = []
  for (let i = 0; i < n0; i++) {
    const x = cand.xs[i]!
    const y = cand.ys[i]!
    if (x < cx.lo || x > cx.hi || y < cy.lo || y > cy.hi) continue
    shownX.push(x)
    shownY.push(y)
    shownL.push(cand.labels[i] ?? "")
  }
  if (shownX.length < 24) return { p, passed: null, reason: "去掉极端值后点太少" }
  return {
    p,
    reason: "",
    passed: { cand, rho, p, n, a: fit.a, b: fit.b, xs: shownX, ys: shownY, labels: shownL, bins },
  }
}

export function screenLinearCandidates(cands: Candidate[]): LinearScatterChart[] {
  const evals = cands.map((c) => ({ c, ev: evaluate(c) })).filter((x) => x.ev)
  const ps = evals.map((x) => x.ev!.p)
  const qs = bhQ(ps)
  const passed: Passed[] = []
  evals.forEach((x, i) => {
    const ev = x.ev!
    if (!ev.passed) return
    const q = qs[i] ?? 1
    if (q > 0.1) return
    passed.push({ ...ev.passed, q })
  })
  const best = new Map<string, Passed>()
  for (const row of passed) {
    const prev = best.get(row.cand.family)
    if (!prev || Math.abs(row.rho) > Math.abs(prev.rho)) best.set(row.cand.family, row)
  }
  const picked = [...best.values()].sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho)).slice(0, MAX_CHARTS)
  return picked.map((row) => {
    const pts = stride(
      row.xs.map((x, i) => ({ x, y: row.ys[i]!, label: row.labels[i]! })),
      POINT_CAP,
    )
    const xs = pts.map((p) => p.x).sort((a, b) => a - b)
    const x0 = quantile(xs, 0.05)
    const x1 = quantile(xs, 0.95)
    return {
      id: row.cand.id,
      title: row.cand.title(row.rho),
      detail: `ρ=${row.rho.toFixed(2)}，p${row.p < 0.001 ? "<0.001" : "=" + row.p.toFixed(3)}，q${row.q < 0.01 ? "<0.01" : "=" + row.q.toFixed(2)}，n=${row.n}。${row.cand.detail(row.rho)}红线是去掉两侧 2% 极端值后的最小二乘直线，黄点是五档均值。`,
      xName: row.cand.xName,
      yName: row.cand.yName,
      xKind: row.cand.xKind,
      yKind: row.cand.yKind,
      rho: r2(row.rho),
      p: row.p < 0.001 ? 0.001 : r4(row.p),
      q: row.q < 0.001 ? 0.001 : r4(row.q),
      n: row.n,
      points: pts.map((p) => ({ x: r4(p.x), y: r4(p.y), label: p.label })),
      bins: row.bins.map((b) => ({ x: r4(b.x), y: r4(b.y) })),
      line: { x0: r4(x0), y0: r4(row.a + row.b * x0), x1: r4(x1), y1: r4(row.a + row.b * x1) },
    }
  })
}

function sma(xs: number[], i: number, n: number): number | null {
  if (i + 1 < n) return null
  let s = 0
  for (let j = i - n + 1; j <= i; j++) s += xs[j]!
  return s / n
}

function rsi14(closes: number[], i: number): number | null {
  if (i < 14) return null
  let up = 0
  let dn = 0
  for (let j = i - 13; j <= i; j++) {
    const d = closes[j]! - closes[j - 1]!
    if (d > 0) up += d
    else dn -= d
  }
  const ad = dn / 14
  if (ad < 1e-12) return 100
  return 100 - 100 / (1 + up / 14 / ad)
}

function buildFeats(prices: LinearPx[]): Map<string, { date: string; feat: Feat }[]> {
  const byProd = new Map<string, LinearPx[]>()
  for (const r of prices) {
    if (r.close <= 0 || !r.product) continue
    const list = byProd.get(r.product) ?? []
    list.push(r)
    byProd.set(r.product, list)
  }
  const out = new Map<string, { date: string; feat: Feat }[]>()
  for (const [prod, rows] of byProd) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    const closes = sorted.map((r) => r.close)
    const series: { date: string; feat: Feat }[] = []
    for (let i = 0; i < sorted.length; i++) {
      let vol20: number | null = null
      if (i >= 10) {
        const slice: number[] = []
        for (let j = Math.max(1, i - 19); j <= i; j++) {
          const prev = closes[j - 1]!
          if (prev > 0) slice.push(closes[j]! / prev - 1)
        }
        if (slice.length >= 10) vol20 = stdev(slice) * Math.sqrt(252) * 100
      }
      const ma20 = sma(closes, i, 20)
      const volSma = sma(sorted.map((r) => r.volume), i, 20)
      series.push({
        date: ymd(sorted[i]!.date),
        feat: {
          ret5: i >= 5 && closes[i - 5]! > 0 ? (closes[i]! / closes[i - 5]! - 1) * 100 : null,
          ret20: i >= 20 && closes[i - 20]! > 0 ? (closes[i]! / closes[i - 20]! - 1) * 100 : null,
          ret60: i >= 60 && closes[i - 60]! > 0 ? (closes[i]! / closes[i - 60]! - 1) * 100 : null,
          vol20,
          rsi: rsi14(closes, i),
          maDist: ma20 != null && ma20 > 0 ? (closes[i]! / ma20 - 1) * 100 : null,
          volRatio: volSma != null && volSma > 0 ? sorted[i]!.volume / volSma : null,
        },
      })
    }
    out.set(prod, series)
  }
  return out
}

function lagMap<T>(series: { date: string; value: T }[]): Map<string, T> {
  const out = new Map<string, T>()
  let prev: T | null = null
  for (const row of series) {
    if (prev != null) out.set(row.date, prev)
    prev = row.value
  }
  return out
}

function pushPair(
  bag: { xs: number[]; ys: number[]; labels: string[]; groups?: string[] },
  x: number | null | undefined,
  y: number | null | undefined,
  label: string,
  group?: string,
) {
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return
  bag.xs.push(x)
  bag.ys.push(y)
  bag.labels.push(label)
  if (bag.groups && group) bag.groups.push(group)
}

function bag(withGroup = false): { xs: number[]; ys: number[]; labels: string[]; groups?: string[] } {
  return withGroup
    ? { xs: [], ys: [], labels: [], groups: [] }
    : { xs: [], ys: [], labels: [] }
}

function posTitle(rho: number, up: string, down: string): string {
  return rho >= 0 ? up : down
}

export function buildLinearScatters(input: {
  from: string
  to: string
  equity: LinearBookDay[]
  positions: LinearPos[]
  opens: LinearOpen[]
  prices: LinearPx[]
  nhci?: LinearNhci[]
  contracts?: LinearContract[]
}): LinearScatterReport {
  const from = ymd(input.from)
  const to = ymd(input.to)
  const feats = buildFeats(input.prices)
  const lagged = new Map<string, Map<string, Feat>>()
  for (const [prod, series] of feats) {
    lagged.set(prod, lagMap(series.map((r) => ({ date: r.date, value: r.feat }))))
  }

  const carryLag = new Map<string, Map<string, { carry: number; oiChg: number | null }>>()
  const byContract = new Map<string, Map<string, { front?: LinearContract; second?: LinearContract }>>()
  for (const c of input.contracts ?? []) {
    const date = ymd(c.date)
    const prod = c.product
    if (!prod || c.px <= 0) continue
    const days = byContract.get(prod) ?? new Map()
    const cell = days.get(date) ?? {}
    if (c.rk === 1) cell.front = c
    else if (c.rk === 2) cell.second = c
    days.set(date, cell)
    byContract.set(prod, days)
  }
  for (const [prod, days] of byContract) {
    const series = [...days.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, cell]) => {
        const front = cell.front
        if (!front || front.px <= 0) return null
        const carry = cell.second && cell.second.px > 0 ? (cell.second.px / front.px - 1) * 100 : null
        const oiChg = front.oi > 0 ? (front.doi / front.oi) * 100 : null
        if (carry == null && oiChg == null) return null
        return { date, value: { carry: carry ?? Number.NaN, oiChg } }
      })
      .filter((x): x is { date: string; value: { carry: number; oiChg: number | null } } => x != null)
    carryLag.set(prod, lagMap(series))
  }

  const nhSorted = [...(input.nhci ?? [])]
    .filter((r) => r.close > 0)
    .map((r) => ({ date: ymd(r.date), close: r.close }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const nhKnown: { date: string; vol: number | null; ret20: number | null; ret5: number | null; eff: number | null }[] = []
  const nhRets: number[] = []
  for (let i = 0; i < nhSorted.length; i++) {
    if (i >= 1 && nhSorted[i - 1]!.close > 0) nhRets.push(nhSorted[i]!.close / nhSorted[i - 1]!.close - 1)
    let vol: number | null = null
    if (nhRets.length >= 20) vol = stdev(nhRets.slice(nhRets.length - 20)) * Math.sqrt(252) * 100
    const ret20 = i >= 20 && nhSorted[i - 20]!.close > 0 ? (nhSorted[i]!.close / nhSorted[i - 20]!.close - 1) * 100 : null
    const ret5 = i >= 5 && nhSorted[i - 5]!.close > 0 ? (nhSorted[i]!.close / nhSorted[i - 5]!.close - 1) * 100 : null
    let eff: number | null = null
    if (i >= 20 && ret20 != null) {
      let path = 0
      for (let j = i - 19; j <= i; j++) {
        const prev = nhSorted[j - 1]!.close
        if (prev > 0) path += Math.abs(nhSorted[j]!.close / prev - 1)
      }
      if (path > 1e-8) eff = (Math.abs(ret20) / 100 / path) * 100
    }
    nhKnown.push({ date: nhSorted[i]!.date, vol, ret20, ret5, eff })
  }
  const nhLag = lagMap(nhKnown.map((r) => ({ date: r.date, value: r })))

  const posByDate = new Map<string, LinearPos[]>()
  for (const p of input.positions) {
    const date = ymd(p.date)
    if (date < from || date > to || !p.product) continue
    const list = posByDate.get(date) ?? []
    list.push(p)
    posByDate.set(date, list)
  }
  const openByDate = new Map<string, number>()
  for (const o of input.opens) {
    const date = ymd(o.date)
    if (date < from || date > to || !o.product) continue
    openByDate.set(date, (openByDate.get(date) ?? 0) + o.buyOpen + o.sellOpen)
  }

  const equity = [...input.equity]
    .map((d) => ({ ...d, date: ymd(d.date) }))
    .filter((d) => d.date >= from && d.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))

  type DayRow = {
    date: string
    lev: number | null
    hedge: number | null
    net: number | null
    absNet: number | null
    nProd: number
    hhi: number | null
    openPerWan: number | null
    ret: number | null
    ydayRet: number | null
    dLev: number | null
    dRisk: number | null
    ddLag: number | null
    ownVol: number | null
    mktVol: number | null
    mktRet20: number | null
    mktRet5: number | null
    mktEff: number | null
  }
  const days: DayRow[] = []
  const rets: number[] = []
  let prevLev: number | null = null
  let prevRisk: number | null = null
  let prevEquity = 0
  for (let i = 0; i < equity.length; i++) {
    const d = equity[i]!
    const rows = posByDate.get(d.date) ?? []
    let longMv = 0
    let shortMv = 0
    let gross = 0
    const mvs: number[] = []
    for (const r of rows) {
      const mv = Math.abs(r.mv)
      if (mv <= 0 && r.longMv <= 0 && r.shortMv <= 0) continue
      longMv += Math.max(0, r.longMv)
      shortMv += Math.max(0, r.shortMv)
      gross += mv > 0 ? mv : r.longMv + r.shortMv
      if (mv > 0) mvs.push(mv)
    }
    const lev = d.equity > 0 && gross > 0 ? gross / d.equity : null
    const hedgeDen = longMv + shortMv
    const hedge = hedgeDen > 0 ? (2 * Math.min(longMv, shortMv) / hedgeDen) * 100 : null
    const net = d.equity > 0 ? ((longMv - shortMv) / d.equity) * 100 : null
    const hhi = gross > 0 && mvs.length ? mvs.reduce((s, v) => s + (v / gross) ** 2, 0) : null
    const openLots = openByDate.get(d.date) ?? 0
    const openPerWan = d.equity > 0 ? openLots / (d.equity / 10000) : null
    const ret = prevEquity > 0 ? (d.pnl / prevEquity) * 100 : null
    if (ret != null) rets.push(ret)
    let ownVol: number | null = null
    if (rets.length >= 21) ownVol = stdev(rets.slice(rets.length - 21, rets.length - 1)) * Math.sqrt(252)
    const nh = nhLag.get(d.date)
    const row: DayRow = {
      date: d.date,
      lev,
      hedge,
      net,
      absNet: net == null ? null : Math.abs(net),
      nProd: mvs.length,
      hhi,
      openPerWan,
      ret,
      ydayRet: i > 0 ? days[i - 1]!.ret : null,
      dLev: lev != null && prevLev != null ? lev - prevLev : null,
      dRisk: prevRisk != null ? d.riskPct - prevRisk : null,
      ddLag: i > 0 ? equity[i - 1]!.ddPct : null,
      ownVol,
      mktVol: nh?.vol ?? null,
      mktRet20: nh?.ret20 ?? null,
      mktRet5: nh?.ret5 ?? null,
      mktEff: nh?.eff ?? null,
    }
    days.push(row)
    prevLev = lev
    prevRisk = d.riskPct
    prevEquity = d.equity
  }

  const cands: Candidate[] = []
  const addDay = (
    id: string,
    family: string,
    xName: string,
    yName: string,
    xKind: Kind,
    yKind: Kind,
    title: (rho: number) => string,
    detail: (rho: number) => string,
    pick: (d: DayRow) => { x: number | null; y: number | null },
  ) => {
    const b = bag()
    for (const d of days) {
      const xy = pick(d)
      pushPair(b, xy.x, xy.y, d.date)
    }
    cands.push({ id, family, level: "day", xName, yName, xKind, yKind, title, detail, ...b })
  }

  addDay(
    "mkt_vol_hedge",
    "mkt_vol_hedge",
    "前一日市场波动 %",
    "对冲度 %",
    "pct0",
    "pct0",
    (rho) => posTitle(rho, "市场更吵时对冲度更高", "市场更吵时对冲度更低"),
    (rho) => posTitle(rho, "南华波动升高的次日，多空对冲度跟着升高。", "南华波动升高的次日，对冲度下降，方向更单边。"),
  (d) => ({ x: d.mktVol, y: d.hedge }))

  addDay(
    "mkt_vol_names",
    "mkt_vol_breadth",
    "前一日市场波动 %",
    "持有品种数",
    "pct0",
    "num",
    (rho) => posTitle(rho, "市场更吵时品种铺得更开", "市场更吵时品种更少"),
    (rho) => posTitle(rho, "波动升高的次日，持仓品种数上升。", "波动升高的次日，品种收拢。"),
  (d) => ({ x: d.mktVol, y: d.nProd > 0 ? d.nProd : null }))

  addDay(
    "mkt_vol_hhi",
    "mkt_vol_breadth",
    "前一日市场波动 %",
    "持仓集中度",
    "pct0",
    "num",
    (rho) => posTitle(rho, "市场更吵时仓位更集中", "市场更吵时仓位更分散"),
    (rho) => posTitle(rho, "波动升高的次日，市值 HHI 上升，钱更堆在少数品种。", "波动升高的次日，市值 HHI 下降，摊得更开。"),
  (d) => ({ x: d.mktVol, y: d.hhi }))

  addDay(
    "mkt_vol_activity",
    "mkt_vol_activity",
    "前一日市场波动 %",
    "开仓手数 / 万元权益",
    "pct0",
    "num",
    (rho) => posTitle(rho, "市场更吵时开仓更密", "市场更吵时开仓更稀"),
    (rho) => posTitle(rho, "波动升高的次日，单位权益的开仓手数上升。", "波动升高的次日，开仓变少。"),
  (d) => ({ x: d.mktVol, y: d.openPerWan }))

  addDay(
    "mkt_ret20_net",
    "mkt_trend_side",
    "前一日南华 20 日涨跌 %",
    "净敞口 / 权益 %",
    "pct",
    "pct",
    (rho) => posTitle(rho, "市场趋势向上时净多头更重", "市场趋势向上时净空头更重"),
    (rho) => posTitle(rho, "南华过去 20 日涨得越多，次日净敞口越偏多。像跟指数方向。", "南华过去 20 日涨得越多，次日净敞口越偏空。像逆着指数。"),
  (d) => ({ x: d.mktRet20, y: d.net }))

  addDay(
    "mkt_ret5_net",
    "mkt_trend_side",
    "前一日南华 5 日涨跌 %",
    "净敞口 / 权益 %",
    "pct",
    "pct",
    (rho) => posTitle(rho, "市场近一周上涨时净多头更重", "市场近一周上涨时净空头更重"),
    (rho) => posTitle(rho, "南华近 5 日上涨之后，次日净敞口更偏多。", "南华近 5 日上涨之后，次日净敞口更偏空。"),
  (d) => ({ x: d.mktRet5, y: d.net }))

  addDay(
    "mkt_abs_ret_size",
    "mkt_trend_size",
    "前一日 |南华 20 日涨跌| %",
    "|净敞口| / 权益 %",
    "pct",
    "pct",
    (rho) => posTitle(rho, "市场趋势越强，方向押得越重", "市场趋势越强，方向押得越轻"),
    (rho) => posTitle(rho, "南华 20 日涨跌的绝对值越大，次日净敞口的绝对值越大。", "南华 20 日涨跌越大，次日方向敞口反而更小。"),
  (d) => ({ x: d.mktRet20 == null ? null : Math.abs(d.mktRet20), y: d.absNet }))

  addDay(
    "mkt_eff_size",
    "mkt_trend_size",
    "前一日趋势效率 %",
    "|净敞口| / 权益 %",
    "pct0",
    "pct",
    (rho) => posTitle(rho, "趋势越干净，方向敞口越大", "趋势越干净，方向敞口越小"),
    (rho) => posTitle(rho, "20 日净位移相对路径越长，次日方向敞口越大。震荡市把方向仓收起来。", "趋势越干净，方向敞口越小。"),
  (d) => ({ x: d.mktEff, y: d.absNet }))

  addDay(
    "dd_lev",
    "dd_lev",
    "前一日回撤 %",
    "总杠杆",
    "pct",
    "x",
    (rho) => posTitle(rho, "回撤越深，杠杆越低", "回撤越深，杠杆越高"),
    (rho) => posTitle(rho, "回撤（负数）越深，次日持仓市值/权益越低。亏的过程里在减仓。", "回撤越深，次日杠杆越高。亏的时候还在加。"),
  (d) => ({ x: d.ddLag, y: d.lev }))

  addDay(
    "own_vol_lev",
    "own_vol_lev",
    "账户自身 20 日波动 %",
    "总杠杆",
    "pct0",
    "x",
    (rho) => posTitle(rho, "自己的波动升高时杠杆更高", "自己的波动升高时降低杠杆"),
    (rho) => posTitle(rho, "账户近 20 日收益波动升高后，杠杆不降反升。", "账户自己的波动升高后，次日把杠杆降下来。像波动率目标，标的是自己的净值而不是南华。"),
  (d) => ({ x: d.ownVol, y: d.lev }))

  addDay(
    "yday_dlev",
    "after_pnl",
    "前一日账户收益 %",
    "杠杆变化",
    "pct",
    "x",
    (rho) => posTitle(rho, "赚了加杠杆，亏了减杠杆", "赚了减杠杆，亏了加杠杆"),
    (rho) => posTitle(rho, "昨天账户收益越高，今天杠杆加得越多。", "昨天赚得越多，今天杠杆降得越多；亏了反而加上去。"),
  (d) => ({ x: d.ydayRet, y: d.dLev }))

  addDay(
    "yday_drisk",
    "after_pnl",
    "前一日账户收益 %",
    "风险度变化 (百分点)",
    "pct",
    "num",
    (rho) => posTitle(rho, "赚了提高风险度，亏了降低", "赚了降低风险度，亏了提高"),
    (rho) => posTitle(rho, "昨天收益越高，今天风险度升得越多。", "昨天赚了，今天风险度往下；昨天亏了，风险度往上。"),
  (d) => ({ x: d.ydayRet, y: d.dRisk }))

  addDay(
    "yday_open",
    "after_pnl",
    "前一日账户收益 %",
    "开仓手数 / 万元权益",
    "pct",
    "num",
    (rho) => posTitle(rho, "赚了次日开得更密", "亏了次日开得更密"),
    (rho) => posTitle(rho, "昨天收益越高，今天单位权益的开仓越多。", "昨天亏得越多，今天开仓越多。"),
  (d) => ({ x: d.ydayRet, y: d.openPerWan }))

  addDay(
    "lev_names",
    "scale_breadth",
    "总杠杆",
    "持有品种数",
    "x",
    "num",
    (rho) => posTitle(rho, "杠杆高时品种也更多", "杠杆高时品种更集中"),
    (rho) => posTitle(rho, "杠杆高的日子，持仓品种数也多。加仓是在铺品种，不是只把原有品种做大。", "杠杆高的日子品种更少。加仓是在加原来那几个，不是铺开。"),
  (d) => ({ x: d.lev, y: d.nProd > 0 ? d.nProd : null }))

  const prodTrend = (
    id: string,
    xName: string,
    pick: (f: Feat) => number | null,
    title: (rho: number) => string,
    detail: (rho: number) => string,
  ) => {
    const b = bag(true)
    for (const [date, rows] of posByDate) {
      let gross = 0
      for (const r of rows) gross += Math.abs(r.mv)
      if (gross <= 0) continue
      for (const r of rows) {
        const f = lagged.get(r.product)?.get(date)
        const signed = ((r.longMv - r.shortMv) / gross) * 100
        pushPair(b, pick(f ?? { ret5: null, ret20: null, ret60: null, vol20: null, rsi: null, maDist: null, volRatio: null }), signed, `${r.product} ${date}`, r.product)
      }
    }
    cands.push({
      id,
      family: "prod_trend",
      level: "product",
      xName,
      yName: "净市值占当日总市值 %",
      xKind: id === "rsi_weight" ? "rsi" : "pct",
      yKind: "pct",
      title,
      detail,
      ...b,
    })
  }

  prodTrend(
    "ret20_weight",
    "前一日 20 日涨跌 %",
    (f) => f.ret20,
    (rho) => posTitle(rho, "品种涨得越多，净多头越重", "品种涨得越多，净多头越轻"),
    (rho) => posTitle(rho, "这个品种过去 20 日涨得越多，次日它的净市值权重越偏多。跌的一边反过来。像趋势跟踪。", "过去 20 日涨得越多，次日净多头越轻。更像反转。"),
  )
  prodTrend(
    "ret60_weight",
    "前一日 60 日涨跌 %",
    (f) => f.ret60,
    (rho) => posTitle(rho, "中期涨得越多，净多头越重", "中期涨得越多，净多头越轻"),
    (rho) => posTitle(rho, "60 日涨幅越高，次日净市值越偏多。", "60 日涨幅越高，次日净多头越轻。"),
  )
  prodTrend(
    "ret5_weight",
    "前一日 5 日涨跌 %",
    (f) => f.ret5,
    (rho) => posTitle(rho, "近一周涨得越多，净多头越重", "近一周涨得越多，净多头越轻"),
    (rho) => posTitle(rho, "5 日涨幅越高，次日净市值越偏多。", "5 日涨幅越高，次日净多头越轻。"),
  )
  prodTrend(
    "ma_weight",
    "前一日相对 MA20 %",
    (f) => f.maDist,
    (rho) => posTitle(rho, "价格在均线上方时净多头更重", "价格在均线上方时净多头更轻"),
    (rho) => posTitle(rho, "收盘相对 20 日均线越高，次日净多头权重越大。", "价格在均线上方时，次日净多头更轻。"),
  )
  prodTrend(
    "rsi_weight",
    "前一日 RSI14",
    (f) => f.rsi,
    (rho) => posTitle(rho, "RSI 越高，净多头越重", "RSI 越高，净多头越轻"),
    (rho) => posTitle(rho, "RSI 越高，次日净市值越偏多。", "RSI 越高，次日净多头越轻，更像超买就减。"),
  )

  const absTrend = bag(true)
  for (const [date, rows] of posByDate) {
    let gross = 0
    for (const r of rows) gross += Math.abs(r.mv)
    if (gross <= 0) continue
    for (const r of rows) {
      const f = lagged.get(r.product)?.get(date)
      const absW = (Math.abs(r.mv) / gross) * 100
      const x = f?.ret20 == null ? null : Math.abs(f.ret20)
      pushPair(absTrend, x, absW, `${r.product} ${date}`, r.product)
    }
  }
  cands.push({
    id: "abs_ret20_abs_weight",
    family: "prod_trend_size",
    level: "product",
    xName: "前一日 |20 日涨跌| %",
    yName: "市值权重 %",
    xKind: "pct",
    yKind: "pct",
    title: (rho) => posTitle(rho, "趋势越强的品种，仓位越重", "趋势越强的品种，仓位越轻"),
    detail: (rho) => posTitle(rho, "20 日涨跌绝对值越大，次日这个品种占的市值权重越高。仓位跟着趋势强度走，不论多空。", "趋势越强的品种，次日权重越低。"),
    ...absTrend,
  })

  const entry = bag(true)
  const entryMa = bag(true)
  for (const o of input.opens) {
    const date = ymd(o.date)
    if (date < from || date > to) continue
    const lots = o.buyOpen + o.sellOpen
    if (lots <= 0) continue
    const f = lagged.get(o.product)?.get(date)
    const signed = ((o.buyOpen - o.sellOpen) / lots) * 100
    pushPair(entry, f?.ret5 ?? null, signed, `${o.product} ${date}`, o.product)
    pushPair(entryMa, f?.maDist ?? null, signed, `${o.product} ${date}`, o.product)
  }
  cands.push({
    id: "ret5_open",
    family: "prod_entry",
    level: "product",
    xName: "前一日 5 日涨跌 %",
    yName: "买开偏移 %",
    xKind: "pct",
    yKind: "pct0",
    title: (rho) => posTitle(rho, "近一周上涨后更偏买开", "近一周上涨后更偏卖开"),
    detail: (rho) => posTitle(rho, "开仓日里，这个品种近 5 日涨得越多，买开相对卖开越多。", "近 5 日涨得越多，卖开相对买开越多。"),
    ...entry,
  })
  cands.push({
    id: "ma_open",
    family: "prod_entry",
    level: "product",
    xName: "前一日相对 MA20 %",
    yName: "买开偏移 %",
    xKind: "pct",
    yKind: "pct0",
    title: (rho) => posTitle(rho, "均线上方更偏买开", "均线上方更偏卖开"),
    detail: (rho) => posTitle(rho, "价格在 20 日均线上方越多，开仓更偏买开。", "价格在均线上方时，开仓更偏卖开。"),
    ...entryMa,
  })

  const carryBag = bag(true)
  const oiBag = bag(true)
  for (const [date, rows] of posByDate) {
    let gross = 0
    for (const r of rows) gross += Math.abs(r.mv)
    if (gross <= 0) continue
    for (const r of rows) {
      const c = carryLag.get(r.product)?.get(date)
      const signed = ((r.longMv - r.shortMv) / gross) * 100
      if (c && Number.isFinite(c.carry)) pushPair(carryBag, c.carry, signed, `${r.product} ${date}`, r.product)
      if (c && c.oiChg != null && Number.isFinite(c.oiChg)) pushPair(oiBag, c.oiChg, signed, `${r.product} ${date}`, r.product)
    }
  }
  cands.push({
    id: "carry_weight",
    family: "prod_carry",
    level: "product",
    xName: "前一日次主力升水 %",
    yName: "净市值占当日总市值 %",
    xKind: "pct",
    yKind: "pct",
    title: (rho) => posTitle(rho, "越升水越偏多", "越贴水越偏多"),
    detail: (rho) => posTitle(rho, "次主力相对主力越贵（升水），次日净多头越重。", "次主力越贵，次日越偏空；贴水时更偏多。像做展期收益。"),
    ...carryBag,
  })
  cands.push({
    id: "oi_weight",
    family: "prod_oi",
    level: "product",
    xName: "前一日主力持仓量变化 %",
    yName: "净市值占当日总市值 %",
    xKind: "pct",
    yKind: "pct",
    title: (rho) => posTitle(rho, "持仓量增加时更偏多", "持仓量增加时更偏空"),
    detail: (rho) => posTitle(rho, "主力持仓量增加的次日，这个品种的净市值更偏多。", "主力持仓量增加的次日，净市值更偏空。"),
    ...oiBag,
  })

  const liq = bag(true)
  const openLotsByProd = new Map<string, number[]>()
  for (const o of input.opens) {
    const date = ymd(o.date)
    if (date < from || date > to) continue
    const lots = o.buyOpen + o.sellOpen
    if (lots <= 0) continue
    const list = openLotsByProd.get(o.product) ?? []
    list.push(lots)
    openLotsByProd.set(o.product, list)
  }
  const openScale = new Map<string, { m: number; s: number }>()
  for (const [prod, lots] of openLotsByProd) {
    const s = stdev(lots)
    if (lots.length >= 8 && s > 1e-6) openScale.set(prod, { m: mean(lots), s })
  }
  for (const o of input.opens) {
    const date = ymd(o.date)
    if (date < from || date > to) continue
    const lots = o.buyOpen + o.sellOpen
    const scale = openScale.get(o.product)
    if (lots <= 0 || !scale) continue
    const f = lagged.get(o.product)?.get(date)
    pushPair(liq, f?.volRatio ?? null, (lots - scale.m) / scale.s, `${o.product} ${date}`, o.product)
  }
  cands.push({
    id: "volume_open",
    family: "prod_liq",
    level: "product",
    xName: "前一日成交量 / 20 日均量",
    yName: "开仓手数（品种内）",
    xKind: "num",
    yKind: "z",
    title: (rho) => posTitle(rho, "放量之后开仓更重", "放量之后开仓更轻"),
    detail: (rho) => posTitle(rho, "成交量相对自身 20 日均量越高，次日这个品种的开仓手数越高。", "放量的次日，这个品种开仓更轻。"),
    ...liq,
  })

  const charts = screenLinearCandidates(cands)
  const tested = cands.filter((c) => c.xs.length >= (c.level === "day" ? 30 : 80)).length
  const headline = charts.length
    ? `试了 ${tested} 组仓位、方向和杠杆上的直线。下面 ${charts.length} 张同时过了显著性和「散点上看得出来」。同一类只留最陡的一条，所以别的盘手张数会不一样。`
    : `试了 ${tested} 组仓位、方向和杠杆上的直线。这一段没有又显著、又在散点上看得清楚的。`
  return { tested, shown: charts.length, headline, charts }
}
