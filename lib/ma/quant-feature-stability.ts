/** Rolling and regime-conditional strategy features. Averages over the whole sample hide a style that flips when the market flips. */

export type DayObs = {
  date: string
  pnl: number
  winLots: number
  lossLots: number
  winPnl: number
  lossPnl: number
  closeLots: number
  holdSum: number
  openLots: number
  hedge: number | null
  topSectorShare: number | null
  topSector: string | null
  nhRet: number | null
}

export type FeaturePoint = {
  date: string
  winRate: number | null
  payoff: number | null
  pnl: number
  trades: number | null
  hold: number | null
  hedge: number | null
  corr: number | null
  sectorShare: number | null
}

export type RegimeSlice = {
  family: string
  familyLabel: string
  key: string
  label: string
  days: number
  winRate: number | null
  payoff: number | null
  pnl: number
  trades: number | null
  hold: number | null
  hedge: number | null
  corr: number | null
  sectorShare: number | null
  topSector: string | null
}

export type FeatureStability = {
  window: number
  track: FeaturePoint[]
  regimes: RegimeSlice[]
  headline: string
  notes: string[]
  conditions: MarketCondition[]
  scatter: { volSplit: number | null; trendSplit: number; chopSplit: number; points: MarketPoint[] }
}

export type MarketPoint = { dir: number; vol: number; trend: number; chop: number; pnl: number }

export type MarketCondition = {
  key: string
  label: string
  days: number
  largestRisk: { sector: string | null; share: number | null }
  lowestRisk: { sector: string | null; share: number | null }
  profitSector: { sector: string | null; pnl: number | null }
  lossSector: { sector: string | null; pnl: number | null }
}

const WINDOW = 20
const STEP = 5
const MIN_DAYS = 20

function r1(n: number): number { return Math.round(n * 10) / 10 }
function r2(n: number): number { return Math.round(n * 100) / 100 }

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 12 || ys.length !== n) return null
  let sx = 0
  let sy = 0
  for (let i = 0; i < n; i++) {
    sx += xs[i]!
    sy += ys[i]!
  }
  sx /= n
  sy /= n
  let num = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - sx
    const dy = ys[i]! - sy
    num += dx * dy
    vx += dx * dx
    vy += dy * dy
  }
  if (vx <= 1e-18 || vy <= 1e-18) return null
  return num / Math.sqrt(vx * vy)
}

function pack(rows: DayObs[]): Omit<RegimeSlice, "family" | "familyLabel" | "key" | "label" | "days" | "topSector"> & { days: number; topSector: string | null } {
  let winLots = 0
  let lossLots = 0
  let winPnl = 0
  let lossPnl = 0
  let closeLots = 0
  let holdSum = 0
  let activity = 0
  let hedge = 0
  let hedgeN = 0
  let share = 0
  let shareN = 0
  const px: number[] = []
  const py: number[] = []
  const sectorLots = new Map<string, number>()
  for (const row of rows) {
    winLots += row.winLots
    lossLots += row.lossLots
    winPnl += row.winPnl
    lossPnl += row.lossPnl
    closeLots += row.closeLots
    holdSum += row.holdSum
    activity += row.openLots + row.closeLots
    if (row.hedge != null) {
      hedge += row.hedge
      hedgeN++
    }
    if (row.topSectorShare != null) {
      share += row.topSectorShare
      shareN++
    }
    if (row.topSector) sectorLots.set(row.topSector, (sectorLots.get(row.topSector) ?? 0) + 1)
    if (row.nhRet != null) {
      px.push(row.pnl)
      py.push(row.nhRet)
    }
  }
  const decided = winLots + lossLots
  let topSector: string | null = null
  let topN = 0
  for (const [name, n] of sectorLots) {
    if (n > topN) {
      topSector = name
      topN = n
    }
  }
  const corr = pearson(px, py)
  const avgWin = winLots > 0 ? winPnl / winLots : 0
  const avgLoss = lossLots > 0 ? Math.abs(lossPnl) / lossLots : 0
  const pnl = rows.reduce((s, row) => s + row.pnl, 0)
  return {
    days: rows.length,
    winRate: decided > 0 ? r1((winLots / decided) * 100) : null,
    payoff: winLots > 0 && avgLoss > 0 ? r2(avgWin / avgLoss) : null,
    pnl: Math.round(pnl),
    trades: rows.length ? r1(activity / rows.length) : null,
    hold: closeLots > 0 ? r1(holdSum / closeLots) : null,
    hedge: hedgeN ? r1(hedge / hedgeN) : null,
    corr: corr == null ? null : r2(corr),
    sectorShare: shareN ? r1(share / shareN) : null,
    topSector,
  }
}

function rollingReturn(closes: { date: string; close: number }[], n: number): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = n; i < closes.length; i++) {
    const prev = closes[i - n]!.close
    if (prev > 0) out.set(closes[i]!.date, closes[i]!.close / prev - 1)
  }
  return out
}

function efficiency20(closes: { date: string; close: number }[]): Map<string, number> {
  const out = new Map<string, number>()
  const n = 20
  for (let i = n; i < closes.length; i++) {
    const start = closes[i - n]!.close
    const end = closes[i]!.close
    if (start <= 0) continue
    let path = 0
    for (let j = i - n + 1; j <= i; j++) path += Math.abs(closes[j]!.close - closes[j - 1]!.close)
    out.set(closes[i]!.date, path < 1e-9 ? 0 : Math.abs(end - start) / path)
  }
  return out
}

function vol20(closes: { date: string; close: number }[]): Map<string, number> {
  const rets: { date: string; ret: number }[] = []
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!.close
    if (prev > 0) rets.push({ date: closes[i]!.date, ret: closes[i]!.close / prev - 1 })
  }
  const out = new Map<string, number>()
  for (let i = WINDOW - 1; i < rets.length; i++) {
    let m = 0
    for (let j = i - WINDOW + 1; j <= i; j++) m += rets[j]!.ret
    m /= WINDOW
    let v = 0
    for (let j = i - WINDOW + 1; j <= i; j++) {
      const d = rets[j]!.ret - m
      v += d * d
    }
    out.set(rets[i]!.date, Math.sqrt(v / (WINDOW - 1)))
  }
  return out
}

type Tag = "trend" | "range" | "nhUp" | "nhDown" | "volHigh" | "volLow"

function tagsFor(
  dates: string[],
  nh: { date: string; close: number }[],
): Map<string, Tag[]> {
  const r5 = rollingReturn(nh, 5)
  const r20 = rollingReturn(nh, 20)
  const r60 = rollingReturn(nh, 60)
  const vol = vol20(nh)
  const vols = dates.map((d) => vol.get(d)).filter((v): v is number => v != null).sort((a, b) => a - b)
  const med = vols.length ? vols[Math.floor(vols.length / 2)]! : null
  const out = new Map<string, Tag[]>()
  for (const d of dates) {
    const tags: Tag[] = []
    const a = r5.get(d)
    const b = r20.get(d)
    const c = r60.get(d)
    if (a != null && b != null && c != null) {
      const same = (a >= 0 && b >= 0 && c >= 0) || (a < 0 && b < 0 && c < 0)
      tags.push(same ? "trend" : "range")
    }
    const side = r20.get(d)
    if (side != null) tags.push(side >= 0 ? "nhUp" : "nhDown")
    const v = vol.get(d)
    if (v != null && med != null) tags.push(v >= med ? "volHigh" : "volLow")
    out.set(d, tags)
  }
  return out
}

function styleName(win: number | null, payoff: number | null): string {
  if (win == null || payoff == null) return "样本不够"
  if (win >= 45 && payoff <= 1.15) return "高胜率、低盈亏比"
  if (win <= 40 && payoff >= 1.35) return "低胜率、高盈亏比"
  if (payoff >= 1.2) return "盈亏比偏高"
  if (win >= 48) return "胜率偏高"
  return "胜率和盈亏比都靠近中间"
}

function pairNote(familyLabel: string, a: RegimeSlice, b: RegimeSlice): string | null {
  if (a.days < MIN_DAYS || b.days < MIN_DAYS) return null
  const bits: string[] = []
  if (a.winRate != null && b.winRate != null && a.payoff != null && b.payoff != null) {
    const winGap = a.winRate - b.winRate
    const payGap = a.payoff - b.payoff
    const flipped = Math.abs(winGap) >= 8 && Math.abs(payGap) >= 0.25 && Math.sign(winGap) !== Math.sign(payGap)
    if (flipped || Math.abs(winGap) >= 8 || Math.abs(payGap) >= 0.25) {
      bits.push(`${familyLabel}：${a.label}胜率 ${a.winRate.toFixed(0)}%、盈亏比 ${a.payoff.toFixed(2)}（${styleName(a.winRate, a.payoff)}），${b.label}胜率 ${b.winRate.toFixed(0)}%、盈亏比 ${b.payoff.toFixed(2)}（${styleName(b.winRate, b.payoff)}）。`)
      if (flipped) bits.push("两边的胜率和盈亏比对调了，全样本平均会把这写成同一种策略。")
    }
  }
  if (a.hedge != null && b.hedge != null && Math.abs(a.hedge - b.hedge) >= 12) {
    bits.push(`${familyLabel}的对冲度：${a.label} ${a.hedge.toFixed(0)}%，${b.label} ${b.hedge.toFixed(0)}%。`)
  }
  if (a.hold != null && b.hold != null && Math.abs(a.hold - b.hold) >= 2) {
    bits.push(`${familyLabel}的持有天数：${a.label} ${a.hold.toFixed(1)} 天，${b.label} ${b.hold.toFixed(1)} 天。`)
  }
  if (a.trades != null && b.trades != null && Math.min(a.trades, b.trades) > 0 && Math.max(a.trades, b.trades) / Math.min(a.trades, b.trades) >= 1.4) {
    bits.push(`${familyLabel}的交易频率：${a.label}日均 ${a.trades.toFixed(0)} 手，${b.label}日均 ${b.trades.toFixed(0)} 手。`)
  }
  if (a.corr != null && b.corr != null && Math.abs(a.corr - b.corr) >= 0.2) {
    bits.push(`${familyLabel}里和南华的相关：${a.label} ${a.corr.toFixed(2)}，${b.label} ${b.corr.toFixed(2)}。`)
  }
  if (a.topSector && b.topSector && a.topSector !== b.topSector) {
    bits.push(`${familyLabel}里风险贡献最大的板块：${a.label}是${a.topSector}，${b.label}是${b.topSector}。`)
  }
  return bits.length ? bits.join("") : null
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

const VOL_DAYS = 60

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

export type WeightStance = "单一" | "接近均等" | "有所偏好" | "明显偏好"

export type BookRiskProduct = {
  code: string
  name: string
  riskShare: number
  withinShare: number
  days: number
}

export type BookRiskSector = {
  sector: string
  riskShare: number
  productCount: number
  hhi: number
  effective: number
  stance: WeightStance
  topProduct: string | null
  topWithin: number | null
  products: BookRiskProduct[]
}

export type BookRisk = {
  days: number
  sectorCount: number
  productCount: number
  hhi: number
  effective: number
  equalShare: number
  stance: WeightStance
  topSector: string | null
  topShare: number | null
  headline: string
  sectors: BookRiskSector[]
}

type ProductVar = Map<string, Map<string, { sector: string; v: number }>>

/** Diagonal Euler risk contribution. A sector's share is its slice of portfolio variance, so a large low-vol bond book stays small. */
export function sectorRiskByDay(input: {
  positions: { date: string; product: string; sector: string; longMv: number; shortMv: number }[]
  returns: { date: string; product: string; pct: number }[]
}): {
  top: Map<string, { topSector: string | null; share: number | null }>
  variance: Map<string, Map<string, number>>
  products: ProductVar
} {
  const retByProd = new Map<string, { date: string; pct: number }[]>()
  for (const row of input.returns) {
    if (!row.product || !Number.isFinite(row.pct) || row.pct === 0) continue
    const list = retByProd.get(row.product) ?? []
    list.push({ date: row.date, pct: row.pct })
    retByProd.set(row.product, list)
  }
  for (const list of retByProd.values()) list.sort((a, b) => a.date.localeCompare(b.date))

  const sigmaOn = (product: string, asOf: string): number => {
    const list = retByProd.get(product)
    if (!list) return 0
    let end = -1
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.date <= asOf) { end = i; break }
    }
    if (end < 20) return 0
    const start = Math.max(0, end - VOL_DAYS + 1)
    const xs = list.slice(start, end + 1).map((r) => r.pct).filter((x) => Math.abs(x) < 15)
    return stdev(xs)
  }

  const byDate = new Map<string, Map<string, { sector: string; net: number }>>()
  for (const row of input.positions) {
    const net = row.longMv - row.shortMv
    if (!row.sector || net === 0) continue
    const book = byDate.get(row.date) ?? new Map()
    const prev = book.get(row.product)
    book.set(row.product, { sector: row.sector, net: (prev?.net ?? 0) + net })
    byDate.set(row.date, book)
  }

  const top = new Map<string, { topSector: string | null; share: number | null }>()
  const variance = new Map<string, Map<string, number>>()
  const products: ProductVar = new Map()
  for (const [date, book] of byDate) {
    const sectorVar = new Map<string, number>()
    const dayProd = new Map<string, { sector: string; v: number }>()
    let total = 0
    for (const [product, pos] of book) {
      const sigma = sigmaOn(product, date)
      if (sigma <= 0) continue
      const v = (pos.net * sigma) ** 2
      total += v
      sectorVar.set(pos.sector, (sectorVar.get(pos.sector) ?? 0) + v)
      dayProd.set(product, { sector: pos.sector, v })
    }
    let topSector: string | null = null
    let topV = 0
    for (const [name, v] of sectorVar) {
      if (v > topV) { topV = v; topSector = name }
    }
    top.set(date, { topSector, share: total > 0 ? (topV / total) * 100 : null })
    variance.set(date, sectorVar)
    if (dayProd.size) products.set(date, dayProd)
  }
  return { top, variance, products }
}

const MKT_WIN = 20

export type SectorVolPoint = { date: string; vol: number | null; risk: number | null }
export type SectorVolSeries = { sector: string; points: SectorVolPoint[] }
export type SectorVolExposure = { window: number; sectors: SectorVolSeries[] }

/** Sector market vol is the 20-day annualized vol of an equal-weight main-contract basket. Risk is that day's share of book variance. */
export function buildSectorVolExposure(input: {
  returns: { date: string; product: string; pct: number }[]
  variance: Map<string, Map<string, number>>
  sectorOf: (product: string) => string
  heldSectors?: string[]
}): SectorVolExposure | null {
  const abs: number[] = []
  const dayPcts = new Map<string, Map<string, number[]>>()
  for (const row of input.returns) {
    const date = row.date.slice(0, 10)
    const sector = input.sectorOf(row.product)
    if (!date || !sector || !Number.isFinite(row.pct) || row.pct === 0 || Math.abs(row.pct) >= 15) continue
    abs.push(Math.abs(row.pct))
    const book = dayPcts.get(date) ?? new Map()
    const list = book.get(sector) ?? []
    list.push(row.pct)
    book.set(sector, list)
    dayPcts.set(date, book)
  }
  if (!dayPcts.size) return null
  if (!input.variance.size && !(input.heldSectors?.length)) return null
  abs.sort((a, b) => a - b)
  const med = abs.length ? abs[Math.floor(abs.length / 2)]! : 1
  const ann = (med > 0.5 ? 1 : 100) * Math.sqrt(252)

  const retSeries = new Map<string, { date: string; ret: number }[]>()
  for (const date of [...dayPcts.keys()].sort()) {
    const book = dayPcts.get(date)!
    for (const [sector, pcts] of book) {
      if (!pcts.length) continue
      const list = retSeries.get(sector) ?? []
      list.push({ date, ret: pcts.reduce((s, x) => s + x, 0) / pcts.length })
      retSeries.set(sector, list)
    }
  }
  const volOn = new Map<string, Map<string, number>>()
  for (const [sector, series] of retSeries) {
    const vol = new Map<string, number>()
    for (let i = 0; i < series.length; i++) {
      const start = Math.max(0, i - MKT_WIN + 1)
      const window = series.slice(start, i + 1)
      if (window.length < 15) continue
      vol.set(series[i]!.date, r1(stdev(window.map((p) => p.ret)) * ann))
    }
    if (vol.size) volOn.set(sector, vol)
  }

  const bookDates = [...input.variance.keys()].map((d) => d.slice(0, 10)).sort()
  const retDates = [...dayPcts.keys()].sort()
  const from = bookDates[0] ?? retDates[0]!
  const to = bookDates[bookDates.length - 1] ?? retDates[retDates.length - 1]!
  const exposed = new Map<string, number>()
  for (const vars of input.variance.values()) {
    let total = 0
    for (const v of vars.values()) total += v
    if (!(total > 0)) continue
    for (const [sector, v] of vars) {
      if (v > 0) exposed.set(sector, (exposed.get(sector) ?? 0) + v / total)
    }
  }
  const wanted = new Set<string>([...exposed.keys(), ...(input.heldSectors ?? [])])
  const sectors = [...wanted].filter((sector) => (volOn.get(sector)?.size ?? 0) > 0 || (exposed.get(sector) ?? 0) > 0)
  if (!sectors.length) return null

  const dateSet = new Set<string>(bookDates)
  for (const vol of volOn.values()) for (const date of vol.keys()) if (date >= from && date <= to) dateSet.add(date)
  const dates = [...dateSet].sort()
  const riskByDate = new Map<string, Map<string, number>>()
  for (const [raw, vars] of input.variance) {
    const date = raw.slice(0, 10)
    let total = 0
    for (const v of vars.values()) total += v
    const shares = new Map<string, number>()
    if (total > 0) for (const [sector, v] of vars) shares.set(sector, (v / total) * 100)
    riskByDate.set(date, shares)
  }

  const out: SectorVolSeries[] = sectors.map((sector) => {
    const vol = volOn.get(sector)
    const points: SectorVolPoint[] = []
    for (const date of dates) {
      const riskBook = riskByDate.get(date)
      const risk = riskBook ? r1(riskBook.get(sector) ?? 0) : null
      const v = vol?.get(date)
      points.push({ date, vol: v == null ? null : v, risk })
    }
    return { sector, points }
  })
  out.sort((a, b) => (exposed.get(b.sector) ?? 0) - (exposed.get(a.sector) ?? 0))
  return { window: MKT_WIN, sectors: out }
}

export type AlphaBetaPoint = {
  date: string
  alpha: number
  beta: number
  cumAlpha: number
  cumBeta: number
}

export type AlphaNavPoint = { date: string; trader: number; nhci: number }

export type AlphaStance = "显著且前后同号" | "显著但不稳" | "不显著" | "样本不够拆半"

export type AlphaSector = {
  sector: string
  alphaPnl: number
  betaPnl: number
  t: number | null
  stance: AlphaStance
}

export type AlphaBeta = {
  n: number
  betaPerPct: number | null
  alphaDaily: number | null
  t: number | null
  alphaT: number | null
  r2: number | null
  totalPnl: number
  alphaPnl: number
  betaPnl: number
  alphaStance: AlphaStance
  alphaNote: string
  headline: string
  points: AlphaBetaPoint[]
  nav: AlphaNavPoint[]
  sectors: AlphaSector[]
  sectorHeadline: string
}

function fmtYuan(n: number): string {
  const abs = Math.abs(n)
  const sign = n > 0 ? "+" : n < 0 ? "-" : ""
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1)}万`
  return `${sign}${Math.round(abs).toLocaleString("zh-CN")}`
}

type OlsFit = { n: number; a: number; b: number; r2: number; tA: number | null; tB: number | null }

function olsFit(ys: number[], xs: number[]): OlsFit | null {
  const n = ys.length
  if (n < 20 || xs.length !== n) return null
  let sumX = 0
  let sumY = 0
  let sumXX = 0
  let sumYY = 0
  let sumXY = 0
  for (let i = 0; i < n; i++) {
    const x = xs[i] ?? 0
    const y = ys[i] ?? 0
    sumX += x
    sumY += y
    sumXX += x * x
    sumYY += y * y
    sumXY += x * y
  }
  const sxx = sumXX - (sumX * sumX) / n
  const syy = sumYY - (sumY * sumY) / n
  const sxy = sumXY - (sumX * sumY) / n
  if (!(sxx > 1e-8)) return null
  const b = sxy / sxx
  const a = sumY / n - b * (sumX / n)
  const r2 = syy > 1e-8 ? (sxy * sxy) / (sxx * syy) : 0
  const sse = syy - b * sxy
  const mse = n > 2 ? Math.max(sse, 0) / (n - 2) : 0
  const seB = mse > 0 ? Math.sqrt(mse / sxx) : 0
  const xbar = sumX / n
  const seA = mse > 0 ? Math.sqrt(mse * (1 / n + (xbar * xbar) / sxx)) : 0
  const tOf = (est: number, se: number) => {
    if (!(mse > 0)) return Math.abs(est) > 1e-8 ? (est > 0 ? 999 : -999) : 0
    if (!(se > 0)) return null
    const t = est / se
    return Number.isFinite(t) ? t : est > 0 ? 999 : -999
  }
  return { n, a, b, r2, tA: tOf(a, seA), tB: tOf(b, seB) }
}

function alphaStance(n: number, tA: number | null, a1: number | null, a2: number | null): AlphaStance {
  const sig = tA != null && Math.abs(tA) >= 2
  if (!sig) return "不显著"
  if (n < 40 || a1 == null || a2 == null) return "样本不够拆半"
  if (a1 * a2 > 0) return "显著且前后同号"
  return "显著但不稳"
}

function alphaNoteFor(stance: AlphaStance): string {
  if (stance === "显著且前后同号") return "alpha 的 |t|≥2，前半段和后半段同号。这不像只靠其中一段运气，但不能证明以后还会出现。"
  if (stance === "显著但不稳") return "全样本 alpha 显著，但前后两半反号。更像某一段的运气或风格切换，不能当成以后还会出现的 alpha。"
  if (stance === "样本不够拆半") return "alpha 的 |t|≥2，但天数不够拆成两半，看不出稳不稳，也不能证明以后还会出现。"
  return "alpha 的 |t|<2。这段多出来的盈亏不能排除运气。"
}

/** Split daily PnL into the part that moves with the Nanhua index and the rest. Market return is a decimal. */
export function buildAlphaBeta(
  days: { date: string; pnl: number; equity?: number }[],
  market: Map<string, number>,
  extra?: {
    sectors?: { date: string; sector: string; pnl: number }[]
  },
): AlphaBeta | null {
  const paired = days
    .map((d) => {
      const ret = market.get(d.date.slice(0, 10))
      if (ret == null || !Number.isFinite(ret) || !Number.isFinite(d.pnl)) return null
      const equity = d.equity
      const prev = equity != null && Number.isFinite(equity) ? equity - d.pnl : null
      return { date: d.date.slice(0, 10), pnl: d.pnl, x: ret * 100, prev }
    })
    .filter((d): d is { date: string; pnl: number; x: number; prev: number | null } => d != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  const n = paired.length
  if (n < 20) return null
  const fit = olsFit(paired.map((d) => d.pnl), paired.map((d) => d.x))
  if (!fit) return null
  const { a, b, r2, tA, tB } = fit
  const mid = Math.floor(n / 2)
  const fit1 = olsFit(paired.slice(0, mid).map((d) => d.pnl), paired.slice(0, mid).map((d) => d.x))
  const fit2 = olsFit(paired.slice(mid).map((d) => d.pnl), paired.slice(mid).map((d) => d.x))
  const stance = alphaStance(n, tA, fit1?.a ?? null, fit2?.a ?? null)
  const alphaNote = alphaNoteFor(stance)
  let cumAlpha = 0
  let cumBeta = 0
  let traderNav = 100
  let nhNav = 100
  const points: AlphaBetaPoint[] = []
  const nav: AlphaNavPoint[] = []
  for (const d of paired) {
    const beta = b * d.x
    const alpha = d.pnl - beta
    cumAlpha += alpha
    cumBeta += beta
    if (d.prev != null && d.prev > 0) traderNav *= 1 + d.pnl / d.prev
    nhNav *= 1 + d.x / 100
    points.push({
      date: d.date,
      alpha: Math.round(alpha),
      beta: Math.round(beta),
      cumAlpha: Math.round(cumAlpha),
      cumBeta: Math.round(cumBeta),
    })
    nav.push({
      date: d.date,
      trader: Math.round(traderNav * 100) / 100,
      nhci: Math.round(nhNav * 100) / 100,
    })
  }
  const alphaPnl = points[points.length - 1]?.cumAlpha ?? 0
  const betaPnlOut = points[points.length - 1]?.cumBeta ?? 0
  const totalPnl = alphaPnl + betaPnlOut
  const betaSig = tB != null && Math.abs(tB) >= 2
  const main = Math.abs(alphaPnl) >= Math.abs(betaPnlOut) ? "alpha" : "beta"
  const source = !betaSig
    ? "beta 不显著，这段盈亏不能算成跟着南华走"
    : main === "beta"
      ? "盈亏主要来自 beta，跟着南华商品指数"
      : "beta 显著，但盈亏主要来自 alpha"
  const bySector = new Map<string, Map<string, number>>()
  for (const row of extra?.sectors ?? []) {
    const date = row.date.slice(0, 10)
    const book = bySector.get(row.sector) ?? new Map<string, number>()
    book.set(date, (book.get(date) ?? 0) + row.pnl)
    bySector.set(row.sector, book)
  }
  const sectors: AlphaSector[] = []
  for (const [sector, book] of bySector) {
    const ys = paired.map((d) => book.get(d.date) ?? 0)
    if (!ys.some((v) => v !== 0)) continue
    const sec = olsFit(ys, paired.map((d) => d.x))
    if (!sec) continue
    let secAlpha = 0
    let secBeta = 0
    for (let i = 0; i < n; i++) {
      const x = paired[i]?.x ?? 0
      const betaDay = sec.b * x
      secBeta += betaDay
      secAlpha += (ys[i] ?? 0) - betaDay
    }
    const s1 = olsFit(ys.slice(0, mid), paired.slice(0, mid).map((d) => d.x))
    const s2 = olsFit(ys.slice(mid), paired.slice(mid).map((d) => d.x))
    sectors.push({
      sector,
      alphaPnl: Math.round(secAlpha),
      betaPnl: Math.round(secBeta),
      t: sec.tA == null ? null : Math.round(sec.tA * 100) / 100,
      stance: alphaStance(n, sec.tA, s1?.a ?? null, s2?.a ?? null),
    })
  }
  sectors.sort((p, q) => q.alphaPnl - p.alphaPnl)
  const best = sectors[0]
  const worst = sectors.length > 1 ? sectors[sectors.length - 1] : undefined
  const stableSectors = sectors.filter((s) => s.stance === "显著且前后同号")
  const sectorBits: string[] = []
  if (best) {
    sectorBits.push(`金额上 alpha 最多来自${best.sector} ${fmtYuan(best.alphaPnl)}，${best.stance}。`)
    if (stableSectors.length && stableSectors[0]!.sector !== best.sector) {
      const names = stableSectors.slice(0, 2).map((s) => `${s.sector} ${fmtYuan(s.alphaPnl)}`).join("、")
      sectorBits.push(`统计上站得住、前后同号的是${names}。这仍不能证明以后还会出现。`)
    } else if (stableSectors.length) {
      sectorBits.push("这一块前后同号，但仍不能证明以后还会出现。")
    } else {
      sectorBits.push("没有一个板块的 alpha 同时显著且前后同号。")
    }
    if (worst && worst.alphaPnl < 0 && worst.sector !== best.sector) {
      sectorBits.push(`亏在 alpha 上最多的是${worst.sector} ${fmtYuan(worst.alphaPnl)}，${worst.stance}。`)
    }
    sectorBits.push("板块 alpha 按各板块自己对南华的回归拆开，加总不必等于账户 alpha。")
  }
  const sectorHeadline = sectorBits.join("") || "没有可拆到板块的 alpha。"
  const traderEnd = nav[nav.length - 1]?.trader ?? 100
  const nhEnd = nav[nav.length - 1]?.nhci ?? 100
  const headline = `${source}。有南华行情的 ${n} 天里，alpha ${fmtYuan(alphaPnl)}，beta ${fmtYuan(betaPnlOut)}。南华每涨 1%，日盈亏约 ${fmtYuan(b)}（beta t=${tB == null ? "—" : tB.toFixed(2)}，R²=${r2.toFixed(2)}）。账户净值指数 ${traderEnd.toFixed(0)}，南华 ${nhEnd.toFixed(0)}（同日从 100 起算）。alpha 的 t=${tA == null ? "—" : tA.toFixed(2)}，${stance}。${alphaNote}`

  return {
    n,
    betaPerPct: Math.round(b),
    alphaDaily: Math.round(a),
    t: tB == null ? null : Math.round(tB * 100) / 100,
    alphaT: tA == null ? null : Math.round(tA * 100) / 100,
    r2: Math.round(r2 * 100) / 100,
    totalPnl,
    alphaPnl,
    betaPnl: betaPnlOut,
    alphaStance: stance,
    alphaNote,
    headline,
    points,
    nav,
    sectors,
    sectorHeadline,
  }
}

function weightProfile(amounts: number[]): { hhi: number; effective: number; stance: WeightStance; top: number } {
  const total = amounts.reduce((s, v) => s + v, 0)
  const n = amounts.length
  if (n === 0 || total <= 0) return { hhi: 0, effective: 0, stance: "单一", top: 0 }
  const shares = amounts.map((v) => v / total)
  const hhi = shares.reduce((s, w) => s + w * w, 0)
  const effective = hhi > 0 ? 1 / hhi : 0
  const top = Math.max(...shares)
  if (n <= 1) return { hhi, effective, stance: "单一", top }
  const equal = 1 / n
  const conc = (hhi - equal) / (1 - equal)
  const ratio = top / equal
  const stance: WeightStance = conc < 0.08 && ratio < 1.6
    ? "接近均等"
    : conc >= 0.35 || top >= 0.6
      ? "明显偏好"
      : "有所偏好"
  return { hhi, effective, stance, top }
}

function bookStancePhrase(
  stance: WeightStance,
  top: string | null,
  topPct: number | null,
  equalPct: number,
  effective: number,
  n: number,
): string {
  if (n <= 0) return "还看不出来"
  if (stance === "单一") return top ? `几乎只在${top}` : "几乎只在一个板块"
  if (stance === "接近均等") return `接近均等，有效 ${effective.toFixed(1)} 个（${n} 个等权时应接近 ${n}）`
  const how = stance === "明显偏好" ? "明显偏好" : "有所偏好"
  return `${how}${top ?? ""}（${topPct == null ? "—" : topPct.toFixed(0)}%，等权 ${equalPct.toFixed(0)}%）`
}

function sectorProductLine(s: BookRiskSector): string {
  if (s.stance === "单一") return `${s.sector}只做${s.topProduct ?? "一个品种"}`
  if (s.stance === "接近均等") return `${s.sector} ${s.productCount} 个品种，接近均等`
  const how = s.stance === "明显偏好" ? "明显偏好" : "有所偏好"
  const pct = s.topWithin == null ? "—" : `${s.topWithin.toFixed(0)}%`
  return `${s.sector} ${s.productCount} 个品种，${how}${s.topProduct ?? ""}（占该板块 ${pct}）`
}

/** Period risk shares from summed daily component variance. Weights are risk contribution, not market value. */
export function summarizeBookRisk(
  products: ProductVar,
  names: Readonly<Record<string, string>>,
): BookRisk | null {
  const acc = new Map<string, { sector: string; v: number; days: number }>()
  let days = 0
  for (const book of products.values()) {
    if (!book.size) continue
    days += 1
    for (const [code, row] of book) {
      if (!(row.v > 0)) continue
      const prev = acc.get(code)
      acc.set(code, {
        sector: row.sector,
        v: (prev?.v ?? 0) + row.v,
        days: (prev?.days ?? 0) + 1,
      })
    }
  }
  if (!acc.size) return null

  const bySector = new Map<string, { code: string; v: number; days: number }[]>()
  for (const [code, row] of acc) {
    const list = bySector.get(row.sector) ?? []
    list.push({ code, v: row.v, days: row.days })
    bySector.set(row.sector, list)
  }

  const sectorAmounts = [...bySector.entries()].map(([sector, list]) => ({
    sector,
    v: list.reduce((s, p) => s + p.v, 0),
    list,
  }))
  const book = weightProfile(sectorAmounts.map((s) => s.v))
  const total = sectorAmounts.reduce((s, x) => s + x.v, 0)
  const sectors: BookRiskSector[] = sectorAmounts
    .map((s) => {
      const inner = weightProfile(s.list.map((p) => p.v))
      const sectorTotal = s.list.reduce((sum, p) => sum + p.v, 0)
      const ranked = [...s.list].sort((a, b) => b.v - a.v)
      const top = ranked[0]
      const productsOut: BookRiskProduct[] = ranked.map((p) => ({
        code: p.code,
        name: names[p.code] || p.code,
        riskShare: r1((p.v / total) * 100),
        withinShare: sectorTotal > 0 ? r1((p.v / sectorTotal) * 100) : 0,
        days: p.days,
      }))
      return {
        sector: s.sector,
        riskShare: r1((s.v / total) * 100),
        productCount: s.list.length,
        hhi: r2(inner.hhi),
        effective: r1(inner.effective),
        stance: inner.stance,
        topProduct: top ? (names[top.code] || top.code) : null,
        topWithin: top && sectorTotal > 0 ? r1((top.v / sectorTotal) * 100) : null,
        products: productsOut,
      }
    })
    .sort((a, b) => b.riskShare - a.riskShare)

  const topSector = sectors[0] ?? null
  const equalShare = sectors.length ? 100 / sectors.length : 0
  const lines = sectors.map(sectorProductLine)
  const inner = lines.length <= 8
    ? `${lines.join("。")}。`
    : `${lines.slice(0, 6).join("。")}。其余板块见图。`
  const headline = `权重按风险贡献，不是持仓市值。这段交易 ${sectors.length} 个板块、${acc.size} 个品种。板块${bookStancePhrase(book.stance, topSector?.sector ?? null, topSector ? (topSector.riskShare) : null, equalShare, book.effective, sectors.length)}。${inner}`

  return {
    days,
    sectorCount: sectors.length,
    productCount: acc.size,
    hhi: r2(book.hhi),
    effective: r1(book.effective),
    equalShare: r1(equalShare),
    stance: book.stance,
    topSector: topSector?.sector ?? null,
    topShare: topSector?.riskShare ?? null,
    headline,
    sectors,
  }
}

export type FreqCall = "单一" | "没有显著差别" | "差别很小" | "显著不同"

export type FreqProduct = {
  code: string
  name: string
  days: number
  openLots: number
  closeLots: number
  share: number
  withinShare: number
}

export type FreqSector = {
  sector: string
  days: number
  share: number
  productCount: number
  stance: FreqCall
  p: number | null
  chi2: number | null
  topProduct: string | null
  topWithin: number | null
  products: FreqProduct[]
}

export type TradeFrequency = {
  sectorCount: number
  productCount: number
  stance: FreqCall
  p: number | null
  chi2: number | null
  equalShare: number
  topSector: string | null
  topShare: number | null
  headline: string
  sectors: FreqSector[]
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
]

function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  z -= 1
  let x = 0.99999999999980993
  for (let i = 0; i < LANCZOS.length; i++) x += LANCZOS[i]! / (z + i + 1)
  const t = z + LANCZOS.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

/** Regularized lower gamma P(s, x). */
function gammaP(s: number, x: number): number {
  if (!(s > 0) || x < 0) return NaN
  if (x === 0) return 0
  if (x < s + 1) {
    let term = 1 / s
    let sum = term
    for (let k = 1; k < 200; k++) {
      term *= x / (s + k)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-12) break
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s))
  }
  let b = x + 1 - s
  let c = 1 / 1e-30
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - s)
    b += 2
    d = an * d + b
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = b + an / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  const q = Math.exp(-x + s * Math.log(x) - logGamma(s)) * h
  return Math.min(1, Math.max(0, 1 - q))
}

function chi2Survival(x: number, df: number): number {
  if (x <= 0) return 1
  return Math.min(1, Math.max(0, 1 - gammaP(df / 2, x / 2)))
}

function chiSquareEqual(counts: number[]): { chi2: number; p: number } | null {
  const n = counts.length
  if (n < 2) return null
  const total = counts.reduce((s, v) => s + v, 0)
  if (!(total > 0)) return null
  const expected = total / n
  let chi2 = 0
  for (const observed of counts) chi2 += (observed - expected) ** 2 / expected
  return { chi2, p: chi2Survival(chi2, n - 1) }
}

function frequencyCall(counts: number[]): { stance: FreqCall; p: number | null; chi2: number | null } {
  if (counts.length <= 1) return { stance: "单一", p: null, chi2: null }
  const test = chiSquareEqual(counts)
  if (!test) return { stance: "单一", p: null, chi2: null }
  const total = counts.reduce((s, v) => s + v, 0)
  const mean = total / counts.length
  const variance = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / counts.length
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0
  const p = test.p
  const chi2 = test.chi2
  if (p >= 0.05) return { stance: "没有显著差别", p, chi2 }
  if (cv < 0.2) return { stance: "差别很小", p, chi2 }
  return { stance: "显著不同", p, chi2 }
}

function fmtP(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return "—"
  if (p < 0.001) return "<0.001"
  return p.toFixed(3)
}

function freqPhrase(
  stance: FreqCall,
  top: string | null,
  topDays: number | null,
  low: string | null,
  lowDays: number | null,
  meanDays: number,
  p: number | null,
): string {
  if (stance === "单一") return top ? `几乎只在${top}` : "几乎只在一个地方"
  if (stance === "没有显著差别") return `没有显著差别（卡方 p ${fmtP(p)}）`
  if (stance === "差别很小") return `统计上分得开，但天数挤在一起（p ${fmtP(p)}）`
  return `显著不同（p ${fmtP(p)}），${top ?? ""} ${topDays ?? "—"} 天，${low ?? ""} ${lowDays ?? "—"} 天，等权约 ${meanDays.toFixed(0)} 天`
}

function freqProductLine(s: FreqSector): string {
  const most = s.products[0]
  const least = s.products[s.products.length - 1]
  if (s.stance === "单一") return `${s.sector}只在${s.topProduct ?? "一个品种"}有成交`
  if (s.stance === "没有显著差别") return `${s.sector} ${s.productCount} 个品种，频率没有显著差别`
  if (s.stance === "差别很小") return `${s.sector} ${s.productCount} 个品种，频率差别很小`
  return `${s.sector} ${s.productCount} 个品种，频率显著不同，${most?.name ?? ""} ${most?.days ?? "—"} 天，${least?.name ?? ""} ${least?.days ?? "—"} 天`
}

/** Trading frequency is days with an open or a close. Chi-square tests those day counts against an equal split. */
export function summarizeTradeFrequency(input: {
  opens: { date: string; product: string; lots: number }[]
  closes: { date: string; product: string }[]
  closeLots: ReadonlyMap<string, number>
  names: Readonly<Record<string, string>>
  sectorOf: (product: string) => string
}): TradeFrequency | null {
  const acc = new Map<string, { sector: string; dates: Set<string>; openLots: number }>()
  const touch = (product: string, date: string, openLots: number) => {
    const code = product.trim()
    const day = date.slice(0, 10)
    if (!code || !day) return
    const sector = input.sectorOf(code)
    if (!sector) return
    const prev = acc.get(code)
    if (!prev) {
      acc.set(code, { sector, dates: new Set([day]), openLots })
      return
    }
    prev.dates.add(day)
    prev.openLots += openLots
  }
  for (const row of input.opens) touch(row.product, row.date, row.lots > 0 ? row.lots : 0)
  for (const row of input.closes) touch(row.product, row.date, 0)
  if (!acc.size) return null

  const bySector = new Map<string, { code: string; days: number; openLots: number; closeLots: number; dates: Set<string> }[]>()
  for (const [code, row] of acc) {
    if (!row.dates.size) continue
    const list = bySector.get(row.sector) ?? []
    list.push({
      code,
      days: row.dates.size,
      openLots: row.openLots,
      closeLots: input.closeLots.get(code) ?? 0,
      dates: row.dates,
    })
    bySector.set(row.sector, list)
  }
  if (!bySector.size) return null

  const sectorRows = [...bySector.entries()].map(([sector, list]) => {
    const dates = new Set<string>()
    for (const p of list) for (const d of p.dates) dates.add(d)
    return { sector, days: dates.size, list }
  })
  const dayTotal = sectorRows.reduce((s, x) => s + x.days, 0)
  const productDayTotal = sectorRows.reduce((s, x) => s + x.list.reduce((a, p) => a + p.days, 0), 0)
  const bookCall = frequencyCall(sectorRows.map((s) => s.days))
  const equalShare = sectorRows.length ? 100 / sectorRows.length : 0
  const sectors: FreqSector[] = sectorRows
    .map((s) => {
      const inner = frequencyCall(s.list.map((p) => p.days))
      const sectorDays = s.list.reduce((sum, p) => sum + p.days, 0)
      const ranked = [...s.list].sort((a, b) => b.days - a.days)
      const top = ranked[0]
      const products: FreqProduct[] = ranked.map((p) => ({
        code: p.code,
        name: input.names[p.code] || p.code,
        days: p.days,
        openLots: Math.round(p.openLots),
        closeLots: Math.round(p.closeLots),
        share: productDayTotal > 0 ? r1((p.days / productDayTotal) * 100) : 0,
        withinShare: sectorDays > 0 ? r1((p.days / sectorDays) * 100) : 0,
      }))
      return {
        sector: s.sector,
        days: s.days,
        share: dayTotal > 0 ? r1((s.days / dayTotal) * 100) : 0,
        productCount: s.list.length,
        stance: inner.stance,
        p: inner.p == null ? null : Math.round(inner.p * 1e6) / 1e6,
        chi2: inner.chi2 == null ? null : r2(inner.chi2),
        topProduct: top ? (input.names[top.code] || top.code) : null,
        topWithin: top && sectorDays > 0 ? r1((top.days / sectorDays) * 100) : null,
        products,
      }
    })
    .sort((a, b) => b.share - a.share || b.days - a.days)

  const topSector = sectors[0] ?? null
  const byDays = [...sectors].sort((a, b) => b.days - a.days)
  const hi = byDays[0] ?? null
  const lo = byDays[byDays.length - 1] ?? null
  const meanDays = sectors.length ? sectors.reduce((s, x) => s + x.days, 0) / sectors.length : 0
  const lines = sectors.map(freqProductLine)
  const inner = lines.length <= 8
    ? `${lines.join("。")}。`
    : `${lines.slice(0, 6).join("。")}。其余板块见图。`
  const headline = `交易频率按有开仓或平仓的天数，不是持仓大小。板块之间${freqPhrase(bookCall.stance, hi?.sector ?? null, hi?.days ?? null, lo?.sector ?? null, lo?.days ?? null, meanDays, bookCall.p)}。${inner}`

  return {
    sectorCount: sectors.length,
    productCount: acc.size,
    stance: bookCall.stance,
    p: bookCall.p == null ? null : Math.round(bookCall.p * 1e6) / 1e6,
    chi2: bookCall.chi2 == null ? null : r2(bookCall.chi2),
    equalShare: r1(equalShare),
    topSector: topSector?.sector ?? null,
    topShare: topSector?.share ?? null,
    headline,
    sectors,
  }
}

function namedExtreme(acc: Map<string, number>, want: "max" | "min"): { sector: string | null; value: number | null } {
  let sector: string | null = null
  let value = want === "max" ? -Infinity : Infinity
  for (const [name, v] of acc) {
    if (!Number.isFinite(v)) continue
    if (want === "max" ? v > value : v < value) {
      value = v
      sector = name
    }
  }
  if (!sector || !Number.isFinite(value)) return { sector: null, value: null }
  return { sector, value }
}

export function buildFeatureStability(
  days: DayObs[],
  nh: { date: string; close: number }[],
  books?: {
    variance: Map<string, Map<string, number>>
    pnl: Map<string, Map<string, number>>
  },
): FeatureStability {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const track: FeaturePoint[] = []
  for (let end = WINDOW; end <= ordered.length; end += STEP) {
    const slice = ordered.slice(end - WINDOW, end)
    const stats = pack(slice)
    track.push({
      date: slice[slice.length - 1]!.date,
      winRate: stats.winRate,
      payoff: stats.payoff,
      pnl: stats.pnl,
      trades: stats.trades,
      hold: stats.hold,
      hedge: stats.hedge,
      corr: stats.corr,
      sectorShare: stats.sectorShare,
    })
  }

  const tagOf = tagsFor(ordered.map((d) => d.date), nh)
  const groups: { family: string; familyLabel: string; key: Tag; label: string }[] = [
    { family: "path", familyLabel: "趋势或震荡", key: "trend", label: "趋势市" },
    { family: "path", familyLabel: "趋势或震荡", key: "range", label: "震荡市" },
    { family: "side", familyLabel: "南华 20 日方向", key: "nhUp", label: "南华上行" },
    { family: "side", familyLabel: "南华 20 日方向", key: "nhDown", label: "南华下行" },
    { family: "vol", familyLabel: "波动高低", key: "volHigh", label: "波动偏高" },
    { family: "vol", familyLabel: "波动高低", key: "volLow", label: "波动偏低" },
  ]
  const regimes: RegimeSlice[] = groups.map((g) => {
    const rows = ordered.filter((d) => tagOf.get(d.date)?.includes(g.key))
    return { family: g.family, familyLabel: g.familyLabel, key: g.key, label: g.label, ...pack(rows) }
  })

  const notes: string[] = []
  const families = ["path", "side", "vol"]
  for (const family of families) {
    const pair = regimes.filter((r) => r.family === family)
    if (pair.length !== 2) continue
    const note = pairNote(pair[0]!.familyLabel, pair[0]!, pair[1]!)
    if (note) notes.push(note)
  }

  const conditionSpec: { key: Tag; label: string }[] = [
    { key: "volHigh", label: "市场高波动" },
    { key: "volLow", label: "市场低波动" },
    { key: "nhUp", label: "市场上涨" },
    { key: "nhDown", label: "市场下跌" },
  ]
  const conditions: MarketCondition[] = conditionSpec.map((spec) => {
    const dates = ordered.filter((d) => tagOf.get(d.date)?.includes(spec.key)).map((d) => d.date)
    const varSum = new Map<string, number>()
    const varDays = new Map<string, number>()
    const pnlSum = new Map<string, number>()
    for (const date of dates) {
      const vars = books?.variance.get(date)
      if (vars) {
        for (const [name, v] of vars) {
          if (v <= 0) continue
          varSum.set(name, (varSum.get(name) ?? 0) + v)
          varDays.set(name, (varDays.get(name) ?? 0) + 1)
        }
      }
      const pnls = books?.pnl.get(date)
      if (pnls) for (const [name, v] of pnls) pnlSum.set(name, (pnlSum.get(name) ?? 0) + v)
    }
    const floor = Math.max(5, Math.floor(dates.length * 0.15))
    const eligible = new Map([...varSum].filter(([name]) => (varDays.get(name) ?? 0) >= floor))
    const riskBook = eligible.size ? eligible : varSum
    const totalVar = [...varSum.values()].reduce((s, v) => s + v, 0)
    const hi = namedExtreme(riskBook, "max")
    const lo = namedExtreme(riskBook, "min")
    const profit = namedExtreme(pnlSum, "max")
    const loss = namedExtreme(pnlSum, "min")
    const shareOf = (v: number | null) => v == null || totalVar <= 0 ? null : r1((v / totalVar) * 100)
    return {
      key: spec.key,
      label: spec.label,
      days: dates.length,
      largestRisk: { sector: hi.sector, share: shareOf(hi.value) },
      lowestRisk: { sector: lo.sector, share: shareOf(lo.value) },
      profitSector: { sector: profit.sector, pnl: profit.value == null ? null : Math.round(profit.value) },
      lossSector: { sector: loss.sector, pnl: loss.value == null ? null : Math.round(loss.value) },
    }
  })

  const r20 = rollingReturn(nh, 20)
  const volMap = vol20(nh)
  const erMap = efficiency20(nh)
  const volVals = ordered.map((d) => volMap.get(d.date)).filter((v): v is number => v != null).sort((a, b) => a - b)
  const volMed = volVals.length ? volVals[Math.floor(volVals.length / 2)]! : null
  const points: MarketPoint[] = []
  for (const day of ordered) {
    const dir = r20.get(day.date)
    const vol = volMap.get(day.date)
    const er = erMap.get(day.date)
    if (dir == null || vol == null || er == null || day.pnl === 0) continue
    points.push({
      dir: r2(dir * 100),
      vol: r2(vol * Math.sqrt(252) * 100),
      trend: r1(er * 100),
      chop: r1((1 - er) * 100),
      pnl: Math.round(day.pnl),
    })
  }
  const scatter = {
    volSplit: volMed == null ? null : r2(volMed * Math.sqrt(252) * 100),
    trendSplit: 35,
    chopSplit: 65,
    points,
  }

  const winTrack = track.map((p) => p.winRate).filter((v): v is number => v != null)
  const winStd = std(winTrack)
  const stable = winTrack.length >= 6 && winStd < 4
  const flip = notes.some((n) => n.includes("对调"))
  const headline = flip
    ? "全样本胜率和盈亏比是平均。换一段市况，这两个数会对调，不能当成一种固定风格。"
    : stable
      ? `近 ${WINDOW} 个交易日滚动来看，胜率比较稳，标准差约 ${winStd.toFixed(1)} 个百分点。`
      : winTrack.length
        ? `近 ${WINDOW} 个交易日滚动来看，胜率在动，标准差约 ${winStd.toFixed(1)} 个百分点。`
        : "这段样本太短，滚动特征还看不出来。"

  return { window: WINDOW, track, regimes, headline, notes, conditions, scatter }
}
