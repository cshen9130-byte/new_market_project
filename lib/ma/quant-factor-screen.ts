/**
 * Layered check for whether a trader uses a candidate factor, without assuming
 * a straight line.
 *
 * 1. Distance correlation (Székely) of the factor with the next session's
 *    flow, against a within-product shuffle and against one Gaussian placebo
 *    factor. This is the nonlinear screen. HSIC asks the same question but
 *    needs a kernel width; distance correlation does not.
 * 2. Counterfactual. On days this account does not open, the factor's quintiles
 *    predict the session return — the market's own law. The trade residual
 *    after that law is removed is the break. A real rule also has to beat a
 *    two-week within-product shift of the factor, so shared persistence is
 *    not enough.
 * 3. DML (already estimated) is the partial effect after nonlinear controls.
 * 4. The dose curve, and the IRL reward when it agrees, describe how the
 *    factor enters. IRL does not promote a factor on its own.
 *
 * A factor is "used" only when the screen, the break, and DML agree, and the
 * placebo factor does not clear the same screen.
 */

import type { FactorDmlRow } from "@/lib/ma/quant-factor-dml"
import type { CausalGraph } from "@/lib/ma/quant-factor-divot"
import type { IrlReport } from "@/lib/ma/quant-factor-irl"

export type AuditVerdict = "used" | "dependent" | "confounded" | "timing" | "absent"

export type AuditFactor = {
  id: string
  name: string
  outcome: "direction" | "intensity"
  verdict: AuditVerdict
  dcor: number
  breakDcor: number
  how: string
  detail: string
}

export type FactorAudit = {
  headline: string
  placeboDcor: number
  factors: AuditFactor[]
}

const CAP = 700
const PERMS = 8

export function emptyAudit(headline = "样本不够，没有做分层检验。"): FactorAudit {
  return { headline, placeboDcor: 0, factors: [] }
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

function gauss(rng: () => number): number {
  const u = Math.max(1e-12, rng())
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function strideIdx(n: number, cap: number): number[] {
  if (n <= cap) return Array.from({ length: n }, (_, i) => i)
  const out: number[] = []
  const step = n / cap
  for (let i = 0; i < cap; i++) out.push(Math.floor(i * step))
  return out
}

export function distanceCorrelation(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length
  if (n < 40 || y.length !== n) return 0
  const aRow = new Float64Array(n)
  const bRow = new Float64Array(n)
  let aGrand = 0
  let bGrand = 0
  for (let i = 0; i < n; i++) {
    let sa = 0
    let sb = 0
    const xi = x[i]!
    const yi = y[i]!
    for (let j = 0; j < n; j++) {
      sa += Math.abs(xi - x[j]!)
      sb += Math.abs(yi - y[j]!)
    }
    aRow[i] = sa / n
    bRow[i] = sb / n
    aGrand += sa
    bGrand += sb
  }
  aGrand /= n * n
  bGrand /= n * n
  let cov = 0
  let vx = 0
  let vy = 0
  for (let i = 0; i < n; i++) {
    const xi = x[i]!
    const yi = y[i]!
    for (let j = 0; j < n; j++) {
      const A = Math.abs(xi - x[j]!) - aRow[i]! - aRow[j]! + aGrand
      const B = Math.abs(yi - y[j]!) - bRow[i]! - bRow[j]! + bGrand
      cov += A * B
      vx += A * A
      vy += B * B
    }
  }
  const denom = n * n
  cov /= denom
  vx /= denom
  vy /= denom
  if (cov <= 0 || vx <= 1e-18 || vy <= 1e-18) return 0
  return Math.sqrt(cov / Math.sqrt(vx * vy))
}

function shuffle(xs: Float64Array, rng: () => number): Float64Array {
  const out = Float64Array.from(xs)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

type Pair = { product: string; x: number; y: number; ret: number; opened: number }

function rawDcor(pairs: Pair[]): number {
  const idx = strideIdx(pairs.length, CAP)
  const x = Float64Array.from(idx, (i) => pairs[i]!.x)
  const y = Float64Array.from(idx, (i) => pairs[i]!.y)
  return distanceCorrelation(x, y)
}

function screenOne(pairs: Pair[], seed: number): { dcor: number; breakDcor: number; shiftDcor: number; pass1: boolean; pass2: boolean } {
  const idx = strideIdx(pairs.length, CAP)
  const x = Float64Array.from(idx, (i) => pairs[i]!.x)
  const y = Float64Array.from(idx, (i) => pairs[i]!.y)
  const dcor = distanceCorrelation(x, y)
  const rng = mulberry32(seed)
  const nulls: number[] = []
  for (let k = 0; k < PERMS; k++) nulls.push(distanceCorrelation(x, shuffle(y, rng)))
  nulls.sort((a, b) => a - b)
  const permBar = nulls[Math.max(0, nulls.length - 2)] ?? 1
  const shiftDcor = Math.max(rotatedDcor(pairs, 8), rotatedDcor(pairs, 16))
  const breakDcor = breakCorrelation(pairs, dcor)
  return {
    dcor,
    breakDcor,
    shiftDcor,
    pass1: dcor > permBar && dcor >= 0.06,
    pass2: dcor - shiftDcor > 0.02 && breakDcor >= 0.05 && breakDcor >= dcor * 0.45,
  }
}

function rotatedDcor(pairs: Pair[], k: number): number {
  const groups = new Map<string, number[]>()
  pairs.forEach((p, i) => {
    const list = groups.get(p.product) ?? []
    list.push(i)
    groups.set(p.product, list)
  })
  const x = pairs.map((p) => p.x)
  for (const list of groups.values()) {
    if (list.length < k + 12) continue
    const vals = list.map((i) => pairs[i]!.x)
    for (let i = 0; i < list.length; i++) x[list[i]!] = vals[(i + k) % vals.length]!
  }
  const idx = strideIdx(pairs.length, CAP)
  return distanceCorrelation(Float64Array.from(idx, (i) => x[i]!), Float64Array.from(idx, (i) => pairs[i]!.y))
}

function breakCorrelation(pairs: Pair[], rawDcor: number): number {
  const quiet = pairs.filter((p) => p.opened < 0.5 && Number.isFinite(p.ret) && Number.isFinite(p.x))
  const active = pairs.filter((p) => p.opened >= 0.5 && Number.isFinite(p.y) && Number.isFinite(p.x))
  if (quiet.length < 50 || active.length < 40) return rawDcor
  const qIdx = strideIdx(quiet.length, 400)
  const law = distanceCorrelation(
    Float64Array.from(qIdx, (i) => quiet[i]!.x),
    Float64Array.from(qIdx, (i) => quiet[i]!.ret),
  )
  if (law < 0.12) return rawDcor
  const qx = quiet.map((p) => p.x).sort((a, b) => a - b)
  const edges = [0, 1, 2, 3, 4].map((b) => qx[Math.min(qx.length - 1, Math.floor(qx.length * b / 5))]!)
  const binOf = (v: number) => {
    let b = 0
    for (let i = 1; i < 5; i++) if (v >= edges[i]!) b = i
    return b
  }
  const sum = [0, 0, 0, 0, 0]
  const cnt = [0, 0, 0, 0, 0]
  for (const p of quiet) {
    const b = binOf(p.x)
    sum[b]! += p.ret
    cnt[b]!++
  }
  const mu = sum.map((s, i) => (cnt[i]! > 0 ? s / cnt[i]! : 0))
  const yRes = residualByKey(active.map((p) => p.y), active.map((p) => mu[binOf(p.x)]!))
  const idx = strideIdx(active.length, CAP)
  return distanceCorrelation(Float64Array.from(idx, (i) => active[i]!.x), Float64Array.from(idx, (i) => yRes[i]!))
}

function residualByKey(y: number[], key: number[]): number[] {
  const order = y.map((_, i) => i).sort((a, b) => key[a]! - key[b]! || a - b)
  const out = y.slice()
  const n = y.length
  for (let b = 0; b < 5; b++) {
    const a = Math.floor(n * b / 5)
    const c = Math.floor(n * (b + 1) / 5)
    if (c - a < 8) continue
    let m = 0
    for (let i = a; i < c; i++) m += y[order[i]!]!
    m /= c - a
    for (let i = a; i < c; i++) out[order[i]!]! -= m
  }
  return out
}

const HOW_DOSE: Record<string, string> = {
  linear: "线性加权",
  threshold_high: "只在最高档才动手",
  threshold_low: "离开最低档就动手",
  u: "两头才动手",
  inv_u: "中间才动手",
  steep_high: "高位变陡",
  steep_low: "低位变陡",
  uneven_up: "单调但不均匀",
  uneven_down: "单调向下但不均匀",
  nonmonotone: "非单调",
}

const VERDICT_LABEL: Record<AuditVerdict, string> = {
  used: "多方法一致，认为用了",
  dependent: "有非线性依赖，但扣掉其他状态后 DML 没站住",
  confounded: "和未交易日里市场自己的规律分不开",
  timing: "方向和规模对不上，但择时对得上",
  absent: "距离相关没有过随机因子",
}

export type DependenceScreen = {
  id: string
  dcor: number
  breakDcor: number
  shiftDcor: number
  timing: number
  pass1: boolean
  pass2: boolean
}

export function screenDependence(input: {
  products: string[]
  yDir: number[]
  yInt: number[]
  ret: number[]
  opened: number[]
  factors: { id: string; outcome: "direction" | "intensity"; values: number[] }[]
}): { placeboDcor: number; screens: DependenceScreen[] } {
  const n = input.yDir.length
  const rng = mulberry32(20260323)
  const noise = Array.from({ length: n }, () => gauss(rng))
  const outcomes = [
    { key: "direction" as const, y: input.yDir },
    { key: "intensity" as const, y: input.yInt },
  ]
  const placeboDcor = Math.max(
    ...outcomes.map((o) => {
      const pairs = collect(input.products, noise, o.y, input.ret, input.opened)
      return pairs.length < 80 ? 0 : screenOne(pairs, 17).dcor
    }),
  )
  const screens: DependenceScreen[] = []
  for (const spec of input.factors) {
    const y = spec.outcome === "direction" ? input.yDir : input.yInt
    const pairs = collect(input.products, spec.values, y, input.ret, input.opened)
    if (pairs.length < 80) continue
    const dcor = rawDcor(pairs)
    const bar = Math.max(0.06, placeboDcor)
    // Already at or under the placebo bar, so the permutation test cannot pass it.
    const screen = dcor <= bar
      ? {
          dcor,
          breakDcor: breakCorrelation(pairs, dcor),
          shiftDcor: Math.max(rotatedDcor(pairs, 8), rotatedDcor(pairs, 16)),
          pass1: false,
          pass2: false,
        }
      : screenOne(pairs, hashId(spec.id))
    const timingPairs = collect(input.products, spec.values, input.opened, input.ret, input.opened.map(() => 1))
    const timing = timingPairs.length >= 80 ? distanceCorrelation(
      Float64Array.from(strideIdx(timingPairs.length, CAP), (i) => timingPairs[i]!.x),
      Float64Array.from(strideIdx(timingPairs.length, CAP), (i) => timingPairs[i]!.y),
    ) : 0
    screens.push({ id: spec.id, timing, ...screen })
  }
  return { placeboDcor, screens }
}

export function auditFactors(input: {
  products: string[]
  yDir: number[]
  yInt: number[]
  ret: number[]
  opened: number[]
  factors: { id: string; name: string; outcome: "direction" | "intensity"; values: number[] }[]
  rows: FactorDmlRow[]
  irl: IrlReport
  causal: CausalGraph
  screened?: { placeboDcor: number; screens: DependenceScreen[] }
}): FactorAudit {
  const screened = input.screened ?? screenDependence(input)
  const placeboDcor = screened.placeboDcor
  const screenOf = new Map(screened.screens.map((s) => [s.id, s]))
  const direct = new Set(input.causal.edges.filter((e) => e.kind === "direct").map((e) => `${e.outcome}:${e.id}`))
  const irlOf = new Map(input.irl.factors.map((f) => [`${f.outcome}:${f.id}`, f.shape]))
  const rowOf = new Map(input.rows.map((r) => [r.id, r]))
  const factors: AuditFactor[] = []

  for (const spec of input.factors) {
    const screen = screenOf.get(spec.id)
    if (!screen) continue
    const bar = Math.max(0.06, placeboDcor)
    const pass1 = screen.pass1 && screen.dcor > bar
    const pass2 = screen.pass2 && screen.breakDcor >= Math.max(0.05, placeboDcor)
    const row = rowOf.get(spec.id)
    const dml = row != null && (row.verdict === "pos" || row.verdict === "neg" || (row.shape != null && row.shape !== "linear"))
    const timingPass = screen.timing >= bar && !pass1
    let verdict: AuditVerdict = "absent"
    if (pass1 && pass2 && dml) verdict = "used"
    else if (pass1 && pass2) verdict = "dependent"
    else if (pass1) verdict = "confounded"
    else if (timingPass) verdict = "timing"
    if (verdict === "absent") continue
    const how = howOf(verdict, row, irlOf.get(`${spec.outcome}:${spec.id}`))
    const edge = direct.has(`${spec.outcome}:${spec.id}`) ? "因果图里也有一条直接边。" : ""
    factors.push({
      id: spec.id,
      name: spec.name,
      outcome: spec.outcome,
      verdict,
      dcor: round3(screen.dcor),
      breakDcor: round3(screen.breakDcor),
      how,
      detail: `${VERDICT_LABEL[verdict]}。距离相关 ${screen.dcor.toFixed(2)}，去掉未交易日市场规律后还剩 ${screen.breakDcor.toFixed(2)}（后移两周是 ${screen.shiftDcor.toFixed(2)}）。${how === "—" ? "" : `用法：${how}。`}${edge}`,
    })
  }

  const rank = { used: 0, dependent: 1, timing: 2, confounded: 3, absent: 4 }
  factors.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.dcor - a.dcor)
  return {
    headline: headlineOf(factors, placeboDcor),
    placeboDcor: round3(placeboDcor),
    factors,
  }
}

function collect(products: string[], x: number[], y: number[], ret: number[], opened: number[]): Pair[] {
  const out: Pair[] = []
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue
    out.push({
      product: products[i] ?? "",
      x: x[i]!,
      y: y[i]!,
      ret: Number.isFinite(ret[i]) ? ret[i]! : 0,
      opened: opened[i] ?? 0,
    })
  }
  return out
}

function howOf(verdict: AuditVerdict, row: FactorDmlRow | undefined, irlShape: string | undefined): string {
  if (verdict !== "used" && verdict !== "dependent") return "—"
  if (row?.shape && row.shape !== "linear") return HOW_DOSE[row.shape] ?? row.shape
  if (irlShape && irlShape !== "linear") return HOW_DOSE[irlShape] ?? irlShape
  if (row && (row.verdict === "pos" || row.verdict === "neg")) return "线性加权"
  return "依赖还在，形状不稳定"
}

function headlineOf(factors: AuditFactor[], placebo: number): string {
  const used = factors.filter((f) => f.verdict === "used")
  const bits = used.slice(0, 4).map((f) => `${f.name}（${f.how}）`)
  const lead = used.length
    ? `多方法一致，认为用了：${bits.join("、")}${used.length > 4 ? `，另外 ${used.length - 4} 个` : ""}。`
    : "没有因子同时通过距离相关、未交易日反事实和 DML。"
  const rest = [
    count(factors, "dependent", "只停在非线性依赖"),
    count(factors, "confounded", "和市场自身规律分不开"),
    count(factors, "timing", "只在择时上对得上"),
  ].filter(Boolean)
  const tail = rest.length ? `${rest.join("，")}。` : ""
  return `${lead}${tail}随机因子的距离相关是 ${placebo.toFixed(2)}，同一条线没有把它判成使用。`
}

function count(factors: AuditFactor[], verdict: AuditVerdict, label: string): string {
  const n = factors.filter((f) => f.verdict === verdict).length
  return n ? `${label} ${n} 个` : ""
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
