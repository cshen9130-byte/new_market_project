/** Professional market-condition factors for 量化策略「哪种市场赚得多」。 */

export type FactorBucket = {
  key: string
  label: string
  pnl: number
  avgPnl: number
  days: number
  winRate: number
  tStat: number | null
}

export type FactorFamily = {
  key: string
  title: string
  caption: string
  buckets: FactorBucket[]
}

export type HeatCell = {
  carryKey: string
  carryLabel: string
  trendKey: string
  trendLabel: string
  pnl: number
  avgPnl: number
  days: number
  winRate: number
  tStat: number | null
}

export type RegimeFactors = {
  families: FactorFamily[]
  heatmap: HeatCell[]
  capture: { up: number | null; down: number | null }
}

export type EquityDay = { date: string; pnl: number; equity: number }

export type NhPoint = { date: string; close: number }

export type ContractLeg = {
  date: string
  product: string
  rk: number
  px: number
  oi: number
  doi: number
  pct: number
  volume: number
  contract: string
}

export type ClusterDay = { date: string; cluster: number }

const NON_COMMODITY = new Set(["IH", "IF", "IC", "IM", "MO", "T", "TF", "TS", "TL"])

const CLUSTER_META: Record<number, { key: string; label: string }> = {
  0: { key: "stagflation", label: "滞涨 / 中性" },
  1: { key: "recession", label: "衰退" },
  2: { key: "overheat", label: "过热" },
  3: { key: "recovery", label: "复苏" },
}

const CARRY_META = {
  deepBack: { key: "deepBack", label: "更贴水" },
  mildBack: { key: "mildBack", label: "偏贴水" },
  mildCont: { key: "mildCont", label: "偏升水" },
  deepCont: { key: "deepCont", label: "更升水" },
} as const

const TREND_META = {
  alignedUp: { key: "alignedUp", label: "三周期同向多" },
  alignedDown: { key: "alignedDown", label: "三周期同向空" },
  pullback: { key: "pullback", label: "短多长空" },
  bounce: { key: "bounce", label: "短空长多" },
} as const

type BucketAcc = { pnl: number[]; wins: number }

function mean(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

function r0(n: number): number { return Math.round(n) }
function r2(n: number): number { return Math.round(n * 100) / 100 }

function tStat(xs: number[]): number | null {
  if (xs.length < 5) return null
  const s = stdev(xs)
  if (s < 1e-9) return null
  return r2(mean(xs) / (s / Math.sqrt(xs.length)))
}

function emptyAcc(): BucketAcc {
  return { pnl: [], wins: 0 }
}

function toBucket(key: string, label: string, acc: BucketAcc): FactorBucket {
  const days = acc.pnl.length
  const total = acc.pnl.reduce((a, b) => a + b, 0)
  return {
    key,
    label,
    pnl: r0(total),
    avgPnl: days ? r0(total / days) : 0,
    days,
    winRate: days ? r2((acc.wins / days) * 100) : 0,
    tStat: tStat(acc.pnl),
  }
}

function push(acc: Record<string, BucketAcc>, key: string, pnl: number) {
  if (!acc[key]) acc[key] = emptyAcc()
  acc[key].pnl.push(pnl)
  if (pnl > 0) acc[key].wins += 1
}

function family(
  key: string,
  title: string,
  caption: string,
  order: Array<{ key: string; label: string }>,
  acc: Record<string, BucketAcc>,
): FactorFamily {
  return {
    key,
    title,
    caption,
    buckets: order.map((o) => toBucket(o.key, o.label, acc[o.key] ?? emptyAcc())),
  }
}

function dateMinus(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

export function lookbackFrom(from: string, calendarDays = 400): string {
  return dateMinus(from, calendarDays)
}

function seriesMap(points: NhPoint[]): { dates: string[]; close: Map<string, number>; ret: Map<string, number> } {
  const sorted = [...points].filter((p) => p.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  const dates = sorted.map((p) => p.date)
  const close = new Map(sorted.map((p) => [p.date, p.close]))
  const ret = new Map<string, number>()
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].close
    if (prev > 0) ret.set(sorted[i].date, sorted[i].close / prev - 1)
  }
  return { dates, close, ret }
}

function horizonRet(close: Map<string, number>, dates: string[], i: number, n: number): number | null {
  if (i < n) return null
  const prev = close.get(dates[i - n])
  const cur = close.get(dates[i])
  if (prev == null || cur == null || prev <= 0) return null
  return cur / prev - 1
}

function windowRets(ret: Map<string, number>, dates: string[], i: number, n: number): number[] {
  const out: number[] = []
  for (let j = i - n + 1; j <= i; j++) {
    if (j < 1) continue
    const r = ret.get(dates[j])
    if (r != null) out.push(r)
  }
  return out
}

function efficiencyRatio(close: Map<string, number>, dates: string[], i: number, n: number): number | null {
  if (i < n) return null
  const start = close.get(dates[i - n])
  const end = close.get(dates[i])
  if (start == null || end == null || start <= 0) return null
  let path = 0
  for (let j = i - n + 1; j <= i; j++) {
    const a = close.get(dates[j - 1])
    const b = close.get(dates[j])
    if (a != null && b != null) path += Math.abs(b - a)
  }
  if (path < 1e-9) return 0
  return Math.abs(end - start) / path
}

function percentileRank(sorted: number[], v: number): number {
  if (!sorted.length) return 50
  let lo = 0
  for (const x of sorted) if (x <= v) lo += 1
  return (lo / sorted.length) * 100
}

function firstEigenShare(cols: number[][]): number | null {
  const k = cols.length
  const n = cols[0]?.length ?? 0
  if (k < 3 || n < 15) return null
  const means = cols.map((c) => mean(c))
  const X = cols.map((c, j) => c.map((v) => v - means[j]))
  const cov: number[][] = Array.from({ length: k }, () => Array(k).fill(0))
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let s = 0
      for (let t = 0; t < n; t++) s += X[i][t] * X[j][t]
      cov[i][j] = cov[j][i] = s / (n - 1)
    }
  }
  let v = Array(k).fill(1 / Math.sqrt(k))
  for (let iter = 0; iter < 20; iter++) {
    const w = cov.map((row) => row.reduce((s, a, j) => s + a * v[j], 0))
    const nrm = Math.sqrt(w.reduce((s, a) => s + a * a, 0))
    if (nrm < 1e-15) return null
    v = w.map((a) => a / nrm)
  }
  const Av = cov.map((row) => row.reduce((s, a, j) => s + a * v[j], 0))
  const lambda = v.reduce((s, a, i) => s + a * Av[i], 0)
  const trace = cov.reduce((s, row, i) => s + row[i], 0)
  if (trace <= 0) return null
  return lambda / trace
}

function pairwiseCorr(cols: number[][]): number | null {
  const k = cols.length
  if (k < 2) return null
  const n = cols[0]?.length ?? 0
  if (n < 10) return null
  const rhos: number[] = []
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const a = cols[i]
      const b = cols[j]
      const ma = mean(a)
      const mb = mean(b)
      let num = 0
      let da = 0
      let db = 0
      for (let t = 0; t < n; t++) {
        const x = a[t] - ma
        const y = b[t] - mb
        num += x * y
        da += x * x
        db += y * y
      }
      const den = Math.sqrt(da * db)
      if (den > 1e-12) rhos.push(num / den)
    }
  }
  return rhos.length ? mean(rhos) : null
}

export function parseFuturesRoot(raw: string): { product: string; y: number; m: number } | null {
  const code = raw.split(".")[0].toUpperCase().replace(/\s/g, "")
  const m = /^([A-Z]{1,2})(\d{3,4})$/.exec(code)
  if (!m) return null
  const product = m[1]
  const ym = m[2]
  if (ym.length === 4) {
    const y = 2000 + parseInt(ym.slice(0, 2), 10)
    const month = parseInt(ym.slice(2), 10)
    if (month < 1 || month > 12) return null
    return { product, y, m: month }
  }
  const month = parseInt(ym.slice(1), 10)
  if (month < 1 || month > 12) return null
  return { product, y: parseInt(ym[0], 10), m: month }
}

function monthDiff(a: { y: number; m: number }, b: { y: number; m: number }): number | null {
  if (a.y < 100 || b.y < 100) return null
  return b.y * 12 + b.m - (a.y * 12 + a.m)
}

export function dailyCarryByDate(legs: ContractLeg[]): Map<string, number> {
  const byDate = new Map<string, ContractLeg[]>()
  for (const row of legs) {
    if (row.rk > 2 || row.px <= 0) continue
    if (NON_COMMODITY.has(row.product)) continue
    const list = byDate.get(row.date) ?? []
    list.push(row)
    byDate.set(row.date, list)
  }
  const out = new Map<string, number>()
  for (const [date, rows] of byDate) {
    const byProd = new Map<string, { near?: ContractLeg; far?: ContractLeg }>()
    for (const r of rows) {
      const slot = byProd.get(r.product) ?? {}
      if (r.rk === 1) slot.near = r
      if (r.rk === 2) slot.far = r
      byProd.set(r.product, slot)
    }
    const carries: number[] = []
    for (const pair of byProd.values()) {
      if (!pair.near || !pair.far || pair.near.px <= 0) continue
      const nearRoot = parseFuturesRoot(pair.near.contract)
      const farRoot = parseFuturesRoot(pair.far.contract)
      const months = nearRoot && farRoot ? monthDiff(nearRoot, farRoot) : null
      const raw = pair.far.px / pair.near.px - 1
      if (months != null && months > 0) carries.push(raw * (12 / months) * 100)
      else carries.push(raw * 6 * 100)
    }
    if (carries.length >= 3) {
      const sorted = [...carries].sort((a, b) => a - b)
      out.set(date, sorted[Math.floor(sorted.length / 2)])
    }
  }
  return out
}

export function dailyOiQuadrant(legs: ContractLeg[]): Map<string, string> {
  const mains = legs.filter((r) => r.rk === 1 && !NON_COMMODITY.has(r.product))
  const byDate = new Map<string, ContractLeg[]>()
  for (const r of mains) {
    const list = byDate.get(r.date) ?? []
    list.push(r)
    byDate.set(r.date, list)
  }
  const out = new Map<string, string>()
  for (const [date, rows] of byDate) {
    const w: Record<string, number> = { upAdd: 0, upCover: 0, dnAdd: 0, dnCover: 0 }
    for (const r of rows) {
      if (!Number.isFinite(r.pct) || !Number.isFinite(r.doi)) continue
      if (r.pct === 0 || r.doi === 0) continue
      const key = r.pct > 0
        ? (r.doi > 0 ? "upAdd" : "upCover")
        : (r.doi > 0 ? "dnAdd" : "dnCover")
      w[key] += Math.max(r.volume, r.oi, 1)
    }
    const best = Object.entries(w).sort((a, b) => b[1] - a[1])[0]
    if (best && best[1] > 0) out.set(date, best[0])
  }
  return out
}

function carryBucketByRank(carryMap: Map<string, number>): Map<string, keyof typeof CARRY_META> {
  const sorted = [...carryMap.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
  const n = sorted.length
  const out = new Map<string, keyof typeof CARRY_META>()
  sorted.forEach(([date], i) => {
    const q = n <= 1 ? 0 : i / (n - 1)
    const key: keyof typeof CARRY_META = q <= 0.25 ? "deepBack" : q <= 0.5 ? "mildBack" : q <= 0.75 ? "mildCont" : "deepCont"
    out.set(date, key)
  })
  return out
}

function trendBucket(r5: number, r20: number, r60: number): keyof typeof TREND_META {
  const s5 = r5 >= 0
  const s20 = r20 >= 0
  const s60 = r60 >= 0
  if (s5 && s20 && s60) return "alignedUp"
  if (!s5 && !s20 && !s60) return "alignedDown"
  if (s5 && !s60) return "pullback"
  return "bounce"
}

function captureRatio(pnls: number[], bench: number[]): number | null {
  if (pnls.length < 8) return null
  const b = bench.reduce((a, x) => a + x, 0)
  if (Math.abs(b) < 1e-9) return null
  return r2(pnls.reduce((a, x) => a + x, 0) / b)
}

export function computeRegimeFactors(input: {
  equity: EquityDay[]
  nhByCode: Record<string, NhPoint[]>
  contracts: ContractLeg[]
  clusters: ClusterDay[]
}): RegimeFactors {
  const nhci = seriesMap(input.nhByCode["NHCI.NH"] ?? [])
  const subCodes = ["NHFI.NH", "NHECI.NH", "NHNFI.NH", "NHAI.NH", "NHPMI.NH", "NHNEI.NH"]
  const subs = subCodes
    .map((code) => ({ code, s: seriesMap(input.nhByCode[code] ?? []) }))
    .filter((x) => x.s.dates.length >= 30)

  const carryMap = dailyCarryByDate(input.contracts)
  const carryKeyByDate = carryBucketByRank(carryMap)
  const oiMap = dailyOiQuadrant(input.contracts)
  const clusterMap = new Map(input.clusters.map((c) => [c.date, c.cluster]))

  const vol20 = new Map<string, number>()
  const vol60 = new Map<string, number>()
  const er20 = new Map<string, number>()
  const r5m = new Map<string, number>()
  const r20m = new Map<string, number>()
  const r60m = new Map<string, number>()
  const downUpVol = new Map<string, number>()
  const volsForPct: number[] = []

  for (let i = 0; i < nhci.dates.length; i++) {
    const d = nhci.dates[i]
    const w20 = windowRets(nhci.ret, nhci.dates, i, 20)
    const w60 = windowRets(nhci.ret, nhci.dates, i, 60)
    if (w20.length >= 15) {
      const v = stdev(w20)
      vol20.set(d, v)
      volsForPct.push(v)
      const up = w20.filter((x) => x > 0)
      const dn = w20.filter((x) => x < 0)
      const su = stdev(up)
      const sd = stdev(dn)
      if (su > 1e-9) downUpVol.set(d, sd / su)
    }
    if (w60.length >= 40) vol60.set(d, stdev(w60))
    const e = efficiencyRatio(nhci.close, nhci.dates, i, 20)
    if (e != null) er20.set(d, e)
    const h5 = horizonRet(nhci.close, nhci.dates, i, 5)
    const h20 = horizonRet(nhci.close, nhci.dates, i, 20)
    const h60 = horizonRet(nhci.close, nhci.dates, i, 60)
    if (h5 != null) r5m.set(d, h5)
    if (h20 != null) r20m.set(d, h20)
    if (h60 != null) r60m.set(d, h60)
  }
  const volSorted = [...volsForPct].sort((a, b) => a - b)

  const corr20 = new Map<string, number>()
  const pc1 = new Map<string, number>()
  const disp = new Map<string, number>()
  const breadth = new Map<string, number>()
  const sleeve = new Map<string, string>()

  const dateSet = new Set(nhci.dates)
  for (const sub of subs) for (const d of sub.s.dates) dateSet.add(d)
  const allDates = [...dateSet].sort()

  for (let i = 0; i < allDates.length; i++) {
    const d = allDates[i]
    const dayRets: number[] = []
    const cols: number[][] = []
    let ok = true
    for (const sub of subs) {
      const r = sub.s.ret.get(d)
      if (r != null) dayRets.push(r)
      const col: number[] = []
      for (let j = i - 19; j <= i; j++) {
        if (j < 1) {
          ok = false
          break
        }
        const rr = sub.s.ret.get(allDates[j])
        if (rr == null) {
          ok = false
          break
        }
        col.push(rr)
      }
      if (!ok) break
      cols.push(col)
    }
    if (dayRets.length >= 4) disp.set(d, stdev(dayRets))
    if (ok && cols.length >= 4) {
      const rho = pairwiseCorr(cols)
      if (rho != null) corr20.set(d, rho)
      const share = firstEigenShare(cols)
      if (share != null) pc1.set(d, share)
    }
    const up20: number[] = []
    const ind: number[] = []
    let ag: number | null = null
    let pm: number | null = null
    for (const sub of subs) {
      const dates = sub.s.dates
      const ii = dates.indexOf(d)
      if (ii < 0) continue
      const h = horizonRet(sub.s.close, dates, ii, 20)
      if (h == null) continue
      up20.push(h)
      if (sub.code === "NHFI.NH" || sub.code === "NHECI.NH" || sub.code === "NHNFI.NH") ind.push(h)
      if (sub.code === "NHAI.NH") ag = h
      if (sub.code === "NHPMI.NH") pm = h
    }
    if (up20.length >= 4) breadth.set(d, up20.filter((x) => x > 0).length / up20.length)
    if (ind.length >= 2 && ag != null && pm != null) {
      const industrial = mean(ind)
      const ranked = [
        { key: "industrial", v: industrial },
        { key: "ag", v: ag },
        { key: "precious", v: pm },
      ].sort((a, b) => b.v - a.v)
      const gap = ranked[0].v - ranked[1].v
      sleeve.set(d, gap >= 0.005 ? ranked[0].key : "balanced")
    }
  }

  const acc = {
    nhSide: {} as Record<string, BucketAcc>,
    carry: {} as Record<string, BucketAcc>,
    trend: {} as Record<string, BucketAcc>,
    path: {} as Record<string, BucketAcc>,
    common: {} as Record<string, BucketAcc>,
    oi: {} as Record<string, BucketAcc>,
    volLvl: {} as Record<string, BucketAcc>,
    volExp: {} as Record<string, BucketAcc>,
    volSkew: {} as Record<string, BucketAcc>,
    cluster: {} as Record<string, BucketAcc>,
    sleeve: {} as Record<string, BucketAcc>,
  }
  const heat = new Map<string, BucketAcc>()

  const upPnl: number[] = []
  const upRet: number[] = []
  const dnPnl: number[] = []
  const dnRet: number[] = []

  for (let i = 0; i < input.equity.length; i++) {
    const day = input.equity[i]
    const d = day.date
    const pnl = day.pnl
    const prevEq = i > 0 ? input.equity[i - 1].equity : day.equity
    const accRet = prevEq > 0 ? pnl / prevEq : null
    const nhRet = nhci.ret.get(d)

    if (nhRet != null) {
      push(acc.nhSide, nhRet >= 0 ? "up" : "down", pnl)
      if (accRet != null) {
        if (nhRet > 0) {
          upPnl.push(accRet)
          upRet.push(nhRet)
        } else if (nhRet < 0) {
          dnPnl.push(accRet)
          dnRet.push(nhRet)
        }
      }
    }

    const r5 = r5m.get(d)
    const r20 = r20m.get(d)
    const r60 = r60m.get(d)
    let carryKey: keyof typeof CARRY_META | null = carryKeyByDate.get(d) ?? null
    let trendKey: keyof typeof TREND_META | null = null
    if (carryKey) push(acc.carry, carryKey, pnl)
    if (r5 != null && r20 != null && r60 != null) {
      trendKey = trendBucket(r5, r20, r60)
      push(acc.trend, trendKey, pnl)
    }
    if (carryKey && trendKey) {
      const hk = `${carryKey}|${trendKey}`
      if (!heat.has(hk)) heat.set(hk, emptyAcc())
      heat.get(hk)!.pnl.push(pnl)
      if (pnl > 0) heat.get(hk)!.wins += 1
    }

    const er = er20.get(d)
    if (er != null) push(acc.path, er >= 0.35 ? "clean" : "choppy", pnl)

    const rho = corr20.get(d)
    const share = pc1.get(d)
    const common = share != null ? share >= 0.55 : rho != null && rho >= 0.45
    const rare = share != null ? share < 0.4 : rho != null && rho < 0.3
    if (common) push(acc.common, "common", pnl)
    else if (rare) push(acc.common, "idiosyncratic", pnl)
    const br = breadth.get(d)
    if (br != null) {
      if (br >= 0.6) push(acc.common, "broadUp", pnl)
      else if (br <= 0.4) push(acc.common, "broadDown", pnl)
    }
    const dv = disp.get(d)
    if (dv != null) {
      // filled after loop? need median — accumulate first then skip; use corr as primary
    }

    const oi = oiMap.get(d)
    if (oi) push(acc.oi, oi, pnl)

    const v20 = vol20.get(d)
    if (v20 != null && volSorted.length >= 40) {
      const p = percentileRank(volSorted, v20)
      push(acc.volLvl, p < 33 ? "volLow" : p < 67 ? "volMid" : "volHigh", pnl)
    }
    const v60 = vol60.get(d)
    if (v20 != null && v60 != null && v60 > 1e-9) {
      const ratio = v20 / v60
      if (ratio > 1.1) push(acc.volExp, "expand", pnl)
      else if (ratio < 0.9) push(acc.volExp, "compress", pnl)
    }
    const du = downUpVol.get(d)
    if (du != null) {
      if (du > 1.2) push(acc.volSkew, "downVol", pnl)
      else if (du < 0.8) push(acc.volSkew, "upVol", pnl)
    }

    const cl = clusterMap.get(d)
    if (cl != null && CLUSTER_META[cl]) push(acc.cluster, CLUSTER_META[cl].key, pnl)

    const sl = sleeve.get(d)
    if (sl) push(acc.sleeve, sl, pnl)
  }

  const dispVals = [...disp.values()].sort((a, b) => a - b)
  const dispMed = dispVals[Math.floor(dispVals.length / 2)] ?? 0
  if (dispMed > 0) {
    for (const day of input.equity) {
      const dv = disp.get(day.date)
      if (dv == null) continue
      push(acc.common, dv >= dispMed ? "hiDisp" : "loDisp", day.pnl)
    }
  }

  const families: FactorFamily[] = [
    family("nhSide", "商品涨跌", "南华商品指数当日涨跌。柱高是日均盈亏；上涨捕获 / 下跌捕获见提示。", [
      { key: "up", label: "商品上涨日" },
      { key: "down", label: "商品下跌日" },
    ], acc.nhSide),
    family("carry", "期限结构 / Carry", "商品主力与次主力的年化近远月价差中位数，按区间四分位切。更贴水=曲线更向下（多头展期更好）；更升水相反。", [
      CARRY_META.deepBack,
      CARRY_META.mildBack,
      CARRY_META.mildCont,
      CARRY_META.deepCont,
    ], acc.carry),
    family("trend", "多周期趋势", "南华 5 / 20 / 60 日收益符号。同向=真趋势；短多长空=大趋势里的反弹。", [
      TREND_META.alignedUp,
      TREND_META.alignedDown,
      TREND_META.pullback,
      TREND_META.bounce,
    ], acc.trend),
    family("path", "路径质量", "Kaufman 效率比 ER = |20 日净位移| / 路径长度。高=干净单边，低=来回磨。", [
      { key: "clean", label: "干净单边" },
      { key: "choppy", label: "来回摩擦" },
    ], acc.path),
    family("common", "共同因子 vs 分化", "分项指数 20 日平均相关 / PC1 解释度、截面离散、20 日上涨广度。", [
      { key: "common", label: "齐涨齐跌" },
      { key: "idiosyncratic", label: "板块分化" },
      { key: "hiDisp", label: "高离散" },
      { key: "loDisp", label: "低离散" },
      { key: "broadUp", label: "广度多头" },
      { key: "broadDown", label: "广度空头" },
    ], acc.common),
    family("oi", "价仓四象限", "各品种主力合约价与持仓量：成交量加权后取当日主导象限。", [
      { key: "upAdd", label: "价涨仓增" },
      { key: "upCover", label: "价涨仓减" },
      { key: "dnAdd", label: "价跌仓增" },
      { key: "dnCover", label: "价跌仓减" },
    ], acc.oi),
    family("volLvl", "波动分位", "南华 20 日实现波动在样本内的百分位，不是简单中位数对切。", [
      { key: "volLow", label: "波动低位" },
      { key: "volMid", label: "波动中位" },
      { key: "volHigh", label: "波动高位" },
    ], acc.volLvl),
    family("volExp", "波动扩张", "σ20 / σ60：冲击刚来还是已经收敛。", [
      { key: "expand", label: "波动扩张" },
      { key: "compress", label: "波动收敛" },
    ], acc.volExp),
    family("volSkew", "上下行波动", "20 日下行半波动 / 上行半波动。", [
      { key: "downVol", label: "下行波动主导" },
      { key: "upVol", label: "上行波动主导" },
    ], acc.volSkew),
    family("cluster", "宏观状态", "股债金商 PCA+GMM 四簇（与宏观页同一套）。", [
      CLUSTER_META[0],
      CLUSTER_META[1],
      CLUSTER_META[2],
      CLUSTER_META[3],
    ], acc.cluster),
    family("sleeve", "板块相对强弱", "工业品（黑色+能化+有色）/ 农产品 / 贵金属 的 20 日收益谁领先。", [
      { key: "industrial", label: "工业品强" },
      { key: "ag", label: "农产品强" },
      { key: "precious", label: "贵金属强" },
      { key: "balanced", label: "相对均衡" },
    ], acc.sleeve),
  ].filter((f) => f.buckets.some((b) => b.days > 0))

  const heatmap: HeatCell[] = []
  for (const [ck, cmeta] of Object.entries(CARRY_META)) {
    for (const [tk, tmeta] of Object.entries(TREND_META)) {
      const accH = heat.get(`${ck}|${tk}`) ?? emptyAcc()
      const b = toBucket(`${ck}_${tk}`, `${cmeta.label} × ${tmeta.label}`, accH)
      heatmap.push({
        carryKey: ck,
        carryLabel: cmeta.label,
        trendKey: tk,
        trendLabel: tmeta.label,
        pnl: b.pnl,
        avgPnl: b.avgPnl,
        days: b.days,
        winRate: b.winRate,
        tStat: b.tStat,
      })
    }
  }

  return {
    families,
    heatmap,
    capture: {
      up: captureRatio(upPnl, upRet),
      down: captureRatio(dnPnl, dnRet),
    },
  }
}

export function fitUnfitFromFactors(families: FactorFamily[], minDays = 8): { fit: string[]; unfit: string[] } {
  const scored: { label: string; avg: number; days: number }[] = []
  for (const f of families) {
    if (f.key === "nhSide") continue
    for (const b of f.buckets) {
      if (b.days >= minDays) scored.push({ label: `${f.title} · ${b.label}`, avg: b.avgPnl, days: b.days })
    }
  }
  if (!scored.length) return { fit: [], unfit: [] }
  const best = [...scored].sort((a, b) => b.avg - a.avg).slice(0, 3)
  const worst = [...scored].sort((a, b) => a.avg - b.avg).slice(0, 3)
  return {
    fit: (best.some((x) => x.avg > 0) ? best.filter((x) => x.avg > 0) : best.slice(0, 2)).map((x) => x.label),
    unfit: (worst.some((x) => x.avg < 0) ? worst.filter((x) => x.avg < 0) : worst.slice(0, 2)).map((x) => x.label),
  }
}

export function legacyRegimeFromFactors(factors: RegimeFactors): Array<{
  key: string
  label: string
  pnl: number
  days: number
  winRate: number
}> {
  const find = (family: string, key: string) =>
    factors.families.find((f) => f.key === family)?.buckets.find((b) => b.key === key)
  const up = find("nhSide", "up")
  const down = find("nhSide", "down")
  const aligned = ["alignedUp", "alignedDown"].map((k) => find("trend", k))
  const mixed = ["pullback", "bounce"].map((k) => find("trend", k))
  const hi = find("volLvl", "volHigh")
  const lo = find("volLvl", "volLow")
  const sum = (xs: Array<FactorBucket | undefined>) => {
    const hit = xs.filter((x): x is FactorBucket => x != null)
    const days = hit.reduce((s, x) => s + x.days, 0)
    const pnl = hit.reduce((s, x) => s + x.pnl, 0)
    const wins = hit.reduce((s, x) => s + (x.winRate / 100) * x.days, 0)
    return { pnl, days, winRate: days ? r2((wins / days) * 100) : 0 }
  }
  const t = sum(aligned)
  const r = sum(mixed)
  return [
    { key: "up", label: "商品上涨日", pnl: up?.pnl ?? 0, days: up?.days ?? 0, winRate: up?.winRate ?? 0 },
    { key: "down", label: "商品下跌日", pnl: down?.pnl ?? 0, days: down?.days ?? 0, winRate: down?.winRate ?? 0 },
    { key: "trend", label: "趋势市", pnl: t.pnl, days: t.days, winRate: t.winRate },
    { key: "range", label: "震荡市", pnl: r.pnl, days: r.days, winRate: r.winRate },
    { key: "highVol", label: "高波动", pnl: hi?.pnl ?? 0, days: hi?.days ?? 0, winRate: hi?.winRate ?? 0 },
    { key: "lowVol", label: "低波动", pnl: lo?.pnl ?? 0, days: lo?.days ?? 0, winRate: lo?.winRate ?? 0 },
  ]
}
