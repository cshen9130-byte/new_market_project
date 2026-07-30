import { toCanonicalSymbol } from "@/lib/server/settlement-spread-charts"

type TradeLike = {
  trade_date: string
  product: string
  instrument: string
  bs: string
  oc: string
  lots: string | number
}

export type HedgeStructureDay = {
  date: string
  buyOpen: number
  sellOpen: number
  buyClose: number
  sellClose: number
  structure: "paired" | "cross-month" | "one-leg" | "close-only" | "none"
  hint: string
  legs: Array<{
    instrument: string
    buyOpen: number
    sellOpen: number
    buyClose: number
    sellClose: number
  }>
}

export type HedgeStructureChart = {
  product: string
  family: string
  instruments: string[]
  /** All dates used by cumulative series (union of trade dates sorted). */
  dates: string[]
  /** Cumulative signed net lots by instrument (买开/买平 +, 卖开/卖平 -). */
  cumulativeNet: Record<string, number[]>
  /**
   * Heatmap cells [dateIndex, instrumentIndex, signedOpenLots]
   * signed open = 买开 - 卖开 that day (close excluded).
   */
  openHeat: Array<[number, number, number]>
  /** Heatmap cells for closes: 买平 - 卖平 */
  closeHeat: Array<[number, number, number]>
  /** Compact active days for structure readout. */
  activeDays: HedgeStructureDay[]
  stats: {
    pairedOpenDays: number
    crossMonthOpenDays: number
    oneLegOpenDays: number
    closeDays: number
  }
}

function n(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const x = typeof v === "string" ? parseFloat(v) : v
  return Number.isFinite(x) ? x : 0
}

function normBs(value: string): "买" | "卖" | null {
  const s = String(value || "").trim()
  if (!s) return null
  if (s === "买" || s === "B" || s === "b" || s.includes("买")) return "买"
  if (s === "卖" || s === "S" || s === "s" || s.includes("卖")) return "卖"
  return null
}

function normOc(value: string): "开" | "平" | null {
  const s = String(value || "").trim()
  if (!s) return null
  if (s.startsWith("开") || s === "O" || s === "o") return "开"
  if (s.startsWith("平") || s === "C" || s === "c") return "平"
  return null
}

function familyOf(sym: string): string {
  return sym.replace(/[0-9]/g, "")
}

function classifyDay(legs: HedgeStructureDay["legs"]): Pick<HedgeStructureDay, "structure" | "hint"> {
  const openLegs = legs.filter((l) => l.buyOpen > 0 || l.sellOpen > 0)
  const buyOpen = openLegs.reduce((s, l) => s + l.buyOpen, 0)
  const sellOpen = openLegs.reduce((s, l) => s + l.sellOpen, 0)
  const buyClose = legs.reduce((s, l) => s + l.buyClose, 0)
  const sellClose = legs.reduce((s, l) => s + l.sellClose, 0)

  if (openLegs.length === 0) {
    if (buyClose + sellClose > 0) return { structure: "close-only", hint: "仅平仓" }
    return { structure: "none", hint: "" }
  }

  const longMonths = openLegs.filter((l) => l.buyOpen > l.sellOpen).map((l) => l.instrument)
  const shortMonths = openLegs.filter((l) => l.sellOpen > l.buyOpen).map((l) => l.instrument)
  const balanced = buyOpen > 0 && sellOpen > 0 && Math.abs(buyOpen - sellOpen) / Math.max(buyOpen, sellOpen) <= 0.05

  if (openLegs.length === 1) {
    return {
      structure: "one-leg",
      hint: `${openLegs[0].instrument} 单腿开仓（买${openLegs[0].buyOpen}/卖${openLegs[0].sellOpen}）`,
    }
  }
  if (longMonths.length >= 1 && shortMonths.length >= 1 && balanced) {
    if (longMonths.length + shortMonths.length >= 3) {
      return {
        structure: "cross-month",
        hint: `曲线/蝶式：多 ${longMonths.join("/")}，空 ${shortMonths.join("/")}`,
      }
    }
    return {
      structure: "paired",
      hint: `日历对冲：多 ${longMonths.join("/")}，空 ${shortMonths.join("/")}`,
    }
  }
  if (longMonths.length >= 1 && shortMonths.length >= 1) {
    return {
      structure: "cross-month",
      hint: `多空开仓但手数不完全匹配（买${buyOpen}/卖${sellOpen}）`,
    }
  }
  return {
    structure: "one-leg",
    hint: `同向多合约开仓（买${buyOpen}/卖${sellOpen}）`,
  }
}

/**
 * Build curve/hedge structure charts for products that trade multiple contracts.
 * Best for seeing belly/wings open-close patterns that a 2-leg spread chart hides.
 */
export function buildHedgeStructureCharts(trades: TradeLike[], limit = 2): HedgeStructureChart[] {
  if (!trades.length) return []

  // product -> instrument -> date -> buckets
  type Bucket = { buyOpen: number; sellOpen: number; buyClose: number; sellClose: number }
  const byProduct = new Map<string, Map<string, Map<string, Bucket>>>()
  const turnoverByProduct = new Map<string, number>()

  for (const row of trades) {
    const product = String(row.product || "").trim() || "其他"
    const bs = normBs(row.bs)
    const oc = normOc(row.oc)
    const lots = n(row.lots)
    const instrument = toCanonicalSymbol(row.instrument)
    if (!bs || !oc || lots <= 0 || !instrument) continue
    const date = String(row.trade_date).slice(0, 10)
    turnoverByProduct.set(product, (turnoverByProduct.get(product) ?? 0) + lots)

    if (!byProduct.has(product)) byProduct.set(product, new Map())
    const byInst = byProduct.get(product)!
    if (!byInst.has(instrument)) byInst.set(instrument, new Map())
    const byDate = byInst.get(instrument)!
    const cur = byDate.get(date) ?? { buyOpen: 0, sellOpen: 0, buyClose: 0, sellClose: 0 }
    if (oc === "开" && bs === "买") cur.buyOpen += lots
    else if (oc === "开" && bs === "卖") cur.sellOpen += lots
    else if (oc === "平" && bs === "买") cur.buyClose += lots
    else if (oc === "平" && bs === "卖") cur.sellClose += lots
    byDate.set(date, cur)
  }

  const ranked = [...byProduct.entries()]
    .map(([product, byInst]) => ({
      product,
      byInst,
      instruments: [...byInst.keys()],
      turnover: turnoverByProduct.get(product) ?? 0,
    }))
    .filter((p) => p.instruments.length >= 2)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, limit)

  const charts: HedgeStructureChart[] = []

  for (const item of ranked) {
    const instruments = [...item.instruments].sort()
    const dateSet = new Set<string>()
    for (const byDate of item.byInst.values()) {
      for (const d of byDate.keys()) dateSet.add(d)
    }
    const dates = [...dateSet].sort()
    if (dates.length === 0) continue

    const dateIndex = new Map(dates.map((d, i) => [d, i]))
    const instIndex = new Map(instruments.map((s, i) => [s, i]))
    const cumulativeNet: Record<string, number[]> = {}
    const openHeat: Array<[number, number, number]> = []
    const closeHeat: Array<[number, number, number]> = []
    const running: Record<string, number> = {}
    for (const inst of instruments) {
      running[inst] = 0
      cumulativeNet[inst] = dates.map(() => 0)
    }

    const activeDays: HedgeStructureDay[] = []
    let pairedOpenDays = 0
    let crossMonthOpenDays = 0
    let oneLegOpenDays = 0
    let closeDays = 0

    for (const date of dates) {
      const di = dateIndex.get(date)!
      const legs: HedgeStructureDay["legs"] = []
      let buyOpen = 0
      let sellOpen = 0
      let buyClose = 0
      let sellClose = 0

      for (const inst of instruments) {
        const ii = instIndex.get(inst)!
        const b = item.byInst.get(inst)?.get(date) ?? {
          buyOpen: 0,
          sellOpen: 0,
          buyClose: 0,
          sellClose: 0,
        }

        const delta = b.buyOpen - b.sellOpen + b.buyClose - b.sellClose
        running[inst] += delta
        cumulativeNet[inst][di] = running[inst]

        if (b.buyOpen + b.sellOpen + b.buyClose + b.sellClose <= 0) continue

        legs.push({ instrument: inst, ...b })
        buyOpen += b.buyOpen
        sellOpen += b.sellOpen
        buyClose += b.buyClose
        sellClose += b.sellClose

        const signedOpen = b.buyOpen - b.sellOpen
        const signedClose = b.buyClose - b.sellClose
        if (signedOpen !== 0) openHeat.push([di, ii, signedOpen])
        if (signedClose !== 0) closeHeat.push([di, ii, signedClose])
      }

      if (legs.length === 0) continue
      const { structure, hint } = classifyDay(legs)
      activeDays.push({
        date,
        buyOpen,
        sellOpen,
        buyClose,
        sellClose,
        structure,
        hint,
        legs,
      })
      if (structure === "paired") pairedOpenDays++
      else if (structure === "cross-month") crossMonthOpenDays++
      else if (structure === "one-leg") oneLegOpenDays++
      else if (structure === "close-only") closeDays++
    }

    charts.push({
      product: item.product,
      family: familyOf(instruments[0] || ""),
      instruments,
      dates,
      cumulativeNet,
      openHeat,
      closeHeat,
      activeDays,
      stats: { pairedOpenDays, crossMonthOpenDays, oneLegOpenDays, closeDays },
    })
  }

  return charts
}
