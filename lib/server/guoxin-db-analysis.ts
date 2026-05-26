import { query } from "@/lib/db"

// ---------------------------------------------------------------------------
// Row types (match PostgreSQL column names exactly)
// ---------------------------------------------------------------------------

interface AccountRow {
  trade_date: string
  balance_bf: string | number
  realized_pl: string | number
  mtm_pl: string | number
  commission: string | number
  exercise_fee: string | number | null
  delivery_fee: string | number | null
  client_equity: string | number
  margin_occupied: string | number
  fund_avail: string | number
  risk_degree: string | number
  balance_cf: string | number
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
  avg_buy_price: string | number
  avg_sell_price: string | number
  prev_settl: string | number
  settl_today: string | number
  mtm_pl: string | number
  margin_occupied: string | number
}

interface ClosedRow {
  settlement_date: string
  product: string
  instrument: string
  bs: string
  lots: string | number
  pos_open_price: string | number
  prev_settl: string | number
  trans_price: string | number
  realized_pl: string | number
}

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

export interface GuoxinEquityPoint {
  date: string
  clientEquity: number
  riskDegree: number
  marginOccupied: number
  mtmPl: number
  realizedPl: number
}

export interface GuoxinEquityStats {
  startDate: string
  endDate: string
  startEquity: number
  endEquity: number
  returnPct: number
  feeTotal: number
  maxRiskDegree: number
  totalDays: number
}

export interface GuoxinTurnoverItem {
  product: string
  turnover: number
  turnoverPct: number
  lots: number
}

export interface GuoxinNettingRow {
  settlementDate: string
  product: string
  longLots: number
  shortLots: number
  netLots: number
  mtmPl: number
  margin: number
}

export interface GuoxinTradeClusterItem {
  instrument: string
  bs: string
  lots: number
  avgPrice: number
  turnover: number
  fees: number
}

export interface GuoxinTradeCluster {
  tradeDate: string
  product: string
  items: GuoxinTradeClusterItem[]
  totalTurnover: number
  totalFees: number
}

export interface GuoxinCloseClusterItem {
  instrument: string
  bs: string
  lots: number
  realizedPl: number
}

export interface GuoxinCloseCluster {
  settlementDate: string
  product: string
  totalLots: number
  totalRealizedPl: number
  items: GuoxinCloseClusterItem[]
}

export interface GuoxinDBAnalysisResult {
  dateRange: { start: string; end: string }
  equityStats: GuoxinEquityStats
  equityHistory: GuoxinEquityPoint[]
  turnover: GuoxinTurnoverItem[]
  productNetting: GuoxinNettingRow[]
  tradeClusters: GuoxinTradeCluster[]
  closeClusters: GuoxinCloseCluster[]
  uniqueProducts: string[]
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function n(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const x = typeof v === "string" ? parseFloat(v) : v
  return isNaN(x) ? 0 : x
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export async function runGuoxinDBAnalysis(): Promise<GuoxinDBAnalysisResult> {
  const [accountRows, tradeRows, positionRows, closedRows] = await Promise.all([
    query<AccountRow>(
      "SELECT trade_date, balance_bf, realized_pl, mtm_pl, commission, exercise_fee, delivery_fee, client_equity, margin_occupied, fund_avail, risk_degree, balance_cf FROM guosen_account_summary ORDER BY trade_date",
    ),
    query<TradeRow>(
      "SELECT trade_date, settlement_date, product, instrument, bs, oc, lots, price, turnover, fee, realized_pl FROM guosen_transaction_records ORDER BY trade_date, settlement_date",
    ),
    query<PositionRow>(
      "SELECT settlement_date, product, instrument, long_pos, short_pos, avg_buy_price, avg_sell_price, prev_settl, settl_today, mtm_pl, margin_occupied FROM guosen_position_summary ORDER BY settlement_date, product, instrument",
    ),
    query<ClosedRow>(
      "SELECT settlement_date, product, instrument, bs, lots, pos_open_price, prev_settl, trans_price, realized_pl FROM guosen_position_closed ORDER BY settlement_date, product, instrument",
    ),
  ])

  if (accountRows.length === 0) {
    throw new Error("数据库中无国信账户数据，请确认 guosen_account_summary 表已导入。")
  }

  // ---- 1. Date range ----
  const startDate = accountRows[0].trade_date
  const endDate = accountRows[accountRows.length - 1].trade_date

  // ---- 2. Equity history ----
  const equityHistory: GuoxinEquityPoint[] = accountRows.map((row) => ({
    date: row.trade_date,
    clientEquity: n(row.client_equity),
    riskDegree: n(row.risk_degree),
    marginOccupied: n(row.margin_occupied),
    mtmPl: n(row.mtm_pl),
    realizedPl: n(row.realized_pl),
  }))

  // ---- 3. Equity stats ----
  const startEquity = n(accountRows[0].client_equity)
  const endEquity = n(accountRows[accountRows.length - 1].client_equity)
  const feeTotal = accountRows.reduce(
    (s, r) => s + n(r.commission) + n(r.exercise_fee) + n(r.delivery_fee),
    0,
  )
  const maxRiskDegree = Math.max(...accountRows.map((r) => n(r.risk_degree)))

  const equityStats: GuoxinEquityStats = {
    startDate,
    endDate,
    startEquity,
    endEquity,
    returnPct: startEquity > 0 ? (endEquity - startEquity) / startEquity : 0,
    feeTotal,
    maxRiskDegree,
    totalDays: accountRows.length,
  }

  // ---- 4. Turnover by product ----
  const turnoverMap = new Map<string, { turnover: number; lots: number }>()
  for (const row of tradeRows) {
    const p = row.product || "其他"
    const cur = turnoverMap.get(p) ?? { turnover: 0, lots: 0 }
    turnoverMap.set(p, { turnover: cur.turnover + n(row.turnover), lots: cur.lots + n(row.lots) })
  }
  const totalTurnover = Array.from(turnoverMap.values()).reduce((s, v) => s + v.turnover, 0)
  const turnover: GuoxinTurnoverItem[] = Array.from(turnoverMap.entries())
    .map(([product, v]) => ({
      product,
      turnover: v.turnover,
      turnoverPct: totalTurnover > 0 ? v.turnover / totalTurnover : 0,
      lots: v.lots,
    }))
    .sort((a, b) => b.turnover - a.turnover)

  // ---- 5. Daily product netting ----
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
  const productNetting: GuoxinNettingRow[] = Array.from(nettingMap.entries())
    .map(([key, v]) => {
      const sep = key.indexOf("\0")
      const settlementDate = key.slice(0, sep)
      const product = key.slice(sep + 1)
      return {
        settlementDate,
        product,
        longLots: v.longLots,
        shortLots: v.shortLots,
        netLots: v.longLots - v.shortLots,
        mtmPl: v.mtmPl,
        margin: v.margin,
      }
    })
    .sort((a, b) =>
      a.settlementDate.localeCompare(b.settlementDate) || a.product.localeCompare(b.product),
    )

  // ---- 6. Trade clusters (open trades grouped by date + product) ----
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

  const tradeClusters: GuoxinTradeCluster[] = Array.from(openClusterMap.entries())
    .map(([clusterKey, subMap]) => {
      const sep = clusterKey.indexOf("\0")
      const tradeDate = clusterKey.slice(0, sep)
      const product = clusterKey.slice(sep + 1)
      const items: GuoxinTradeClusterItem[] = Array.from(subMap.values()).map((s) => ({
        instrument: s.instrument,
        bs: s.bs,
        lots: s.lots,
        avgPrice: s.lots > 0 ? s.weightedPrice / s.lots : 0,
        turnover: s.turnover,
        fees: s.fees,
      }))
      return {
        tradeDate,
        product,
        items,
        totalTurnover: items.reduce((s, i) => s + i.turnover, 0),
        totalFees: items.reduce((s, i) => s + i.fees, 0),
      }
    })
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.product.localeCompare(b.product))

  // ---- 7. Close clusters ----
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

  const closeClusters: GuoxinCloseCluster[] = Array.from(closeClusterMap.entries())
    .map(([clusterKey, subMap]) => {
      const sep = clusterKey.indexOf("\0")
      const settlementDate = clusterKey.slice(0, sep)
      const product = clusterKey.slice(sep + 1)
      const items: GuoxinCloseClusterItem[] = Array.from(subMap.values()).map((s) => ({
        instrument: s.instrument,
        bs: s.bs,
        lots: s.lots,
        realizedPl: s.realizedPl,
      }))
      return {
        settlementDate,
        product,
        totalLots: items.reduce((s, i) => s + i.lots, 0),
        totalRealizedPl: items.reduce((s, i) => s + i.realizedPl, 0),
        items,
      }
    })
    .sort(
      (a, b) =>
        a.settlementDate.localeCompare(b.settlementDate) || a.product.localeCompare(b.product),
    )

  // ---- 8. Unique products ----
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
