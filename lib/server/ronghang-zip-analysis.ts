/**
 * Expand a 融航结算单 ZIP (multi-day trader XLS files) and build an
 * investment performance report matching the structure of
 * “data analysis report.pdf”.
 */

import { extractRonghangArchiveEntries } from "@/lib/server/ronghang-archive"
import {
  parseRonghangWorkbook,
  productDisplayName,
  productSector,
  type RonghangDayBundle,
} from "@/lib/server/ronghang-settlement-parse"

export type RonghangEquityPoint = {
  date: string
  equity: number
  balanceBf: number
  nav: number
  drawdown: number
  margin: number
  marginRatio: number
  dailyPl: number
  fee: number
  deposit: number
  riskDegree: number
}

export type RonghangNamedAmount = {
  key: string
  name: string
  sector?: string
  pnl: number
  lots: number
  weight: number
  winRate?: number
}

export type RonghangDirectionRow = {
  product: string
  productName: string
  direction: "买" | "卖"
  pnl: number
  weight: number
}

export type RonghangHoldingPeriodRow = {
  period: "日内" | "短线" | "中线" | "长线"
  profitAmount: number
  lossAmount: number
  pnl: number
  lots: number
  lotShare: number
  trades: number
  wins: number
  winRate: number
}

export type RonghangLongShortBucket = {
  lots: number
  pnl: number
  avgPnl: number
}

export type RonghangZipReport = {
  sourceFileName: string
  fileCount: number
  meta: {
    clientId: string
    clientName: string
    brokerName: string
    startDate: string
    endDate: string
    tradingDays: number
  }
  overview: {
    startBalance: number
    endBalance: number
    startEquity: number
    endEquity: number
    totalDeposit: number
    totalWithdraw: number
    netDeposit: number
    totalFee: number
    netProfit: number
    unitNav: number
    maxNav: number
    periodReturn: number
    annualizedReturn: number
    maxDailyDrawdown: number
    maxPeakDrawdown: number
    continuousDrawdownCalendarDays: number
    longestUnderwaterCalendarDays: number
    annualizedVol: number
    annualizedDownsideVol: number
    totalLots: number
    totalTrades: number
    dailyWinRate: number
    monthlyWinRate: number
    avgMargin: number
    avgMarginRatio: number
    sharpe: number
    sortino: number
    calmar: number
    avgFeeRatio: number
  }
  equityCurve: RonghangEquityPoint[]
  monthlyReturns: Array<{ month: string; returnPct: number; pnl: number }>
  drawdownBuckets: Array<{ label: string; days: number; share: number }>
  sectorPnl: RonghangNamedAmount[]
  productPnl: RonghangNamedAmount[]
  directionAttribution: RonghangDirectionRow[]
  longShortStats: {
    overall: { win: RonghangLongShortBucket; loss: RonghangLongShortBucket; flat: RonghangLongShortBucket; totalPnl: number; totalLots: number; winRate: number; profitFactor: number }
    longClose: { win: RonghangLongShortBucket; loss: RonghangLongShortBucket; flat: RonghangLongShortBucket; totalPnl: number; totalLots: number; winRate: number; profitFactor: number }
    shortClose: { win: RonghangLongShortBucket; loss: RonghangLongShortBucket; flat: RonghangLongShortBucket; totalPnl: number; totalLots: number; winRate: number; profitFactor: number }
  }
  holdingPeriodStats: RonghangHoldingPeriodRow[]
  narrative: {
    returnSummary: string
    monthlySummary: string
    navSummary: string
    drawdownSummary: string
    topProfitSectors: string[]
    topLossSectors: string[]
    topProfitProducts: string[]
    topLossProducts: string[]
  }
  warnings: string[]
}

function calendarDaysInclusive(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00`)
  const b = new Date(`${end}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1
}

function holdingBucket(openDate: string, closeDate: string): RonghangHoldingPeriodRow["period"] {
  if (!openDate || !closeDate) return "短线"
  const a = new Date(`${openDate}T00:00:00`)
  const b = new Date(`${closeDate}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "短线"
  const gap = Math.floor((b.getTime() - a.getTime()) / 86400000)
  if (gap <= 0) return "日内"
  if (gap <= 5) return "短线"
  if (gap <= 20) return "中线"
  return "长线"
}

/** Close side: 卖平 → original long (买); 买平 → original short (卖). */
function closeDirection(bs: string): "买" | "卖" {
  const s = bs.replace(/\s/g, "")
  if (s.includes("卖")) return "买"
  if (s.includes("买")) return "卖"
  return "买"
}

function emptyBucket(): RonghangLongShortBucket {
  return { lots: 0, pnl: 0, avgPnl: 0 }
}

function finalizeSideStats(rows: Array<{ lots: number; pnl: number }>) {
  const win = emptyBucket()
  const loss = emptyBucket()
  const flat = emptyBucket()
  for (const row of rows) {
    const target = row.pnl > 0 ? win : row.pnl < 0 ? loss : flat
    target.lots += row.lots
    target.pnl += row.pnl
  }
  for (const b of [win, loss, flat]) {
    b.avgPnl = b.lots > 0 ? b.pnl / b.lots : 0
  }
  const totalLots = win.lots + loss.lots + flat.lots
  const totalPnl = win.pnl + loss.pnl + flat.pnl
  const winRate = totalLots > 0 ? win.lots / totalLots : 0
  const profitFactor = loss.pnl < 0 ? Math.abs(win.pnl / loss.pnl) : win.pnl > 0 ? Infinity : 0
  return { win, loss, flat, totalPnl, totalLots, winRate, profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0 }
}

function describeNamed(items: RonghangNamedAmount[], kind: "profit" | "loss", limit = 3): string[] {
  const sorted =
    kind === "profit"
      ? [...items].filter((x) => x.pnl > 0).sort((a, b) => b.pnl - a.pnl)
      : [...items].filter((x) => x.pnl < 0).sort((a, b) => a.pnl - b.pnl)
  return sorted.slice(0, limit).map((item) => {
    const verb = kind === "profit" ? "盈利" : "亏损"
    return `${item.name}：${verb} ${item.pnl.toFixed(2)} 元，手数 ${item.lots.toFixed(1)}，权重 ${(item.weight * 100).toFixed(2)}%`
  })
}

export function analyzeRonghangDays(days: RonghangDayBundle[], sourceFileName: string): RonghangZipReport {
  if (days.length === 0) {
    throw new Error("ZIP 中未解析到有效的结算单文件。")
  }

  const sorted = [...days].sort((a, b) => a.account.tradeDate.localeCompare(b.account.tradeDate))
  const warnings = sorted.flatMap((d) => d.warnings)
  const first = sorted[0].account
  const last = sorted[sorted.length - 1].account

  const totalFee = sorted.reduce((s, d) => s + d.account.commission, 0)
  const totalPl = sorted.reduce((s, d) => s + d.account.dailyPl, 0)
  const netDeposit = sorted.reduce((s, d) => s + d.account.depositWithdrawal, 0)
  const totalDeposit = sorted.reduce((s, d) => s + Math.max(0, d.account.depositWithdrawal), 0)
  const totalWithdraw = sorted.reduce((s, d) => s + Math.max(0, -d.account.depositWithdrawal), 0)
  const netProfit = totalPl - totalFee

  // NAV path: r_t = dailyPl / balanceBf  (matches report unit NAV ≈ 1.026)
  let nav = 1
  let peakNav = 1
  let maxNav = 1
  let maxPeakDrawdown = 0
  let maxDailyDrawdown = 0
  let ddStart = first.tradeDate
  let ddEnd = first.tradeDate
  let peakDate = first.tradeDate
  let longestUnderwater = 0
  let underwaterStart: string | null = null
  const dailyReturns: number[] = []
  const equityCurve: RonghangEquityPoint[] = []

  for (const day of sorted) {
    const base = day.account.balanceBf || day.account.clientEquity || 1
    const r = day.account.dailyPl / base
    dailyReturns.push(r)
    nav *= 1 + r
    maxNav = Math.max(maxNav, nav)
    if (nav >= peakNav) {
      peakNav = nav
      peakDate = day.account.tradeDate
      if (underwaterStart) {
        longestUnderwater = Math.max(longestUnderwater, calendarDaysInclusive(underwaterStart, day.account.tradeDate) - 1)
        underwaterStart = null
      }
    } else if (!underwaterStart) {
      underwaterStart = peakDate
    }
    const drawdown = peakNav > 0 ? (peakNav - nav) / peakNav : 0
    if (drawdown > maxPeakDrawdown) {
      maxPeakDrawdown = drawdown
      ddStart = peakDate
      ddEnd = day.account.tradeDate
    }
    if (r < 0) maxDailyDrawdown = Math.max(maxDailyDrawdown, -r)

    const marginRatio =
      day.account.clientEquity > 0 ? day.account.marginOccupied / day.account.clientEquity : 0
    equityCurve.push({
      date: day.account.tradeDate,
      equity: day.account.clientEquity,
      balanceBf: day.account.balanceBf,
      nav,
      drawdown,
      margin: day.account.marginOccupied,
      marginRatio,
      dailyPl: day.account.dailyPl,
      fee: day.account.commission,
      deposit: day.account.depositWithdrawal,
      riskDegree: day.account.riskDegree,
    })
  }
  if (underwaterStart) {
    longestUnderwater = Math.max(longestUnderwater, calendarDaysInclusive(underwaterStart, last.tradeDate))
  }

  const n = sorted.length
  const periodReturn = nav - 1
  const annualizedReturn = nav > 0 ? nav ** (252 / n) - 1 : -1
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / n
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  const std = Math.sqrt(variance)
  const downside = dailyReturns.filter((r) => r < 0)
  const downVar =
    downside.length > 0 ? downside.reduce((s, r) => s + r * r, 0) / downside.length : 0
  const downStd = Math.sqrt(downVar)
  const annualizedVol = std * Math.sqrt(252)
  const annualizedDownsideVol = downStd * Math.sqrt(252)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0
  const sortino = downStd > 0 ? (mean / downStd) * Math.sqrt(252) : 0
  const calmar = maxPeakDrawdown > 0 ? annualizedReturn / maxPeakDrawdown : 0

  const avgEquity = sorted.reduce((s, d) => s + d.account.clientEquity, 0) / n
  const avgMargin = sorted.reduce((s, d) => s + d.account.marginOccupied, 0) / n
  const avgMarginRatio = avgEquity > 0 ? avgMargin / avgEquity : 0
  const avgFeeRatio = avgEquity > 0 ? totalFee / n / avgEquity : 0
  const dailyWinRate = sorted.filter((d) => d.account.dailyPl > 0).length / n

  // Monthly
  const monthMap = new Map<string, { startNav: number; endNav: number; pnl: number; startIdx: number }>()
  let runningNav = 1
  for (let i = 0; i < sorted.length; i++) {
    const day = sorted[i]
    const month = day.account.tradeDate.slice(0, 7)
    const base = day.account.balanceBf || 1
    const r = day.account.dailyPl / base
    const prevNav = runningNav
    runningNav *= 1 + r
    const cur = monthMap.get(month)
    if (!cur) {
      monthMap.set(month, {
        startNav: prevNav,
        endNav: runningNav,
        pnl: day.account.dailyPl - day.account.commission,
        startIdx: i,
      })
    } else {
      cur.endNav = runningNav
      cur.pnl += day.account.dailyPl - day.account.commission
    }
  }
  const monthlyReturns = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      returnPct: v.startNav > 0 ? v.endNav / v.startNav - 1 : 0,
      pnl: v.pnl,
    }))
  const monthlyWinRate =
    monthlyReturns.length > 0 ? monthlyReturns.filter((m) => m.returnPct > 0).length / monthlyReturns.length : 0

  // Drawdown buckets on trading days
  const bucketLabels = ["<=10%", "<=20%", "<=30%", "<=40%", "<=50%", "<=60%", "<=70%", "<=80%", "<=90%", "<=100%"]
  const bucketCounts = new Array(bucketLabels.length).fill(0)
  for (const pt of equityCurve) {
    const pct = pt.drawdown * 100
    const idx = Math.min(bucketLabels.length - 1, Math.max(0, Math.ceil(pct / 10) - 1))
    if (pct <= 0) continue
    bucketCounts[idx] += 1
  }
  const bucketTotal = bucketCounts.reduce((s, x) => s + x, 0) || 1
  const drawdownBuckets = bucketLabels.map((label, i) => ({
    label,
    days: bucketCounts[i],
    share: bucketCounts[i] / bucketTotal,
  }))

  // Resolve 原成交序号 → open date from trades / 持仓明细
  const openDateByTradeId = new Map<string, string>()
  for (const day of sorted) {
    for (const trade of day.trades) {
      if (trade.tradeId) openDateByTradeId.set(trade.tradeId.replace(/^0+/, "") || trade.tradeId, trade.tradeDate)
    }
    for (const detail of day.positionDetails) {
      if (detail.tradeId) {
        openDateByTradeId.set(detail.tradeId.replace(/^0+/, "") || detail.tradeId, detail.openDate)
      }
    }
  }

  // Product / sector attribution = closed PL + daily position MTM
  // Lots use成交明细手数 (matches report “交易手数”)
  const productAgg = new Map<string, { pnl: number; lots: number }>()
  const directionAgg = new Map<string, { product: string; direction: "买" | "卖"; pnl: number }>()
  const closeRows: Array<{ lots: number; pnl: number; direction: "买" | "卖"; period: RonghangHoldingPeriodRow["period"] }> = []

  for (const day of sorted) {
    for (const trade of day.trades) {
      const cur = productAgg.get(trade.product) ?? { pnl: 0, lots: 0 }
      cur.lots += trade.lots
      productAgg.set(trade.product, cur)
    }
    for (const close of day.closes) {
      const cur = productAgg.get(close.product) ?? { pnl: 0, lots: 0 }
      cur.pnl += close.realizedPl
      productAgg.set(close.product, cur)

      const dir = closeDirection(close.bs)
      const dKey = `${close.product}\0${dir}`
      const dCur = directionAgg.get(dKey) ?? { product: close.product, direction: dir, pnl: 0 }
      dCur.pnl += close.realizedPl
      directionAgg.set(dKey, dCur)

      const openIdNorm = close.openTradeId.replace(/^0+/, "") || close.openTradeId
      const resolvedOpen =
        close.openDate ||
        (openIdNorm ? openDateByTradeId.get(openIdNorm) ?? openDateByTradeId.get(close.openTradeId) ?? "" : "")
      closeRows.push({
        lots: close.lots,
        pnl: close.realizedPl,
        direction: dir,
        period: holdingBucket(resolvedOpen, close.tradeDate),
      })
    }
    for (const pos of day.positions) {
      const cur = productAgg.get(pos.product) ?? { pnl: 0, lots: 0 }
      cur.pnl += pos.mtmPl
      productAgg.set(pos.product, cur)

      const dir: "买" | "卖" = pos.longPos >= pos.shortPos ? "买" : "卖"
      const dKey = `${pos.product}\0${dir}`
      const dCur = directionAgg.get(dKey) ?? { product: pos.product, direction: dir, pnl: 0 }
      dCur.pnl += pos.mtmPl
      directionAgg.set(dKey, dCur)
    }
  }

  const absProfit = [...productAgg.values()].reduce((s, v) => s + Math.abs(v.pnl), 0) || 1
  const productPnl: RonghangNamedAmount[] = [...productAgg.entries()]
    .map(([product, v]) => ({
      key: product,
      name: productDisplayName(product),
      sector: productSector(product),
      pnl: v.pnl,
      lots: v.lots,
      weight: Math.abs(v.pnl) / absProfit,
    }))
    .sort((a, b) => a.pnl - b.pnl)

  const sectorMap = new Map<string, { pnl: number; lots: number }>()
  for (const p of productPnl) {
    const sector = p.sector ?? "其他"
    const cur = sectorMap.get(sector) ?? { pnl: 0, lots: 0 }
    cur.pnl += p.pnl
    cur.lots += p.lots
    sectorMap.set(sector, cur)
  }
  const sectorAbs = [...sectorMap.values()].reduce((s, v) => s + Math.abs(v.pnl), 0) || 1
  const sectorPnl: RonghangNamedAmount[] = [...sectorMap.entries()]
    .map(([sector, v]) => ({
      key: sector,
      name: sector,
      sector,
      pnl: v.pnl,
      lots: v.lots,
      weight: Math.abs(v.pnl) / sectorAbs,
    }))
    .sort((a, b) => a.pnl - b.pnl)

  const dirAbs = [...directionAgg.values()].reduce((s, v) => s + Math.abs(v.pnl), 0) || 1
  const directionAttribution: RonghangDirectionRow[] = [...directionAgg.values()]
    .map((v) => ({
      product: v.product,
      productName: productDisplayName(v.product),
      direction: v.direction,
      pnl: v.pnl,
      weight: Math.abs(v.pnl) / dirAbs,
    }))
    .sort((a, b) => a.pnl - b.pnl)

  const longClose = finalizeSideStats(closeRows.filter((r) => r.direction === "买"))
  const shortClose = finalizeSideStats(closeRows.filter((r) => r.direction === "卖"))
  const overall = finalizeSideStats(closeRows)

  const periodKeys: RonghangHoldingPeriodRow["period"][] = ["日内", "短线", "中线", "长线"]
  const periodMap = new Map<RonghangHoldingPeriodRow["period"], { profit: number; loss: number; lots: number; trades: number; wins: number }>()
  for (const k of periodKeys) periodMap.set(k, { profit: 0, loss: 0, lots: 0, trades: 0, wins: 0 })
  for (const row of closeRows) {
    const cur = periodMap.get(row.period)!
    if (row.pnl >= 0) cur.profit += row.pnl
    else cur.loss += row.pnl
    cur.lots += row.lots
    cur.trades += 1
    if (row.pnl > 0) cur.wins += 1
  }
  const totalCloseLots = closeRows.reduce((s, r) => s + r.lots, 0) || 1
  const holdingPeriodStats: RonghangHoldingPeriodRow[] = periodKeys.map((period) => {
    const cur = periodMap.get(period)!
    return {
      period,
      profitAmount: cur.profit,
      lossAmount: cur.loss,
      pnl: cur.profit + cur.loss,
      lots: cur.lots,
      lotShare: cur.lots / totalCloseLots,
      trades: cur.trades,
      wins: cur.wins,
      winRate: cur.trades > 0 ? cur.wins / cur.trades : 0,
    }
  })

  const totalLots = sorted.reduce((s, d) => s + d.trades.reduce((ss, t) => ss + t.lots, 0), 0)
  const totalTrades = sorted.reduce((s, d) => s + d.trades.length, 0)

  const bestMonth = [...monthlyReturns].sort((a, b) => b.returnPct - a.returnPct)[0]
  const worstMonth = [...monthlyReturns].sort((a, b) => a.returnPct - b.returnPct)[0]
  const maxNavPoint = equityCurve.reduce((best, p) => (p.nav >= best.nav ? p : best), equityCurve[0])
  const minNavPoint = equityCurve.reduce((best, p) => (p.nav <= best.nav ? p : best), equityCurve[0])
  const maxMarginPoint = equityCurve.reduce((best, p) => (p.marginRatio >= best.marginRatio ? p : best), equityCurve[0])

  const continuousDrawdownCalendarDays = calendarDaysInclusive(ddStart, ddEnd)

  return {
    sourceFileName,
    fileCount: sorted.length,
    meta: {
      clientId: first.clientId,
      clientName: first.clientName,
      brokerName: first.brokerName,
      startDate: first.tradeDate,
      endDate: last.tradeDate,
      tradingDays: n,
    },
    overview: {
      startBalance: first.balanceBf,
      endBalance: last.balanceCf,
      startEquity: first.balanceBf,
      endEquity: last.clientEquity,
      totalDeposit,
      totalWithdraw,
      netDeposit,
      totalFee,
      netProfit,
      unitNav: maxNav,
      maxNav,
      periodReturn,
      annualizedReturn,
      maxDailyDrawdown,
      maxPeakDrawdown,
      continuousDrawdownCalendarDays,
      longestUnderwaterCalendarDays: Math.max(longestUnderwater, continuousDrawdownCalendarDays),
      annualizedVol,
      annualizedDownsideVol,
      totalLots,
      totalTrades,
      dailyWinRate,
      monthlyWinRate,
      avgMargin,
      avgMarginRatio,
      sharpe,
      sortino,
      calmar,
      avgFeeRatio,
    },
    equityCurve,
    monthlyReturns,
    drawdownBuckets,
    sectorPnl,
    productPnl,
    directionAttribution,
    longShortStats: { overall, longClose, shortClose },
    holdingPeriodStats,
    narrative: {
      returnSummary: `报告区间 ${first.tradeDate} ~ ${last.tradeDate}，共 ${n} 个交易日，累计收益率 ${(periodReturn * 100).toFixed(2)}%。最高净值出现在 ${maxNavPoint.date}（${maxNavPoint.nav.toFixed(4)}），最低净值出现在 ${minNavPoint.date}（${minNavPoint.nav.toFixed(4)}）。`,
      monthlySummary: `共交易 ${monthlyReturns.length} 个月，月胜率 ${(monthlyWinRate * 100).toFixed(1)}%。${
        bestMonth ? `收益最高月份 ${bestMonth.month}（${(bestMonth.returnPct * 100).toFixed(2)}%，盈亏 ${bestMonth.pnl.toFixed(2)}）。` : ""
      }${worstMonth ? `收益最低月份 ${worstMonth.month}（${(worstMonth.returnPct * 100).toFixed(2)}%，盈亏 ${worstMonth.pnl.toFixed(2)}）。` : ""}`,
      navSummary: `期末累计净值 ${nav.toFixed(4)}，平均持仓占比（保证金/权益） ${(avgMarginRatio * 100).toFixed(2)}%，峰值出现在 ${maxMarginPoint.date}（${(maxMarginPoint.marginRatio * 100).toFixed(2)}%）。`,
      drawdownSummary: `最大峰值回撤 ${(maxPeakDrawdown * 100).toFixed(4)}%，回撤区间 ${ddStart} ~ ${ddEnd}；单日最大回撤 ${(maxDailyDrawdown * 100).toFixed(4)}%；最长未创新高约 ${Math.max(longestUnderwater, continuousDrawdownCalendarDays)} 天。`,
      topProfitSectors: describeNamed(sectorPnl, "profit"),
      topLossSectors: describeNamed(sectorPnl, "loss"),
      topProfitProducts: describeNamed(productPnl, "profit"),
      topLossProducts: describeNamed(productPnl, "loss"),
    },
    warnings,
  }
}

export async function analyzeRonghangZipBuffer(
  buffer: Buffer,
  sourceFileName: string,
): Promise<RonghangZipReport> {
  const { entries } = await extractRonghangArchiveEntries(buffer, sourceFileName)

  const days: RonghangDayBundle[] = []
  const errors: string[] = []
  for (const entry of entries) {
    try {
      days.push(parseRonghangWorkbook(entry.data, entry.name))
    } catch (error) {
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : "解析失败"}`)
    }
  }

  if (days.length === 0) {
    throw new Error(`未能解析任何结算单。${errors.slice(0, 3).join("；")}`)
  }

  const report = analyzeRonghangDays(days, sourceFileName)
  if (errors.length) {
    report.warnings = [...report.warnings, ...errors.map((e) => `跳过文件：${e}`)]
  }
  return report
}
