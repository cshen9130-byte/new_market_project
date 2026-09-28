/**
 * Classify a book into 择时 / 选票 / 指数增强 / 多空 / 截面 from end-of-day
 * positions. These labels describe how the book is built, not whether a
 * factor regression is linear.
 *
 * 截面: many names, both sides occupied, net near zero. A smaller book still
 * counts when the position lines up with the cross-sectional 20-day return.
 * 多空: both sides have capital and the net is modest, without that breadth.
 * 指数增强: stable net long, tracks 南华 (or is itself stock-index futures),
 * and the names are spread out.
 * 择时: names share a direction, and the net exposure moves over time.
 * 选票: a few names, one direction.
 */

export const BOOK_STYLES = ["择时", "选票", "指数增强", "多空", "截面"] as const
export type BookStyleKind = (typeof BOOK_STYLES)[number]

export type BookStyle = {
  primary: BookStyleKind | null
  secondary: BookStyleKind | null
  detail: string
  scores: { kind: BookStyleKind; score: number }[]
}

const INDEX_PRODUCTS = new Set(["IF", "IH", "IC", "IM"])

type Pos = { date: string; product: string; longMv: number; shortMv: number; mv: number }
type Px = { product: string; date: string; close: number }

function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

function mean(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 6 || ys.length !== n) return null
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

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i)
  const out = new Array<number>(xs.length)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[order[k]!.i] = avg
    i = j + 1
  }
  return out
}

function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 6) return null
  return pearson(ranks(xs), ranks(ys))
}

function prevCloseIndex(dates: string[], day: string): number {
  let lo = 0
  let hi = dates.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid]! < day) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

function signedPct(x: number): string {
  const v = Math.round(x * 100)
  return v > 0 ? `+${v}%` : `${v}%`
}

export function classifyBookStyle(input: {
  positions: Pos[]
  prices: Px[]
  corrNhci: number | null
}): BookStyle {
  const byDay = new Map<string, Pos[]>()
  for (const row of input.positions) {
    if (!row.date || !row.product || !(row.mv > 0)) continue
    const list = byDay.get(row.date) ?? []
    list.push(row)
    byDay.set(row.date, list)
  }

  const series = new Map<string, { dates: string[]; close: number[] }>()
  const pxSorted = [...input.prices].filter((p) => p.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  for (const p of pxSorted) {
    const cur = series.get(p.product) ?? { dates: [], close: [] }
    if (cur.dates[cur.dates.length - 1] === p.date) {
      cur.close[cur.close.length - 1] = p.close
    } else {
      cur.dates.push(p.date)
      cur.close.push(p.close)
    }
    series.set(p.product, cur)
  }

  const ret20 = (product: string, day: string): number | null => {
    const s = series.get(product)
    if (!s) return null
    const i = prevCloseIndex(s.dates, day)
    if (i < 20) return null
    const prev = s.close[i - 20]!
    if (prev <= 0) return null
    return s.close[i]! / prev - 1
  }

  const net: number[] = []
  const absNetDays: number[] = []
  const hedge: number[] = []
  const sameSign: number[] = []
  const top3: number[] = []
  const breadth: number[] = []
  const gross: number[] = []
  const indexShare: number[] = []
  const lockShare: number[] = []
  let bothBroadDays = 0
  const rhos: number[] = []

  for (const [day, rows] of byDay) {
    let longMv = 0
    let shortMv = 0
    let grossMv = 0
    let indexMv = 0
    let lockMv = 0
    let nLong = 0
    let nShort = 0
    const weights: number[] = []
    const signed: number[] = []
    const mom: number[] = []
    for (const row of rows) {
      const g = row.mv > 0 ? row.mv : row.longMv + row.shortMv
      if (!(g > 0)) continue
      grossMv += g
      longMv += row.longMv
      shortMv += row.shortMv
      if (INDEX_PRODUCTS.has(row.product)) indexMv += g
      const locked = row.longMv > 0 && row.shortMv > 0
      if (locked) lockMv += g
      else if (row.longMv > row.shortMv) nLong++
      else if (row.shortMv > row.longMv) nShort++
      weights.push(g)
      const r = ret20(row.product, day)
      if (r != null && !locked) {
        signed.push((row.longMv - row.shortMv) / g)
        mom.push(r)
      }
    }
    if (!(grossMv > 0) || weights.length < 1) continue
    const n = weights.length
    const netRatio = (longMv - shortMv) / grossMv
    net.push(netRatio)
    absNetDays.push(Math.abs(netRatio))
    hedge.push((2 * Math.min(longMv, shortMv)) / grossMv)
    sameSign.push(n > 0 ? Math.max(nLong, nShort) / n : 0)
    weights.sort((a, b) => b - a)
    top3.push(weights.slice(0, 3).reduce((a, b) => a + b, 0) / grossMv)
    breadth.push(n)
    gross.push(grossMv)
    indexShare.push(indexMv / grossMv)
    lockShare.push(lockMv / grossMv)
    if (nLong >= 3 && nShort >= 3) bothBroadDays++
    const rho = spearman(signed, mom)
    if (rho != null) rhos.push(rho)
  }

  const days = net.length
  const empty: BookStyle = {
    primary: null,
    secondary: null,
    detail: "持仓天数不够，没有做择时、选票、指数增强、多空、截面的归类。",
    scores: BOOK_STYLES.map((kind) => ({ kind, score: 0 })),
  }
  if (days < 20) return empty

  const netMean = mean(net)
  const absNet = mean(absNetDays)
  const netStd = stdev(net)
  const hedgeAvg = mean(hedge)
  const sameAvg = mean(sameSign)
  const top3Avg = mean(top3)
  const breadthMed = median(breadth)
  const bothBroad = bothBroadDays / days
  const lockAvg = mean(lockShare)
  const indexAvg = mean(indexShare)
  const grossCv = mean(gross) > 0 ? stdev(gross) / mean(gross) : 0
  const csRho = rhos.length >= 8 ? mean(rhos) : null
  const corr = input.corrNhci

  const nameSpan = clamp01((breadthMed - 4) / 6)
  const netFlat = clamp01((0.28 - absNet) / 0.28)
  const both = clamp01((bothBroad - 0.2) / 0.45)
  const csStruct = both * netFlat * nameSpan
  const csSignal = csRho == null ? 0 : clamp01((Math.abs(csRho) - 0.06) / 0.2)
  const scoreCs = csStruct * (0.55 + 0.45 * csSignal)
  const scoreLs = clamp01((hedgeAvg - 0.18) / 0.4) * netFlat * clamp01((0.45 - lockAvg) / 0.45) * (1 - 0.5 * scoreCs)
  const together = clamp01((sameAvg - 0.6) / 0.3)
  const swings = Math.max(clamp01((netStd - 0.14) / 0.24), clamp01((grossCv - 0.28) / 0.45) * clamp01((netMean + 1) / 2))
  const indexLink = corr == null ? 0.4 : clamp01((Math.abs(corr) - 0.02) / 0.28)
  const scoreTiming = swings * together * (0.6 + 0.4 * indexLink) * clamp01((0.45 - hedgeAvg) / 0.45)
  const stableLong = clamp01((netMean - 0.35) / 0.4) * clamp01((0.3 - netStd) / 0.3)
  const tracks = Math.max(
    corr == null ? 0 : clamp01((corr - 0.12) / 0.4),
    indexAvg >= 0.5 ? clamp01((indexAvg - 0.4) / 0.4) : 0,
  )
  const diversified = clamp01((0.7 - top3Avg) / 0.35) * clamp01((breadthMed - 6) / 6)
  const scoreIdx = stableLong * tracks * Math.max(diversified, indexAvg >= 0.55 ? 0.75 : 0) * clamp01((0.4 - hedgeAvg) / 0.4)
  const scorePick = clamp01((top3Avg - 0.42) / 0.35) * together * clamp01((0.4 - hedgeAvg) / 0.4) * (1 - 0.65 * scoreIdx)

  const scores: { kind: BookStyleKind; score: number }[] = [
    { kind: "择时", score: round2(scoreTiming) },
    { kind: "选票", score: round2(scorePick) },
    { kind: "指数增强", score: round2(scoreIdx) },
    { kind: "多空", score: round2(scoreLs) },
    { kind: "截面", score: round2(scoreCs) },
  ]

  // |mean(net)| cancels a book that is long for a while and short later.
  // Neutrality is the typical day's absolute net. Breadth alone is not a cross-section:
  // these accounts all hold dozens of names and a few shorts.
  const crossSection = absNet <= 0.16 && hedgeAvg >= 0.82 && bothBroad >= 0.6 && breadthMed >= 10 && lockAvg < 0.25
  const timing = !crossSection && absNet >= 0.22 && sameAvg >= 0.65 && hedgeAvg <= 0.7
    && (netStd >= 0.32 || (grossCv >= 0.5 && netStd <= 0.3 && netMean > 0.25))
  const indexPlus = !crossSection && !timing && (
    (netMean >= 0.4 && absNet >= 0.35 && netStd <= 0.22 && (corr ?? 0) >= 0.28 && top3Avg <= 0.62 && breadthMed >= 8 && hedgeAvg <= 0.4)
    || (indexAvg >= 0.55 && netMean >= 0.5 && absNet >= 0.4 && netStd <= 0.28 && hedgeAvg < 0.35)
  )
  const picking = !crossSection && !timing && !indexPlus
    && top3Avg >= 0.55 && hedgeAvg <= 0.4 && sameAvg >= 0.7 && !(indexAvg >= 0.55 && netStd <= 0.28)
  const longShort = !crossSection && !timing && !indexPlus && !picking
    && hedgeAvg >= 0.4 && absNet <= 0.75 && lockAvg < 0.3

  let primary: BookStyleKind | null = null
  if (crossSection) primary = "截面"
  else if (timing) primary = "择时"
  else if (indexPlus) primary = "指数增强"
  else if (picking) primary = "选票"
  else if (longShort) primary = "多空"
  else {
    const best = [...scores].sort((a, b) => b.score - a.score)[0]
    if (best && best.score >= 0.4) primary = best.kind
  }

  const flags: { kind: BookStyleKind; on: boolean }[] = [
    { kind: "截面", on: crossSection },
    { kind: "多空", on: longShort },
    { kind: "指数增强", on: indexPlus },
    { kind: "择时", on: timing },
    { kind: "选票", on: picking },
  ]
  let secondary: BookStyleKind | null = flags.find((f) => {
    if (!f.on || f.kind === primary) return false
    if (primary === "截面" && f.kind === "多空") return false
    if (primary === "多空" && f.kind === "截面") return false
    return true
  })?.kind ?? null
  if (!secondary && primary) {
    const next = [...scores].filter((s) => s.kind !== primary).sort((a, b) => b.score - a.score)[0]
    const trivialPair = (primary === "截面" && next?.kind === "多空") || (primary === "多空" && next?.kind === "截面")
    if (next && !trivialPair && next.score >= 0.4 && next.score >= (scores.find((s) => s.kind === primary)?.score ?? 0) * 0.7) {
      secondary = next.kind
    }
  }

  const measured = [
    `典型日净敞口 ${pct(absNet)}，方向偏向 ${signedPct(netMean)}，日度波动 ${pct(netStd)}`,
    `对冲度 ${pct(hedgeAvg)}`,
    `持仓中位 ${breadthMed.toFixed(0)} 个品种，前三品种占市值 ${pct(top3Avg)}`,
    `同向品种占比 ${pct(sameAvg)}`,
    csRho == null ? "" : `持仓与此前 20 日截面收益的秩相关 ${csRho.toFixed(2)}`,
    corr == null ? "" : `账户日盈亏与南华相关 ${corr.toFixed(2)}`,
  ].filter(Boolean).join("。")

  const why: Record<BookStyleKind, string> = {
    截面: `典型交易日净敞口只有 ${pct(absNet)}，对冲度 ${pct(hedgeAvg)}，多空两边都铺开，净头寸几乎对掉。`,
    多空: `多头和空头市值同时在账上，对冲度 ${pct(hedgeAvg)}，但典型日仍留着 ${pct(absNet)} 的净敞口，还不是对掉的截面。`,
    指数增强: indexAvg >= 0.55
      ? `仓位主要在股指期货上，净多头稳定在 ${signedPct(netMean)} 附近。`
      : `净多头稳定在 ${signedPct(netMean)} 附近，日盈亏与南华相关 ${corr == null ? "—" : corr.toFixed(2)}，品种没有挤在少数名字里。`,
    择时: grossCv >= 0.5 && netStd < 0.22
      ? `同向品种占 ${pct(sameAvg)}，总仓位大小在变，净敞口日度波动 ${pct(netStd)}。`
      : `同向品种占 ${pct(sameAvg)}，净敞口日度波动 ${pct(netStd)}，方向随时间在变。`,
    选票: `前三品种占市值 ${pct(top3Avg)}，持仓中位 ${breadthMed.toFixed(0)} 个品种，方向集中在少数名字上。`,
  }
  const lead = primary
    ? `归为${primary}${secondary ? `，其次是${secondary}` : ""}。${why[primary]}`
    : "五项都没有形成稳定结构。"

  return {
    primary,
    secondary,
    detail: `${lead}${measured}。`,
    scores,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
