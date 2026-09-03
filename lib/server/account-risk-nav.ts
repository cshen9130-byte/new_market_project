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

export function aggregateEquityByDate(
  rows: Array<{
    date: string
    client_equity: unknown
    daily_pnl: unknown
    deposit_wd: unknown
  }>,
): AccountRiskEquityDay[] {
  const dateMap = new Map<string, AccountRiskEquityDay>()
  for (const r of rows) {
    const date = String(r.date ?? "").slice(0, 10)
    if (!date) continue
    const equity = asFiniteNumber(r.client_equity)
    const pnl = asFiniteNumber(r.daily_pnl)
    const flow = asFiniteNumber(r.deposit_wd)
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
    const countedPnl = prevEquity > 0 ? economicPnl : 0
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
