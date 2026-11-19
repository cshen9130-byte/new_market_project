import { PROD_NAMES, PROD_SECTOR } from "@/lib/ma/prod-sector"

/** Canonical window stored in public.mom_position_var_daily. Matches the risk-page defaults. */
export const MOM_POSITION_VAR_SPEC = {
  volDays: 20,
  corrDays: 252,
  confidence: 95,
  zScore: 1.6449,
  dist: "normal" as const,
}

const PROD_CAT: Record<string, string> = {
  C: "商品", CS: "商品", WH: "商品", PM: "商品", RR: "商品", RI: "商品", JR: "商品", LR: "商品",
  A: "商品", B: "商品", M: "商品", Y: "商品", RM: "商品", OI: "商品", RS: "商品", PK: "商品", P: "商品",
  SR: "商品", CF: "商品", CY: "商品", LG: "商品", SP: "商品", OP: "商品",
  AP: "商品", CJ: "商品", LH: "商品", JD: "商品",
  AU: "商品", AG: "商品", PT: "商品", PD: "商品",
  CU: "商品", BC: "商品", AL: "商品", AO: "商品", AD: "商品", ZN: "商品", PB: "商品", NI: "商品", SN: "商品",
  LC: "商品", PS: "商品", SI: "商品",
  I: "商品", SF: "商品", SM: "商品", RB: "商品", HC: "商品", SS: "商品", WR: "商品",
  JM: "商品", J: "商品", ZC: "商品", FG: "商品", BB: "商品", FB: "商品",
  SC: "商品", FU: "商品", LU: "商品", PG: "商品", BU: "商品",
  TA: "商品", EG: "商品", PF: "商品", PR: "商品", PL: "商品", PP: "商品", L: "商品",
  BZ: "商品", PX: "商品", EB: "商品",
  RU: "商品", BR: "商品", NR: "商品",
  SA: "商品", SH: "商品", V: "商品", UR: "商品", MA: "商品",
  EC: "商品",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}

const PROD_SUB_SECTOR: Record<string, string> = {
  C: "谷物", CS: "谷物", WH: "谷物", PM: "谷物", RR: "谷物", RI: "谷物", JR: "谷物", LR: "谷物",
  A: "油脂油料", B: "油脂油料", M: "油脂油料", Y: "油脂油料", RM: "油脂油料", OI: "油脂油料", RS: "油脂油料", PK: "油脂油料", P: "油脂油料",
  SR: "软商品", CF: "软商品", CY: "软商品",
  LG: "林业", SP: "林业", OP: "林业",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "原材", SF: "原材", SM: "原材",
  RB: "成材", HC: "成材", SS: "成材", WR: "成材",
  JM: "煤炭", J: "煤炭", ZC: "煤炭",
  FG: "建材", BB: "建材", FB: "建材",
  SC: "油品", FU: "油品", LU: "油品", PG: "油品", BU: "油品",
  TA: "聚酯", EG: "聚酯", PF: "聚酯", PR: "聚酯",
  PL: "烯烃", PP: "烯烃", L: "烯烃",
  BZ: "芳烃", PX: "芳烃", EB: "芳烃",
  RU: "橡胶", BR: "橡胶", NR: "橡胶",
  SA: "盐化工", SH: "盐化工", V: "盐化工",
  UR: "煤化工", MA: "煤化工",
  EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}

export type PositionVarProduct = {
  code: string
  name: string | null
  sector: string
  category: string
  subSector: string
  marketValue: number
  lots: number
  sigma: number
  componentVar: number
  marginalPct: number
  mcr: number
}

export type PositionVarGroup = {
  name: string
  marketValue: number
  componentVar: number
  marginalPct: number
  mcr: number
}

export type PositionVarDay = {
  date: string
  totalVar: number
  netMarketValue: number
  totalMcr: number
  cat: Record<string, number>
  sector: Record<string, number>
  sub: Record<string, number>
  products: PositionVarProduct[]
  groups: {
    category: PositionVarGroup[]
    sector: PositionVarGroup[]
    sub: PositionVarGroup[]
  }
}

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/**
 * Zero out contract-rollover spike returns so .filter(r=>r!==0) excludes them.
 * Uses rolling MAD: excludes returns > max(6%, median_abs + 12*MAD*1.4826).
 */
export function zeroRolloverSpikes(rets: number[]): number[] {
  if (rets.length < 2) return [...rets]
  const MIN_THRESHOLD = 0.06, K = 12, LOOKBACK = 40
  const out = [...rets]
  for (let i = LOOKBACK; i < rets.length; i++) {
    const win = rets.slice(i - LOOKBACK, i).map(Math.abs).sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    const devs = win.map(v => Math.abs(v - med)).sort((a, b) => a - b)
    const mad = devs[Math.floor(devs.length / 2)]
    const thr = Math.max(MIN_THRESHOLD, med + K * mad * 1.4826)
    if (Math.abs(rets[i]) > thr) out[i] = 0
  }
  return out
}

/**
 * 多空相关轧差市值.
 * Magnitude is √(MV′ R MV) on the selected products. Same-product longs and shorts
 * are already netted in MV. ρ = 1 for every pair collapses this to the direct net.
 * The sign follows the direct net, so the column still shows long versus short.
 * A zero direct net keeps a positive magnitude: the hedge is not a zero exposure.
 */
export function signedCorrelationExposure(mvs: number[], corr: number[][], indices?: number[]): number {
  const idx = indices ?? mvs.map((_, i) => i)
  let quad = 0
  let net = 0
  for (const i of idx) {
    net += mvs[i] ?? 0
    const row = corr[i]
    for (const j of idx) quad += (mvs[i] ?? 0) * (mvs[j] ?? 0) * (row?.[j] ?? 0)
  }
  const mag = Math.sqrt(Math.max(0, quad))
  if (!Number.isFinite(mag)) return 0
  return Math.round(net < 0 ? -mag : mag)
}

/**
 * Average pairwise correlation inside one group.
 * Each pair is weighted by the product of the two absolute market values, so a
 * large holding counts more than a small one. The diagonal is left out.
 * One product has no pair, so the result is null.
 */
export function averagePairCorrelation(mvs: number[], corr: number[][], indices?: number[]): number | null {
  const idx = (indices ?? mvs.map((_, i) => i)).filter((i) => Math.abs(mvs[i] ?? 0) > 0)
  if (idx.length < 2) return null
  let weighted = 0
  let weight = 0
  for (let a = 0; a < idx.length; a++) {
    const i = idx[a]
    const wi = Math.abs(mvs[i] ?? 0)
    const row = corr[i]
    for (let b = a + 1; b < idx.length; b++) {
      const j = idx[b]
      const pair = wi * Math.abs(mvs[j] ?? 0)
      weighted += pair * (row?.[j] ?? 0)
      weight += pair
    }
  }
  if (!(weight > 0)) return null
  const value = weighted / weight
  return Number.isFinite(value) ? value : null
}

export function averagePairCorrelationByGroup(
  products: { prod: string; mv: number }[],
  corr: number[][],
): { category: Record<string, number>; sector: Record<string, number>; sub: Record<string, number> } {
  const category = new Map<string, number[]>()
  const sector = new Map<string, number[]>()
  const sub = new Map<string, number[]>()
  products.forEach((product, index) => {
    const labels = classify(product.prod)
    const push = (map: Map<string, number[]>, key: string) => {
      const list = map.get(key)
      if (list) list.push(index)
      else map.set(key, [index])
    }
    push(category, labels.category)
    push(sector, labels.sector)
    push(sub, labels.subSector)
  })
  const mvs = products.map((product) => product.mv)
  const pack = (map: Map<string, number[]>) => {
    const out: Record<string, number> = {}
    for (const [name, indices] of map) {
      const value = averagePairCorrelation(mvs, corr, indices)
      if (value != null) out[name] = value
    }
    return out
  }
  return { category: pack(category), sector: pack(sector), sub: pack(sub) }
}

export function correlationExposureByGroup(
  products: { prod: string; mv: number }[],
  corr: number[][],
): { category: Record<string, number>; sector: Record<string, number>; sub: Record<string, number> } {
  const category = new Map<string, number[]>()
  const sector = new Map<string, number[]>()
  const sub = new Map<string, number[]>()
  products.forEach((product, index) => {
    const labels = classify(product.prod)
    const push = (map: Map<string, number[]>, key: string) => {
      const list = map.get(key)
      if (list) list.push(index)
      else map.set(key, [index])
    }
    push(category, labels.category)
    push(sector, labels.sector)
    push(sub, labels.subSector)
  })
  const mvs = products.map((product) => product.mv)
  const pack = (map: Map<string, number[]>) => {
    const out: Record<string, number> = {}
    for (const [name, indices] of map) out[name] = signedCorrelationExposure(mvs, corr, indices)
    return out
  }
  return { category: pack(category), sector: pack(sector), sub: pack(sub) }
}

export function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length
  if (n < 3) return 0
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let num = 0, sx = 0, sy = 0
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my
    num += xi * yi; sx += xi * xi; sy += yi * yi
  }
  const denom = Math.sqrt(sx * sy)
  return denom < 1e-10 ? 0 : num / denom
}

/** Binary search: last index i such that arr[i] <= target, or -1 if none */
export function floorIndex(arr: string[], target: string): number {
  let lo = 0, hi = arr.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= target) { idx = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return idx
}

function pctMap(weights: Record<string, number>, total: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(weights)) {
    out[key] = Math.round(value / total * 10000) / 100
  }
  return out
}

function classify(prod: string): { sector: string; category: string; subSector: string } {
  return {
    sector: PROD_SECTOR[prod] ?? "其他",
    category: PROD_CAT[prod] ?? "其他",
    subSector: PROD_SUB_SECTOR[prod] ?? "其他",
  }
}

/**
 * One trading day's book VaR.
 * Marginal percentages match 持仓VaR走势: |dv_i * (Corr dv)_i| over products with that value >= 1.
 * component_var is the signed yuan allocation at the canonical z-score. After rounding, the
 * remainder sits on the largest absolute component so the products sum to total_var.
 * Returns null when the day has no marginal contribution, same as the chart skipping that date.
 */
export function assemblePositionVarDay(input: {
  date: string
  products: { prod: string; mv: number; lots: number; sigma: number }[]
  corr: number[][]
  zScore?: number
}): PositionVarDay | null {
  const z = input.zScore ?? MOM_POSITION_VAR_SPEC.zScore
  const products = input.products
  const n = products.length
  const dv = products.map((product) => product.sigma * product.mv)
  const mvc = new Array<number>(n).fill(0)
  let portVar = 0
  for (let i = 0; i < n; i++) {
    if (dv[i] === 0) continue
    let covSum = 0
    for (let j = 0; j < n; j++) covSum += dv[j] * (input.corr[i]?.[j] ?? 0)
    mvc[i] = dv[i] * covSum
    portVar += mvc[i]
  }

  const catMcr: Record<string, number> = {}
  const sectorMcr: Record<string, number> = {}
  const subMcr: Record<string, number> = {}
  let totalMcr = 0
  for (let i = 0; i < n; i++) {
    if (dv[i] === 0) continue
    const mcr = Math.abs(mvc[i])
    if (mcr < 1) continue
    const labels = classify(products[i].prod)
    catMcr[labels.category] = (catMcr[labels.category] ?? 0) + mcr
    sectorMcr[labels.sector] = (sectorMcr[labels.sector] ?? 0) + mcr
    subMcr[labels.subSector] = (subMcr[labels.subSector] ?? 0) + mcr
    totalMcr += mcr
  }
  if (totalMcr === 0) return null

  const sigmaP = portVar > 0 ? Math.sqrt(portVar) : 0
  const totalVar = sigmaP > 0 ? Math.round(z * sigmaP) : 0
  const stored: PositionVarProduct[] = []
  let netMarketValue = 0
  const mvBy = {
    category: new Map<string, number>(),
    sector: new Map<string, number>(),
    sub: new Map<string, number>(),
  }
  for (let i = 0; i < n; i++) {
    const labels = classify(products[i].prod)
    netMarketValue += products[i].mv
    mvBy.category.set(labels.category, (mvBy.category.get(labels.category) ?? 0) + products[i].mv)
    mvBy.sector.set(labels.sector, (mvBy.sector.get(labels.sector) ?? 0) + products[i].mv)
    mvBy.sub.set(labels.subSector, (mvBy.sub.get(labels.subSector) ?? 0) + products[i].mv)
    if (dv[i] === 0) continue
    const mcr = Math.abs(mvc[i])
    const componentVar = sigmaP > 0 ? Math.round((z * mvc[i]) / sigmaP) : 0
    if (mcr < 1 && componentVar === 0) continue
    stored.push({
      code: products[i].prod,
      name: PROD_NAMES[products[i].prod] ?? null,
      sector: labels.sector,
      category: labels.category,
      subSector: labels.subSector,
      marketValue: Math.round(products[i].mv),
      lots: products[i].lots,
      sigma: Math.round(products[i].sigma * 1e6) / 1e6,
      componentVar,
      marginalPct: mcr < 1 ? 0 : Math.round(mcr / totalMcr * 10000) / 100,
      mcr,
    })
  }

  const componentSum = stored.reduce((sum, product) => sum + product.componentVar, 0)
  const remainder = totalVar - componentSum
  if (remainder !== 0 && stored.length > 0) {
    let index = 0
    for (let i = 1; i < stored.length; i++) {
      if (Math.abs(stored[i].componentVar) > Math.abs(stored[index].componentVar)) index = i
    }
    stored[index].componentVar += remainder
  }

  const componentBy = {
    category: new Map<string, number>(),
    sector: new Map<string, number>(),
    sub: new Map<string, number>(),
  }
  for (const product of stored) {
    componentBy.category.set(product.category, (componentBy.category.get(product.category) ?? 0) + product.componentVar)
    componentBy.sector.set(product.sector, (componentBy.sector.get(product.sector) ?? 0) + product.componentVar)
    componentBy.sub.set(product.subSector, (componentBy.sub.get(product.subSector) ?? 0) + product.componentVar)
  }

  const cat = pctMap(catMcr, totalMcr)
  const sector = pctMap(sectorMcr, totalMcr)
  const sub = pctMap(subMcr, totalMcr)

  const groupsOf = (
    pct: Record<string, number>,
    mcr: Record<string, number>,
    market: Map<string, number>,
    component: Map<string, number>,
  ): PositionVarGroup[] => {
    const names = new Set<string>([...Object.keys(pct), ...component.keys()])
    return [...names].map((name) => ({
      name,
      marketValue: Math.round(market.get(name) ?? 0),
      componentVar: component.get(name) ?? 0,
      marginalPct: pct[name] ?? 0,
      mcr: mcr[name] ?? 0,
    }))
  }

  return {
    date: input.date,
    totalVar,
    netMarketValue: Math.round(netMarketValue),
    totalMcr,
    cat,
    sector,
    sub,
    products: stored,
    groups: {
      category: groupsOf(cat, catMcr, mvBy.category, componentBy.category),
      sector: groupsOf(sector, sectorMcr, mvBy.sector, componentBy.sector),
      sub: groupsOf(sub, subMcr, mvBy.sub, componentBy.sub),
    },
  }
}
