import { PROD_SECTOR, prodLabel } from "@/lib/ma/prod-sector"

export type VarProductInput = { prod: string; mv: number; sigma: number }

export type ConcentrationShare = { name: string; pct: number }

/**
 * Marginal variance contribution, same definition as the VaR sandbox pies:
 * |dv_i * Σ_j dv_j * corr_ij|, then each slice as a percent of the total.
 */
export function varConcentrationShares(
  products: readonly VarProductInput[],
  corrMatrix: readonly (readonly number[])[],
): { products: ConcentrationShare[]; sectors: ConcentrationShare[] } {
  const dv = products.map((product) => product.sigma * product.mv)
  const values = products.map((product, index) => {
    let covSum = 0
    for (let j = 0; j < dv.length; j += 1) covSum += dv[j] * (corrMatrix[index]?.[j] ?? 0)
    return { name: product.prod, value: Math.abs(dv[index] * covSum) }
  }).filter((item) => item.value > 0)
  const total = values.reduce((sum, item) => sum + item.value, 0)
  const pct = (value: number) => (total > 0 ? (value / total) * 100 : 0)
  const productShares = values
    .map((item) => ({ name: item.name, pct: pct(item.value) }))
    .sort((a, b) => b.pct - a.pct)
  const sectorValues = new Map<string, number>()
  for (const item of values) {
    const sector = PROD_SECTOR[item.name] ?? "其他"
    sectorValues.set(sector, (sectorValues.get(sector) ?? 0) + item.value)
  }
  const sectorShares = [...sectorValues.entries()]
    .map(([name, value]) => ({ name, pct: pct(value) }))
    .sort((a, b) => b.pct - a.pct)
  return { products: productShares, sectors: sectorShares }
}

export function momVarConcentrationMessage(input: {
  date: string
  products: readonly ConcentrationShare[]
  sectors: readonly ConcentrationShare[]
  productPct: number
  sectorPct: number
}): { title: string; body: string; href: string } | null {
  const hotProducts = input.products.filter((item) => item.pct > input.productPct)
  const hotSectors = input.sectors.filter((item) => item.pct > input.sectorPct)
  if (hotProducts.length === 0 && hotSectors.length === 0) return null
  const lines = [
    ...hotProducts.map((item) => `${prodLabel(item.name)} 的品种边际波动贡献 ${formatPct(item.pct)}%，超过你设置的 ${formatPct(input.productPct)}%。`),
    ...hotSectors.map((item) => `${item.name} 的板块边际波动贡献 ${formatPct(item.pct)}%，超过你设置的 ${formatPct(input.sectorPct)}%。`),
  ]
  return {
    title: `${input.date} 日间风控集中度`,
    body: lines.join(""),
    href: "/ma/dashboard/mom-analysis/risk-report?tab=intraday#section-intraday-sandbox",
  }
}

function formatPct(value: number): string {
  return (Math.round(value * 10) / 10).toString()
}
