/**
 * Equity-path NAV compounding for 单账户 (cfmmc_daily_summary).
 * Same formula as /ma/api/account-risk/product-nav — do not use 平仓+浮动.
 */

export type AccountRiskEquityDay = {
  date: string
  equity: number
  pnl: number
  flow: number
}

type EquitySourceRow = {
  date: string
  client_equity: unknown
  daily_pnl: unknown
  deposit_wd: unknown
  balance_bf?: unknown
  balance_cf?: unknown
  realized_pl?: unknown
  commission?: unknown
}

export type AccountRiskNavPoint = {
  date: string
  nav: number
  cumCapital: number
  dailyReturn: number
  netFlow: number
  pnl: number
  cumPnl: number
}

export function asFiniteNumber(value: unknown): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Cash that changed 当日结存 but was not booked in 当日存取合计.
 *
 * Identity on these statements:
 *   当日结存 = 上日结存 + 当日存取合计 + 平仓盈亏 + 当日总权利金 − 当日手续费
 * 当日总权利金 is not stored, so premium and interest sit in the same residual
 * as an unbooked 银期 transfer. Market PnL does not: it is already in 平仓盈亏
 * or in the equity-versus-balance floating change. A residual that is both
 * large and a round 万元 / 十万元 / 百万元 figure is that transfer. The few
 * thousand yuan of premium beside it stays in the return. Smaller residuals
 * stay in the return entirely.
 */
export function unbookedCashTransfer(row: {
  balance_bf?: unknown
  balance_cf?: unknown
  deposit_wd?: unknown
  realized_pl?: unknown
  commission?: unknown
}): number {
  if (row.balance_bf == null || row.balance_cf == null || row.realized_pl == null) return 0
  const broughtForward = asFiniteNumber(row.balance_bf)
  const carriedForward = asFiniteNumber(row.balance_cf)
  const booked = asFiniteNumber(row.deposit_wd)
  const realized = asFiniteNumber(row.realized_pl)
  const fee = asFiniteNumber(row.commission)
  const residual = carriedForward - broughtForward - booked - realized + fee
  const base = Math.abs(broughtForward)
  const abs = Math.abs(residual)
  if (base < 1 || abs < 100_000 || abs / base < 0.08) return 0

  const nearestWan = Math.round(residual / 10_000) * 10_000
  if (nearestWan !== 0 && Math.abs(residual - nearestWan) <= 1_000) return nearestWan

  // 2026-10-16 荣熙如川: 600万入金, residual 5,997,203.69 (2,796 off the million).
  // ±1,000 on the 万元 grid left the whole deposit inside 复权净值 (+57%).
  for (const unit of [1_000_000, 100_000]) {
    const round = Math.round(residual / unit) * unit
    if (round === 0) continue
    const gap = Math.abs(residual - round)
    if (gap <= 5_000 && gap / Math.abs(round) <= 0.005) return round
  }
  return 0
}

export function aggregateEquityByDate(rows: EquitySourceRow[]): AccountRiskEquityDay[] {
  const dateMap = new Map<string, AccountRiskEquityDay>()
  for (const r of rows) {
    const date = String(r.date ?? "").slice(0, 10)
    if (!date) continue
    const equity = asFiniteNumber(r.client_equity)
    const pnl = asFiniteNumber(r.daily_pnl)
    const flow = asFiniteNumber(r.deposit_wd) + unbookedCashTransfer(r)
    const existing = dateMap.get(date)
    if (existing) {
      existing.equity += equity
      existing.pnl += pnl
      existing.flow += flow
    } else {
      dateMap.set(date, { date, equity, pnl, flow })
    }
  }
  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Same counted daily PnL as the NAV tooltip 当日盈亏.
 * First snapshot is the capital base (0). Do not use 平仓盈亏+浮动盈亏:
 * CFMMC 浮动盈亏 is a mark-to-open LEVEL, not a daily increment.
 */
export function countedEquityPathPnl(
  equity: number,
  prevEquity: number | null | undefined,
  flow: number,
): number {
  const prev = asFiniteNumber(prevEquity)
  if (prev > 0) return equity - prev - flow
  return 0
}

/** Compound unit NAV from 1.0. First snapshot is the capital base (0 return). */
export function compoundAccountRiskNav(days: AccountRiskEquityDay[]): AccountRiskNavPoint[] {
  let nav = 1.0
  let prevEquity = 0
  let cumPnl = 0
  return days.map((day) => {
    const netFlow = day.flow
    const economicPnl =
      prevEquity > 0 || day.equity !== 0 || netFlow !== 0
        ? day.equity - prevEquity - netFlow
        : day.pnl
    const dailyReturn = prevEquity > 0 ? economicPnl / prevEquity : 0
    nav = nav * (1 + dailyReturn)
    const countedPnl = countedEquityPathPnl(day.equity, prevEquity, netFlow)
    cumPnl += countedPnl
    prevEquity = day.equity
    return {
      date: day.date,
      nav: Math.round(nav * 1e6) / 1e6,
      cumCapital: Math.round(day.equity),
      dailyReturn: Math.round(dailyReturn * 1e6) / 1e6,
      netFlow: Math.round(netFlow),
      pnl: Math.round(countedPnl),
      cumPnl: Math.round(cumPnl),
    }
  })
}
