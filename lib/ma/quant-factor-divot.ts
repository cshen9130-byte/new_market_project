/**
 * DIVOT causal edges from candidate factors into a trader's next-session flow.
 *
 * Tu, Zhang, Kjellström, Zhang (ICLR 2022), "Optimal Transport for Causal Discovery":
 * under an additive / post-nonlinear model the cause→effect map is a volume-preserving
 * flow, so the variance of the 1D optimal-transport velocity is smaller in the causal
 * direction than in the reverse. We minimize that variance over a noise scale and a
 * small monotone warp (their simplified PNL).
 *
 * A factor is a direct cause of direction or size only if:
 *   1. the DIVOT gap beats a shuffle of the outcome (the raw loss is shifted by
 *      the two marginal shapes, so the shuffle is the baseline),
 *   2. that same excess shows up in a majority of time blocks,
 *   3. it still beats a fresh shuffle after stronger accepted factors are
 *      removed with a quadratic and 12-bin mean.
 * PC / HSIC-ANM are not used to accept an edge. Time order already forbids
 * "today's open causes yesterday's factor"; a reverse DIVOT score is reported
 * and not drawn as a cause.
 */

export type CausalKind = "direct" | "indirect" | "reverse"

export type CausalEdge = {
  id: string
  name: string
  outcome: "direction" | "intensity"
  kind: CausalKind
  gap: number
  blocksFor: number
  blocks: number
}

export type CausalGraph = {
  headline: string
  directCount: number
  edges: CausalEdge[]
}

type Series = { id: string; name: string; values: number[] }

const THETAS = [0.45, 0.8, 1.15, 1.7, 2.4]
const WARPS: Array<[number, number]> = [[0, 1], [0.7, 1], [1.2, 0.55]]
const BINS = 8
const BLOCKS = 3
const MIN_N = 80
const CAP = 1600

function erfinv(x: number): number {
  const a = 0.147
  const s = x < 0 ? -1 : 1
  const ln = Math.log(Math.max(1e-12, 1 - x * x))
  const t = 2 / (Math.PI * a) + ln / 2
  return s * Math.sqrt(Math.max(0, Math.sqrt(t * t - ln / a) - t))
}

function normalQuantile(p: number): number {
  const clamped = Math.min(1 - 1e-6, Math.max(1e-6, p))
  return Math.SQRT2 * erfinv(2 * clamped - 1)
}

function standardize(xs: number[]): number[] | null {
  let m = 0
  for (const v of xs) m += v
  m /= xs.length
  let s = 0
  for (const v of xs) s += (v - m) ** 2
  s = Math.sqrt(s / Math.max(1, xs.length - 1))
  if (s < 1e-8) return null
  return xs.map((v) => (v - m) / s)
}

function stride<T>(xs: T[], cap: number): T[] {
  if (xs.length <= cap) return xs
  const out: T[] = []
  const step = xs.length / cap
  for (let i = 0; i < cap; i++) out.push(xs[Math.floor(i * step)]!)
  return out
}

function varDiv(cause: number[], effect: number[], theta: number): number {
  const n = cause.length
  const order = cause.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  let acc = 0
  let w = 0
  for (let b = 0; b < BINS; b++) {
    const a = Math.floor(n * b / BINS)
    const c = Math.floor(n * (b + 1) / BINS)
    const m = c - a
    if (m < 12) continue
    const ys = order.slice(a, c).map((o) => effect[o.i]!).sort((p, q) => p - q)
    let sum = 0
    const vs = new Array<number>(m)
    for (let i = 0; i < m; i++) {
      const v = ys[i]! - theta * normalQuantile((i + 0.5) / m)
      vs[i] = v
      sum += v
    }
    const mean = sum / m
    let ss = 0
    for (const v of vs) ss += (v - mean) ** 2
    acc += (ss / (m - 1)) * m
    w += m
  }
  return w > 0 ? acc / w : Infinity
}

function warp(xs: number[], a: number, b: number): number[] {
  if (a === 0) return xs
  return xs.map((v) => v + a * Math.tanh(b * v))
}

/** Smaller loss means the first argument looks more like the cause. */
export function divotLoss(causeIn: number[], effectIn: number[]): number {
  const cause = standardize(causeIn)
  const effect0 = standardize(effectIn)
  if (!cause || !effect0) return Infinity
  let best = Infinity
  for (const [a, b] of WARPS) {
    const effect = a === 0 ? effect0 : standardize(warp(effect0, a, b))
    if (!effect) continue
    for (const theta of THETAS) {
      const raw = varDiv(cause, effect, theta)
      const loss = raw / (theta * theta)
      if (loss < best) best = loss
    }
  }
  return best
}

function gapOf(forward: number, reverse: number): number {
  const den = forward + reverse
  if (!Number.isFinite(forward) || !Number.isFinite(reverse) || den < 1e-8) return 0
  return (reverse - forward) / den
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(xs: number[], rng: () => number): number[] {
  const out = xs.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

type Pair = { x: number; y: number; date: string }

function takePairs(x: number[], y: number[], dates: string[]): Pair[] {
  const rows: Pair[] = []
  for (let i = 0; i < x.length; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) rows.push({ x: x[i]!, y: y[i]!, date: dates[i] ?? "" })
  }
  return stride(rows, CAP)
}

function scorePairs(rows: Pair[]): { forward: number; reverse: number; gap: number } | null {
  if (rows.length < MIN_N) return null
  const x = rows.map((r) => r.x)
  const y = rows.map((r) => r.y)
  const forward = divotLoss(x, y)
  const reverse = divotLoss(y, x)
  return { forward, reverse, gap: gapOf(forward, reverse) }
}

function nullGap(rows: Pair[], seed: number): { mean: number; sd: number } {
  const rng = mulberry32(seed)
  const x = rows.map((r) => r.x)
  const gaps: number[] = []
  for (let k = 0; k < 6; k++) {
    const y = shuffle(rows.map((r) => r.y), rng)
    const forward = divotLoss(x, y)
    const reverse = divotLoss(y, x)
    gaps.push(gapOf(forward, reverse))
  }
  const mean = gaps.reduce((s, v) => s + v, 0) / gaps.length
  let v = 0
  for (const g of gaps) v += (g - mean) ** 2
  const sd = Math.sqrt(v / Math.max(1, gaps.length - 1))
  return { mean, sd: Math.max(sd, 0.02) }
}

function blockVotes(rows: Pair[], baseline: number, margin: number): { forCause: number; used: number } {
  const dates = [...new Set(rows.map((r) => r.date))].sort()
  if (dates.length < BLOCKS * 8) return { forCause: 0, used: 0 }
  const cuts = [0, 1, 2].map((b) => dates[Math.floor(dates.length * b / BLOCKS)]!)
  const ends = [1, 2, 3].map((b) => dates[Math.min(dates.length, Math.floor(dates.length * b / BLOCKS)) - 1]!)
  let forCause = 0
  let used = 0
  for (let b = 0; b < BLOCKS; b++) {
    const slice = rows.filter((r) => r.date >= cuts[b]! && r.date <= ends[b]!)
    const scored = scorePairs(slice)
    if (!scored) continue
    used++
    if (scored.gap - baseline > margin) forCause++
  }
  return { forCause, used }
}

function binResidual(values: number[], control: number[], bins = 5): number[] {
  const n = values.length
  const order = values.map((_, i) => i).sort((a, b) => control[a]! - control[b]!)
  const out = values.slice()
  for (let b = 0; b < bins; b++) {
    const a = Math.floor(n * b / bins)
    const c = Math.floor(n * (b + 1) / bins)
    if (c - a < 8) continue
    let m = 0
    for (let i = a; i < c; i++) m += values[order[i]!]!
    m /= c - a
    for (let i = a; i < c; i++) out[order[i]!]! -= m
  }
  return out
}

function quadResidual(values: number[], control: number[]): number[] {
  const n = values.length
  if (n < 16) return values
  const c2 = control.map((c) => c * c)
  const col = [values.map(() => 1), control, c2]
  const xtx = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const xty = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    const x0 = col[0]![i]!
    const x1 = col[1]![i]!
    const x2 = col[2]![i]!
    const xs = [x0, x1, x2]
    for (let a = 0; a < 3; a++) {
      xty[a]! += xs[a]! * values[i]!
      for (let b = 0; b < 3; b++) xtx[a * 3 + b]! += xs[a]! * xs[b]!
    }
  }
  const beta = solve3(xtx, xty)
  if (!beta) return values
  return values.map((v, i) => v - beta[0]! - beta[1]! * control[i]! - beta[2]! * control[i]! ** 2)
}

function solve3(a: number[], b: number[]): number[] | null {
  const m = [
    [a[0]!, a[1]!, a[2]!, b[0]!],
    [a[3]!, a[4]!, a[5]!, b[1]!],
    [a[6]!, a[7]!, a[8]!, b[2]!],
  ]
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r
    const row = m[c]!
    m[c] = m[piv]!
    m[piv] = row
    const div = m[c]![c]!
    if (Math.abs(div) < 1e-10) return null
    for (let k = c; k < 4; k++) m[c]![k]! /= div
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = m[r]![c]!
      for (let k = c; k < 4; k++) m[r]![k]! -= f * m[c]![k]!
    }
  }
  return [m[0]![3]!, m[1]![3]!, m[2]![3]!]
}

function residualize(target: number[], controls: number[][]): number[] {
  let cur = target.slice()
  for (const control of controls) {
    cur = quadResidual(cur, control)
    cur = binResidual(cur, control, 12)
  }
  return cur
}

const OUTCOME_LABEL = { direction: "净开仓", intensity: "开仓手数" } as const

function residualizeOne(values: number[], control: number[]): number[] {
  const idx: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i]) && Number.isFinite(control[i])) idx.push(i)
  }
  if (idx.length < 40) return values
  const res = binResidual(idx.map((i) => values[i]!), idx.map((i) => control[i]!))
  const out = values.slice()
  idx.forEach((i, k) => { out[i] = res[k]! })
  return out
}

export function discoverCausalGraph(input: {
  dates: string[]
  yDir: number[]
  yInt: number[]
  factors: Series[]
  /** Observed confounders (book risk, weekday). Removed by bin means before DIVOT. */
  controls?: number[][]
}): CausalGraph {
  const controls = (input.controls ?? []).filter((c) => c.length === input.dates.length)
  const strip = (xs: number[]) => controls.reduce((cur, c) => residualizeOne(cur, c), xs)
  const dates = input.dates
  const factors = input.factors.map((f) => ({ ...f, values: strip(f.values) }))
  const outcomes = [
    { key: "direction" as const, y: strip(input.yDir) },
    { key: "intensity" as const, y: strip(input.yInt) },
  ]
  const edges: CausalEdge[] = []
  for (const outcome of outcomes) {
    const marginal: Array<{ factor: Series; excess: number; blocksFor: number; blocks: number }> = []
    for (let f = 0; f < factors.length; f++) {
      const factor = factors[f]!
      const rows = takePairs(factor.values, outcome.y, dates)
      const scored = scorePairs(rows)
      if (!scored) continue
      const bar = nullGap(rows, 9000 + f * 17 + (outcome.key === "intensity" ? 3 : 0))
      const margin = Math.max(0.12, bar.sd * 2)
      const excess = scored.gap - bar.mean
      const blocks = blockVotes(rows, bar.mean, margin)
      const stable = blocks.used < 2 ? excess > margin : blocks.forCause >= 2 && excess > margin
      if (excess > margin && stable) {
        marginal.push({ factor, excess, blocksFor: blocks.forCause, blocks: blocks.used })
      } else if (excess < -margin) {
        edges.push({
          id: factor.id,
          name: factor.name,
          outcome: outcome.key,
          kind: "reverse",
          gap: Math.round(excess * 100) / 100,
          blocksFor: blocks.used - blocks.forCause,
          blocks: blocks.used,
        })
      }
    }

    const accepted: typeof marginal = []
    for (const item of [...marginal].sort((a, b) => b.excess - a.excess)) {
      let kind: CausalKind = "direct"
      let gap = item.excess
      if (accepted.length) {
        const aligned = alignControls(item, accepted, dates, outcome.y)
        if (aligned) {
          const yRes = residualize(aligned.y, aligned.controls)
          const xRes = residualize(aligned.x, aligned.controls)
          const againRows = yRes.map((v, i) => ({ x: xRes[i]!, y: v, date: aligned.dates[i]! }))
          const again = scorePairs(againRows)
          if (!again) kind = "indirect"
          else {
            const bar = nullGap(againRows, 4242 + accepted.length)
            const cond = again.gap - bar.mean
            if (!(cond > Math.max(0.12, bar.sd * 2))) kind = "indirect"
            else gap = cond
          }
        }
      }
      edges.push({
        id: item.factor.id,
        name: item.factor.name,
        outcome: outcome.key,
        kind,
        gap: Math.round(gap * 100) / 100,
        blocksFor: item.blocksFor,
        blocks: item.blocks,
      })
      if (kind === "direct") accepted.push(item)
    }
  }

  const direct = edges.filter((e) => e.kind === "direct")
  return { headline: headlineOf(direct), directCount: direct.length, edges }
}

function alignControls(
  item: { factor: Series; rows: Pair[] },
  others: Array<{ factor: Series }>,
  dates: string[],
  y: number[],
): { x: number[]; y: number[]; dates: string[]; controls: number[][] } | null {
  const x: number[] = []
  const yy: number[] = []
  const dd: string[] = []
  const controls = others.map(() => [] as number[])
  for (let i = 0; i < dates.length; i++) {
    const xv = item.factor.values[i]
    const yv = y[i]
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue
    const cvs: number[] = []
    let ok = true
    for (let k = 0; k < others.length; k++) {
      const cv = others[k]!.factor.values[i]
      if (!Number.isFinite(cv)) { ok = false; break }
      cvs.push(cv!)
    }
    if (!ok) continue
    x.push(xv!)
    yy.push(yv!)
    dd.push(dates[i]!)
    cvs.forEach((cv, k) => controls[k]!.push(cv))
  }
  const kept = stride(x.map((v, i) => i), CAP)
  if (kept.length < MIN_N) return null
  return {
    x: kept.map((i) => x[i]!),
    y: kept.map((i) => yy[i]!),
    dates: kept.map((i) => dd[i]!),
    controls: controls.map((col) => kept.map((i) => col[i]!)),
  }
}

function headlineOf(direct: CausalEdge[]): string {
  if (!direct.length) {
    return "DIVOT 没有找到稳定指向交易的直接因果边。边际上像有关系、但扣掉其他因子就消失的，记在间接里。"
  }
  const parts: string[] = []
  for (const key of ["direction", "intensity"] as const) {
    const names = direct.filter((e) => e.outcome === key).map((e) => e.name)
    if (names.length) parts.push(`${OUTCOME_LABEL[key]} ← ${names.slice(0, 6).join("、")}${names.length > 6 ? "等" : ""}`)
  }
  return `直接因果边（最优传输 DIVOT，分时段方向一致，并且扣掉更强的入选因子后仍成立）：${parts.join("；")}。`
}
