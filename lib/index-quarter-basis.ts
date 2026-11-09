/** Latest 近季 annualized basis on the realtime quotes charts. Strictly above this fires. */
export const INDEX_QUARTER_BASIS_LIMIT = -5

export const INDEX_QUARTER_BASIS_HREF = "/ma/dashboard/realtime-quotes?basis=quarter#section-basis-rate"

export type QuarterBasisReading = {
  product: string
  name: string
  date: string
  value: number
}

/**
 * Any 上证50 / 沪深300 / 中证500 / 中证1000 近季 print on the newest date
 * that is strictly above -5%. One date, one bell.
 */
export function indexQuarterBasisMessage(readings: QuarterBasisReading[]): {
  title: string
  body: string
  href: string
  date: string
} | null {
  const latest = readings.reduce((max, row) => (row.date > max ? row.date : max), "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest)) return null
  const hits = readings.filter((row) => row.date === latest && row.value > INDEX_QUARTER_BASIS_LIMIT)
  if (hits.length === 0) return null
  const lines = hits.map((row) => `${row.name}（${row.product}）近季 ${formatBasis(row.value)}%。`)
  return {
    title: `${latest} 近季年化基差高于 ${INDEX_QUARTER_BASIS_LIMIT}%`,
    body: lines.join(""),
    href: INDEX_QUARTER_BASIS_HREF,
    date: latest,
  }
}

function formatBasis(value: number): string {
  const text = value.toFixed(2)
  return value > 0 ? `+${text}` : text
}
