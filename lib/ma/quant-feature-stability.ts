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
  return {
    days: rows.length,
    winRate: decided > 0 ? r1((winLots / decided) * 100) : null,
    payoff: lossPnl < 0 ? r2(winPnl / Math.abs(lossPnl)) : null,
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

/** Diagonal Euler risk contribution. A sector's share is its slice of portfolio variance, so a large low-vol bond book stays small. */
export function sectorRiskByDay(input: {
  positions: { date: string; product: string; sector: string; longMv: number; shortMv: number }[]
  returns: { date: string; product: string; pct: number }[]
}): { top: Map<string, { topSector: string | null; share: number | null }>; variance: Map<string, Map<string, number>> } {
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
  for (const [date, book] of byDate) {
    const sectorVar = new Map<string, number>()
    let total = 0
    for (const [product, pos] of book) {
      const sigma = sigmaOn(product, date)
      if (sigma <= 0) continue
      const v = (pos.net * sigma) ** 2
      total += v
      sectorVar.set(pos.sector, (sectorVar.get(pos.sector) ?? 0) + v)
    }
    let topSector: string | null = null
    let topV = 0
    for (const [name, v] of sectorVar) {
      if (v > topV) { topV = v; topSector = name }
    }
    top.set(date, { topSector, share: total > 0 ? (topV / total) * 100 : null })
    variance.set(date, sectorVar)
  }
  return { top, variance }
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
