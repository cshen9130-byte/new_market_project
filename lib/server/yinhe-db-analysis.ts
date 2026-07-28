import { query } from "@/lib/db"
import type { GuoxinDBAnalysisResult } from "@/lib/server/guoxin-db-analysis"

interface AccountRow {
  trade_date: string
  realized_pl: string | number
  mtm_pl: string | number
  commission: string | number
  client_equity: string | number
  margin_occupied: string | number
  risk_degree: string | number
}

interface TradeRow {
  trade_date: string
  settlement_date: string
  product: string
  instrument: string
  bs: string
  oc: string
  lots: string | number
  price: string | number
  turnover: string | number
  fee: string | number
  realized_pl: string | number
}

interface PositionRow {
  settlement_date: string
  product: string
  instrument: string
  long_pos: string | number
  short_pos: string | number
  mtm_pl: string | number
  margin_occupied: string | number
}

interface ClosedRow {
  settlement_date: string
  product: string
  instrument: string
  bs: string
  lots: string | number
  realized_pl: string | number
}

function n(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const x = typeof v === "string" ? parseFloat(v) : v
  return isNaN(x) ? 0 : x
}

/** Same response shape as Guosen DB analysis for shared UI charts/tables. */
export async function runYinheDBAnalysis(): Promise<GuoxinDBAnalysisResult> {
  const [accountRows, tradeRows, positionRows, closedRows] = await Promise.all([
    query<AccountRow>(
      "SELECT trade_date, realized_pl, mtm_pl, commission, client_equity, margin_occupied, risk_degree FROM yinhe_account_summary ORDER BY trade_date",
    ),
    query<TradeRow>(
      "SELECT trade_date, settlement_date, product, instrument, bs, oc, lots, price, turnover, fee, realized_pl FROM yinhe_transaction_records ORDER BY trade_date, settlement_date",
    ),
    query<PositionRow>(
      "SELECT settlement_date, product, instrument, long_pos, short_pos, mtm_pl, margin_occupied FROM yinhe_position_summary ORDER BY settlement_date, product, instrument",
    ),
    query<ClosedRow>(
      "SELECT settlement_date, product, instrument, bs, lots, realized_pl FROM yinhe_position_closed ORDER BY settlement_date, product, instrument",
    ),
  ])

  if (accountRows.length === 0) {
    throw new Error("数据库中无银河账户数据，请先从邮件拉取并解析结算单。")
  }

  const startDate = accountRows[0].trade_date
  const endDate = accountRows[accountRows.length - 1].trade_date

  const equityHistory = accountRows.map((row) => ({
    date: row.trade_date,
    clientEquity: n(row.client_equity),
    riskDegree: n(row.risk_degree),
    marginOccupied: n(row.margin_occupied),
    mtmPl: n(row.mtm_pl),
    realizedPl: n(row.realized_pl),
  }))

  const startEquity = n(accountRows[0].client_equity)
  const endEquity = n(accountRows[accountRows.length - 1].client_equity)
  const feeTotal = accountRows.reduce((s, r) => s + n(r.commission), 0)
  const maxRiskDegree = Math.max(...accountRows.map((r) => n(r.risk_degree)))

  const equityStats = {
    startDate,
    endDate,
    startEquity,
    endEquity,
    returnPct: startEquity > 0 ? (endEquity - startEquity) / startEquity : 0,
    feeTotal,
    maxRiskDegree,
    totalDays: accountRows.length,
  }

  const turnoverMap = new Map<string, { turnover: number; lots: number }>()
  for (const row of tradeRows) {
    const p = row.product || "其他"
    const cur = turnoverMap.get(p) ?? { turnover: 0, lots: 0 }
    turnoverMap.set(p, { turnover: cur.turnover + n(row.turnover), lots: cur.lots + n(row.lots) })
  }
  const totalTurnover = Array.from(turnoverMap.values()).reduce((s, v) => s + v.turnover, 0)
  const turnover = Array.from(turnoverMap.entries())
    .map(([product, v]) => ({
      product,
      turnover: v.turnover,
      turnoverPct: totalTurnover > 0 ? v.turnover / totalTurnover : 0,
      lots: v.lots,
    }))
    .sort((a, b) => b.turnover - a.turnover)

  const nettingMap = new Map<string, { longLots: number; shortLots: number; mtmPl: number; margin: number }>()
  for (const row of positionRows) {
    const key = `${row.settlement_date}\0${row.product}`
    const cur = nettingMap.get(key) ?? { longLots: 0, shortLots: 0, mtmPl: 0, margin: 0 }
    nettingMap.set(key, {
      longLots: cur.longLots + n(row.long_pos),
      shortLots: cur.shortLots + n(row.short_pos),
      mtmPl: cur.mtmPl + n(row.mtm_pl),
      margin: cur.margin + n(row.margin_occupied),
    })
  }
  const productNetting = Array.from(nettingMap.entries())
    .map(([key, v]) => {
      const sep = key.indexOf("\0")
      return {
        settlementDate: key.slice(0, sep),
        product: key.slice(sep + 1),
        longLots: v.longLots,
        shortLots: v.shortLots,
        netLots: v.longLots - v.shortLots,
        mtmPl: v.mtmPl,
        margin: v.margin,
      }
    })
    .sort(
      (a, b) =>
        a.settlementDate.localeCompare(b.settlementDate) || a.product.localeCompare(b.product),
    )

  const openClusterMap = new Map<
    string,
    Map<string, { lots: number; weightedPrice: number; turnover: number; fees: number; bs: string; instrument: string }>
  >()
  for (const row of tradeRows) {
    if (row.oc !== "开") continue
    const clusterKey = `${row.trade_date}\0${row.product}`
    const subKey = `${row.instrument}\0${row.bs}`
    if (!openClusterMap.has(clusterKey)) openClusterMap.set(clusterKey, new Map())
    const subMap = openClusterMap.get(clusterKey)!
    const cur = subMap.get(subKey) ?? {
      lots: 0,
      weightedPrice: 0,
      turnover: 0,
      fees: 0,
      bs: row.bs,
      instrument: row.instrument,
    }
    const lots = n(row.lots)
    const price = n(row.price)
    subMap.set(subKey, {
      lots: cur.lots + lots,
      weightedPrice: cur.weightedPrice + price * lots,
      turnover: cur.turnover + n(row.turnover),
      fees: cur.fees + n(row.fee),
      bs: row.bs,
      instrument: row.instrument,
    })
  }
  const tradeClusters = Array.from(openClusterMap.entries())
    .map(([clusterKey, subMap]) => {
      const sep = clusterKey.indexOf("\0")
      const items = Array.from(subMap.values()).map((s) => ({
        instrument: s.instrument,
        bs: s.bs,
        lots: s.lots,
        avgPrice: s.lots > 0 ? s.weightedPrice / s.lots : 0,
        turnover: s.turnover,
        fees: s.fees,
      }))
      return {
        tradeDate: clusterKey.slice(0, sep),
        product: clusterKey.slice(sep + 1),
        items,
        totalTurnover: items.reduce((s, i) => s + i.turnover, 0),
        totalFees: items.reduce((s, i) => s + i.fees, 0),
      }
    })
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.product.localeCompare(b.product))

  const closeClusterMap = new Map<
    string,
    Map<string, { lots: number; realizedPl: number; bs: string; instrument: string }>
  >()
  for (const row of closedRows) {
    const clusterKey = `${row.settlement_date}\0${row.product}`
    const subKey = `${row.instrument}\0${row.bs}`
    if (!closeClusterMap.has(clusterKey)) closeClusterMap.set(clusterKey, new Map())
    const subMap = closeClusterMap.get(clusterKey)!
    const cur = subMap.get(subKey) ?? { lots: 0, realizedPl: 0, bs: row.bs, instrument: row.instrument }
    subMap.set(subKey, {
      lots: cur.lots + n(row.lots),
      realizedPl: cur.realizedPl + n(row.realized_pl),
      bs: row.bs,
      instrument: row.instrument,
    })
  }
  // Fallback: when closed table empty, derive close clusters from trade rows with 平
  if (closeClusterMap.size === 0) {
    for (const row of tradeRows) {
      if (row.oc !== "平") continue
      const clusterKey = `${row.settlement_date || row.trade_date}\0${row.product}`
      const subKey = `${row.instrument}\0${row.bs}`
      if (!closeClusterMap.has(clusterKey)) closeClusterMap.set(clusterKey, new Map())
      const subMap = closeClusterMap.get(clusterKey)!
      const cur = subMap.get(subKey) ?? { lots: 0, realizedPl: 0, bs: row.bs, instrument: row.instrument }
      subMap.set(subKey, {
        lots: cur.lots + n(row.lots),
        realizedPl: cur.realizedPl + n(row.realized_pl),
        bs: row.bs,
        instrument: row.instrument,
      })
    }
  }

  const closeClusters = Array.from(closeClusterMap.entries())
    .map(([clusterKey, subMap]) => {
      const sep = clusterKey.indexOf("\0")
      const items = Array.from(subMap.values()).map((s) => ({
        instrument: s.instrument,
        bs: s.bs,
        lots: s.lots,
        realizedPl: s.realizedPl,
      }))
      return {
        settlementDate: clusterKey.slice(0, sep),
        product: clusterKey.slice(sep + 1),
        totalLots: items.reduce((s, i) => s + i.lots, 0),
        totalRealizedPl: items.reduce((s, i) => s + i.realizedPl, 0),
        items,
      }
    })
    .sort(
      (a, b) =>
        a.settlementDate.localeCompare(b.settlementDate) || a.product.localeCompare(b.product),
    )

  const uniqueProducts = [...new Set(tradeRows.map((r) => r.product).filter(Boolean))].sort()

  return {
    dateRange: { start: startDate, end: endDate },
    equityStats,
    equityHistory,
    turnover,
    productNetting,
    tradeClusters,
    closeClusters,
    uniqueProducts,
  }
}
