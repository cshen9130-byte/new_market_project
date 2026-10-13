/**
 * Risk stats derived from one account's stored daily settlement rows.
 * Inputs are already in public.mom_daily_reports; nothing here writes.
 */

export type MomDailyPoint = {
  date: string
  equity: number
  margin: number
  pnlNet: number
  riskDegree: string | null
}

export type MomMarginUsageStats = {
  latest: number | null
  average: number | null
  p10: number | null
  p90: number | null
  max: number | null
}

export type MomVarStats = {
  method: "historical"
  horizon: "1d"
  observations: number
  min_observations: number
  /** 5th percentile of daily returns. Negative means a loss. */
  var_95_return: number | null
  /** Positive loss fraction at 95%, max(0, -var_95_return). */
  var_95_loss: number | null
  var_99_return: number | null
  var_99_loss: number | null
  /** Mean of returns at or below the 95% quantile (expected shortfall). */
  cvar_95_return: number | null
  cvar_95_loss: number | null
  /** 5th percentile of daily net pnl, in currency. */
  var_95_pnl: number | null
  var_99_pnl: number | null
  note: string | null
}

export type MomAccountMetrics = {
  trading_days: number
  total_pnl_net: number
  win_days: number
  loss_days: number
  flat_days: number
  win_rate: number | null
  profit_factor: number | null
  avg_daily_pnl_net: number | null
  annualized_vol: number | null
  sharpe: number | null
  max_drawdown: number | null
  margin_usage: MomMarginUsageStats
  var: MomVarStats
}

const MIN_VAR_OBS = 20

function mean(xs: number[]): number {
  return xs.reduce((sum, value) => sum + value, 0) / xs.length
}

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((sum, value) => sum + (value - m) ** 2, 0) / (xs.length - 1))
}

/** Linear interpolation percentile. `p` is 0–1. `xs` need not be sorted. */
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)
}

function lossOf(quantile: number | null): number | null {
  if (quantile == null) return null
  return Math.max(0, -quantile)
}

export function marginUsage(margin: number, equity: number): number | null {
  if (!(equity > 0)) return null
  return margin / equity
}

export function computeMomAccountMetrics(points: MomDailyPoint[]): MomAccountMetrics {
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const pnls = ordered.map((row) => row.pnlNet)
  const total = pnls.reduce((sum, value) => sum + value, 0)
  const winDays = pnls.filter((value) => value > 0).length
  const lossDays = pnls.filter((value) => value < 0).length
  const flatDays = pnls.length - winDays - lossDays
  const winSum = pnls.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
  const lossSum = Math.abs(pnls.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))

  const returns: number[] = []
  for (let i = 1; i < ordered.length; i++) {
    const prevEquity = ordered[i - 1].equity
    if (prevEquity > 0) returns.push(ordered[i].pnlNet / prevEquity)
  }

  const usages = ordered
    .map((row) => marginUsage(row.margin, row.equity))
    .filter((value): value is number => value != null)

  let peak = 0
  let maxDrawdown = 0
  let sawEquity = false
  for (const row of ordered) {
    if (!(row.equity > 0)) continue
    sawEquity = true
    if (row.equity > peak) peak = row.equity
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - row.equity) / peak)
  }

  const vol = returns.length >= 2 ? sampleStd(returns) * Math.sqrt(252) : null
  const sharpe = returns.length >= 2 && sampleStd(returns) > 0
    ? (mean(returns) / sampleStd(returns)) * Math.sqrt(252)
    : null

  const varReady = returns.length >= MIN_VAR_OBS
  const var95 = varReady ? percentile(returns, 0.05) : null
  const var99 = varReady ? percentile(returns, 0.01) : null
  const varTail = var95 == null ? [] : returns.filter((value) => value <= var95 + 1e-9)
  const cvar95 = varTail.length > 0 ? mean(varTail) : null

  return {
    trading_days: ordered.length,
    total_pnl_net: total,
    win_days: winDays,
    loss_days: lossDays,
    flat_days: flatDays,
    win_rate: ordered.length > 0 ? winDays / ordered.length : null,
    profit_factor: lossSum > 0 ? winSum / lossSum : null,
    avg_daily_pnl_net: ordered.length > 0 ? total / ordered.length : null,
    annualized_vol: vol,
    sharpe,
    max_drawdown: sawEquity ? maxDrawdown : null,
    margin_usage: {
      latest: usages.length > 0 ? usages[usages.length - 1] : null,
      average: usages.length > 0 ? mean(usages) : null,
      p10: percentile(usages, 0.1),
      p90: percentile(usages, 0.9),
      max: usages.length > 0 ? Math.max(...usages) : null,
    },
    var: {
      method: "historical",
      horizon: "1d",
      observations: returns.length,
      min_observations: MIN_VAR_OBS,
      var_95_return: var95,
      var_95_loss: lossOf(var95),
      var_99_return: var99,
      var_99_loss: lossOf(var99),
      cvar_95_return: cvar95,
      cvar_95_loss: lossOf(cvar95),
      var_95_pnl: varReady ? percentile(pnls, 0.05) : null,
      var_99_pnl: varReady ? percentile(pnls, 0.01) : null,
      note: varReady ? null : `历史 VaR 至少需要 ${MIN_VAR_OBS} 个日收益率，当前 ${returns.length} 个`,
    },
  }
}
