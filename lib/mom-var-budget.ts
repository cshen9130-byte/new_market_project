/** Same normal 95% z as the VaR sandbox. */
export const VAR_BUDGET_Z95 = 1.6449
export const VAR_BUDGET_DAYS = 252

/**
 * A 20% annual risk budget, watched as a 1-day 95% VaR:
 * z_95 × annual% / √252.
 */
export function dailyVarBudgetPct(annualPct: number): number {
  return VAR_BUDGET_Z95 * annualPct / Math.sqrt(VAR_BUDGET_DAYS)
}

export function momVarBudgetMessage(input: {
  date: string
  varPct: number
  netCapital: number
  annualPct: number
}): { title: string; body: string; href: string } | null {
  const limit = dailyVarBudgetPct(input.annualPct)
  if (!(input.varPct > limit)) return null
  const capital = Math.round(input.netCapital).toLocaleString("zh-CN")
  return {
    title: `${input.date} 日间 VaR 超过风险预算`,
    body: `1 日 95% VaR 占累计净资本 ${input.varPct.toFixed(2)}%，超过 ${formatPct(input.annualPct)}% 年化风险预算对应的日度上限 ${limit.toFixed(2)}%。累计净资本 ${capital}。`,
    href: "/ma/dashboard/mom-analysis/risk-report?tab=intraday#section-intraday-sandbox",
  }
}

function formatPct(value: number): string {
  return (Math.round(value * 100) / 100).toString()
}
