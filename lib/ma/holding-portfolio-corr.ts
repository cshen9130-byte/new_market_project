/**
 * Correlation of each holding's P&L with the portfolio P&L.
 *
 * products[i] lines up with corr[i]. Dollar vol is sigma * signed market value,
 * the same weights the VaR sandbox uses. A long that moves with the book is
 * positive; a short in a name that moves with the book is negative. A one-name
 * book is 1. A flat book (no portfolio variance) is 0.
 */
export function holdingPortfolioCorrelations(
  products: { mv: number; sigma: number }[],
  corr: number[][],
): number[] {
  const n = products.length
  const dv = products.map((p) => p.sigma * p.mv)
  const mvc = new Array<number>(n).fill(0)
  let portVar = 0
  for (let i = 0; i < n; i++) {
    if (dv[i] === 0) continue
    let covSum = 0
    for (let j = 0; j < n; j++) covSum += dv[j] * (corr[i]?.[j] ?? 0)
    mvc[i] = dv[i] * covSum
    portVar += mvc[i]
  }
  const portSigma = portVar > 0 ? Math.sqrt(portVar) : 0
  return dv.map((d, i) => {
    if (d === 0 || portSigma === 0) return 0
    const value = mvc[i] / (Math.abs(d) * portSigma)
    if (!Number.isFinite(value)) return 0
    return Math.max(-1, Math.min(1, value))
  })
}
