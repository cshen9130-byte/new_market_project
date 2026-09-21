/** Order-level microstructure from 期货成交明细 + 平仓明细. */

export type FillRow = {
  date: string
  time: string
  product: string
  bs: string
  oc: string
  lots: number
  px: number
  fee: number
  closePnl: number
}

export type CloseRow = {
  date: string
  product: string
  bs: string
  closePx: number
  openPx: number
  lots: number
  pnl: number
  holdDays: number
}

export type MicroBucket = {
  key: string
  label: string
  n: number
  lots: number
  pnl: number
  avgPnl: number
  winRate: number
}

export type ClockHour = {
  hour: number
  label: string
  openLots: number
  closeLots: number
  closePnl: number
  fills: number
}

export type OrderMicro = {
  kpis: {
    nFills: number
    fillsPerDay: number | null
    medianGapSec: number | null
    pyramidDayShare: number | null
    sameDayCloseShare: number | null
    fee: number
    feeToAbsClose: number | null
    medianFillLots: number | null
  }
  clock: ClockHour[]
  size: MicroBucket[]
  entry: MicroBucket[]
  gaps: MicroBucket[]
  trip: MicroBucket[]
}

function r0(n: number): number { return Math.round(n) }
function r1(n: number): number { return Math.round(n * 10) / 10 }
function r2(n: number): number { return Math.round(n * 100) / 100 }

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function isBuy(bs: string): boolean {
  return bs.includes("买")
}

function isOpen(oc: string): boolean {
  return oc.includes("开")
}

function isClose(oc: string): boolean {
  return oc.includes("平")
}

function parseHms(raw: string): { h: number; m: number; s: number; sec: number } | null {
  const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const s = Number(m[3] ?? 0)
  if (!Number.isFinite(h) || h > 23) return null
  return { h, m: min, s, sec: h * 3600 + min * 60 + s }
}

function bucketFromPnl(key: string, label: string, pnls: number[], lots = 0): MicroBucket {
  const n = pnls.length
  const total = pnls.reduce((a, b) => a + b, 0)
  const wins = pnls.filter((x) => x > 0).length
  return {
    key,
    label,
    n,
    lots: r1(lots),
    pnl: r0(total),
    avgPnl: n ? r0(total / n) : 0,
    winRate: n ? r2((wins / n) * 100) : 0,
  }
}

const CLOCK_HOURS = [21, 22, 23, 0, 1, 2, 3, 8, 9, 10, 11, 13, 14, 15]
function clockLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`
}

function sizeKey(lots: number): { key: string; label: string } {
  if (lots <= 1) return { key: "1", label: "1 手" }
  if (lots <= 5) return { key: "2-5", label: "2–5 手" }
  if (lots <= 20) return { key: "6-20", label: "6–20 手" }
  if (lots <= 50) return { key: "21-50", label: "21–50 手" }
  return { key: "51+", label: "51 手以上" }
}

function gapKey(sec: number): { key: string; label: string } {
  if (sec < 10) return { key: "burst", label: "10 秒内连打" }
  if (sec < 60) return { key: "1m", label: "10 秒–1 分钟" }
  if (sec < 600) return { key: "10m", label: "1–10 分钟" }
  return { key: "slow", label: "10 分钟以上" }
}

function tripKey(days: number): { key: string; label: string } {
  if (days <= 0) return { key: "intraday", label: "当日往返" }
  if (days === 1) return { key: "1d", label: "隔夜 1 日" }
  if (days <= 5) return { key: "2-5d", label: "2–5 日" }
  if (days <= 20) return { key: "6-20d", label: "6–20 日" }
  return { key: "21d+", label: "21 日以上" }
}

export function computeOrderMicro(fills: FillRow[], closes: CloseRow[]): OrderMicro {
  const clockMap = new Map<number, ClockHour>()
  for (const h of CLOCK_HOURS) {
    clockMap.set(h, { hour: h, label: clockLabel(h), openLots: 0, closeLots: 0, closePnl: 0, fills: 0 })
  }

  const sizeAcc: Record<string, { label: string; pnls: number[]; lots: number }> = {}
  const dates = new Set<string>()
  const fillLots: number[] = []
  let fee = 0
  let absClose = 0

  const byDateProd = new Map<string, { opens: string[]; closePnl: number }>()
  const byDate = new Map<string, FillRow[]>()

  for (const f of fills) {
    const date = f.date.slice(0, 10)
    dates.add(date)
    fee += f.fee
    absClose += Math.abs(f.closePnl)
    if (f.lots > 0) fillLots.push(f.lots)
    const t = parseHms(f.time)
    if (t) {
      const slot = clockMap.get(t.h) ?? {
        hour: t.h, label: clockLabel(t.h), openLots: 0, closeLots: 0, closePnl: 0, fills: 0,
      }
      slot.fills += 1
      if (isOpen(f.oc)) slot.openLots += f.lots
      if (isClose(f.oc)) {
        slot.closeLots += f.lots
        slot.closePnl += f.closePnl
      }
      clockMap.set(t.h, slot)
    }
    if (isClose(f.oc) && f.lots > 0) {
      const sk = sizeKey(f.lots)
      if (!sizeAcc[sk.key]) sizeAcc[sk.key] = { label: sk.label, pnls: [], lots: 0 }
      sizeAcc[sk.key].pnls.push(f.closePnl)
      sizeAcc[sk.key].lots += f.lots
    }
    const dp = `${date}|${f.product}`
    const g = byDateProd.get(dp) ?? { opens: [], closePnl: 0 }
    if (isOpen(f.oc)) g.opens.push(f.bs)
    if (isClose(f.oc)) g.closePnl += f.closePnl
    byDateProd.set(dp, g)
    const list = byDate.get(date) ?? []
    list.push(f)
    byDate.set(date, list)
  }

  const gapSec: number[] = []
  const gapAcc: Record<string, { label: string; n: number }> = {}
  for (const rows of byDate.values()) {
    const timed = rows
      .map((f) => ({ f, t: parseHms(f.time) }))
      .filter((x): x is { f: FillRow; t: NonNullable<ReturnType<typeof parseHms>> } => x.t != null)
      .sort((a, b) => a.t.sec - b.t.sec)
    for (let i = 1; i < timed.length; i++) {
      let d = timed[i].t.sec - timed[i - 1].t.sec
      if (d < 0) d += 24 * 3600
      if (d <= 0 || d > 3 * 3600) continue
      gapSec.push(d)
      const gk = gapKey(d)
      if (!gapAcc[gk.key]) gapAcc[gk.key] = { label: gk.label, n: 0 }
      gapAcc[gk.key].n += 1
    }
  }

  const entryAcc: Record<string, number[]> = { single: [], pyramid: [], twoWay: [] }
  let pyramidDays = 0
  let openDays = 0
  for (const g of byDateProd.values()) {
    if (!g.opens.length) continue
    openDays += 1
    const uniq = new Set(g.opens.map((bs) => (isBuy(bs) ? "b" : "s")))
    if (g.opens.length >= 2 && uniq.size === 1) {
      pyramidDays += 1
      entryAcc.pyramid.push(g.closePnl)
    } else if (uniq.size > 1) {
      entryAcc.twoWay.push(g.closePnl)
    } else {
      entryAcc.single.push(g.closePnl)
    }
  }

  const tripAcc: Record<string, { label: string; pnls: number[]; lots: number }> = {}
  let sameDayLots = 0
  let closeLots = 0
  for (const c of closes) {
    closeLots += c.lots
    if (c.holdDays <= 0) sameDayLots += c.lots
    const tk = tripKey(c.holdDays)
    if (!tripAcc[tk.key]) tripAcc[tk.key] = { label: tk.label, pnls: [], lots: 0 }
    tripAcc[tk.key].pnls.push(c.pnl)
    tripAcc[tk.key].lots += c.lots
  }

  const sizeOrder = ["1", "2-5", "6-20", "21-50", "51+"]
  const entryOrder: Array<{ key: string; label: string }> = [
    { key: "single", label: "一次开完" },
    { key: "pyramid", label: "同向加仓" },
    { key: "twoWay", label: "当日多空双开" },
  ]
  const gapOrder = ["burst", "1m", "10m", "slow"]
  const tripOrder = ["intraday", "1d", "2-5d", "6-20d", "21d+"]

  const clock = CLOCK_HOURS
    .map((h) => clockMap.get(h)!)
    .map((c) => ({
      ...c,
      openLots: r1(c.openLots),
      closeLots: r1(c.closeLots),
      closePnl: r0(c.closePnl),
    }))
    .filter((c) => c.fills > 0 || c.openLots > 0 || c.closeLots > 0)

  return {
    kpis: {
      nFills: fills.length,
      fillsPerDay: dates.size ? r1(fills.length / dates.size) : null,
      medianGapSec: median(gapSec) == null ? null : r1(median(gapSec)!),
      pyramidDayShare: openDays ? r2((pyramidDays / openDays) * 100) : null,
      sameDayCloseShare: closeLots > 0 ? r2((sameDayLots / closeLots) * 100) : null,
      fee: r0(fee),
      feeToAbsClose: absClose > 0 ? r2((fee / absClose) * 100) : null,
      medianFillLots: median(fillLots) == null ? null : r1(median(fillLots)!),
    },
    clock,
    size: sizeOrder
      .filter((k) => sizeAcc[k])
      .map((k) => bucketFromPnl(k, sizeAcc[k].label, sizeAcc[k].pnls, sizeAcc[k].lots)),
    entry: entryOrder.map((o) => bucketFromPnl(o.key, o.label, entryAcc[o.key] ?? [])),
    gaps: gapOrder
      .filter((k) => gapAcc[k])
      .map((k) => ({
        key: k,
        label: gapAcc[k].label,
        n: gapAcc[k].n,
        lots: 0,
        pnl: 0,
        avgPnl: 0,
        winRate: 0,
      })),
    trip: tripOrder
      .filter((k) => tripAcc[k])
      .map((k) => bucketFromPnl(k, tripAcc[k].label, tripAcc[k].pnls, tripAcc[k].lots)),
  }
}

export function orderMicroPortrait(m: OrderMicro): string {
  const k = m.kpis
  if (!k.nFills) return "没有成交明细，无法看下单习惯。"
  const bits = [`区间 ${k.nFills} 笔成交`]
  if (k.fillsPerDay != null) bits.push(`交易日均 ${k.fillsPerDay} 笔`)
  if (k.medianGapSec != null) bits.push(`相邻成交中位间隔 ${k.medianGapSec} 秒`)
  if (k.medianFillLots != null) bits.push(`单笔中位 ${k.medianFillLots} 手`)
  if (k.pyramidDayShare != null) bits.push(`同向加仓日占有开仓日的 ${k.pyramidDayShare.toFixed(0)}%`)
  if (k.sameDayCloseShare != null) bits.push(`平仓手数里当日往返 ${k.sameDayCloseShare.toFixed(0)}%`)
  if (k.feeToAbsClose != null) bits.push(`手续费占平仓盈亏绝对值 ${k.feeToAbsClose.toFixed(1)}%`)
  const py = m.entry.find((x) => x.key === "pyramid")
  const sg = m.entry.find((x) => x.key === "single")
  if (py && sg && py.n >= 8 && sg.n >= 8) {
    bits.push(py.avgPnl >= sg.avgPnl
      ? `同向加仓日均平仓 ${py.avgPnl >= 0 ? "更好" : "同样为负"}（${py.avgPnl} vs 一次开完 ${sg.avgPnl}）`
      : `一次开完的日子比加仓日子赚得多`)
  }
  return bits.join("。") + "。"
}
