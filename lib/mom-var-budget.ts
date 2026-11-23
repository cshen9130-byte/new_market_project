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
