export interface ManagerStockHoldingRow {
  cutoff_date: string
  stock_name: string
  stock_code: string
  shares_10k: number
  market_value_10k: number
  pct_float: number
  pct_total: number
  fund_count: number
  sample_fund_beian_hao: string | null
  sample_fund_name: string | null
}

export interface ManagerHoldingsSeed {
  latest_dynamics: ManagerStockHoldingRow[]
  quarterly_holdings: ManagerStockHoldingRow[]
}

const SEED_BY_REGISTRATION: Record<string, ManagerHoldingsSeed> = {
  P1017741: {
    latest_dynamics: [],
    quarterly_holdings: [
      {
        cutoff_date: "2024-09-30",
        stock_name: "合金投资",
        stock_code: "000633",
        shares_10k: 175.26,
        market_value_10k: 902.39,
        pct_float: 0.46,
        pct_total: 0.45,
        fund_count: 1,
        sample_fund_beian_hao: null,
        sample_fund_name: null,
      },
      {
        cutoff_date: "2024-06-30",
        stock_name: "合金投资",
        stock_code: "000633",
        shares_10k: 175.26,
        market_value_10k: 690.32,
        pct_float: 0.46,
        pct_total: 0.45,
        fund_count: 1,
        sample_fund_beian_hao: null,
        sample_fund_name: null,
      },
      {
        cutoff_date: "2024-03-31",
        stock_name: "合金投资",
        stock_code: "000633",
        shares_10k: 175.26,
        market_value_10k: 1014.76,
        pct_float: 0.46,
        pct_total: 0.45,
        fund_count: 1,
        sample_fund_beian_hao: null,
        sample_fund_name: null,
      },
    ],
  },
}

export function lookupManagerHoldingsSeed(registrationNo: string): ManagerHoldingsSeed | null {
  return SEED_BY_REGISTRATION[registrationNo.trim()] ?? null
}

export function quarterLabelFromDate(dateStr: string): string {
  const d = new Date(dateStr)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const q = Math.ceil(month / 3)
  return `${year}年${q}季度`
}

export function quarterEndDate(year: number, quarter: number): string {
  const month = quarter * 3
  const lastDay = new Date(year, month, 0)
  return lastDay.toISOString().slice(0, 10)
}

export function parseQuarterValue(value: string): { year: number; quarter: number } | null {
  const m = value.match(/^(\d{4})-Q([1-4])$/)
  if (!m) return null
  return { year: parseInt(m[1], 10), quarter: parseInt(m[2], 10) }
}

export function listQuarterOptions(rows: ManagerStockHoldingRow[]): string[] {
  const set = new Set<string>()
  for (const row of rows) {
    const d = new Date(row.cutoff_date)
    const year = d.getFullYear()
    const quarter = Math.ceil((d.getMonth() + 1) / 3)
    set.add(`${year}-Q${quarter}`)
  }
  return Array.from(set).sort()
}

export function filterHoldingsByQuarterRange(
  rows: ManagerStockHoldingRow[],
  startQuarter: string,
  endQuarter: string,
): ManagerStockHoldingRow[] {
  const start = parseQuarterValue(startQuarter)
  const end = parseQuarterValue(endQuarter)
  if (!start || !end) return rows

  const startDate = quarterEndDate(start.year, start.quarter)
  const endDate = quarterEndDate(end.year, end.quarter)
  const lo = startDate <= endDate ? startDate : endDate
  const hi = startDate <= endDate ? endDate : startDate

  return rows
    .filter((r) => r.cutoff_date >= lo && r.cutoff_date <= hi)
    .sort((a, b) => b.cutoff_date.localeCompare(a.cutoff_date))
}

export function aggregateHoldingsTrend(
  rows: ManagerStockHoldingRow[],
): { period: string; market_value_10k: number }[] {
  const byQuarter = new Map<string, number>()
  for (const row of rows) {
    const label = quarterLabelFromDate(row.cutoff_date)
    byQuarter.set(label, (byQuarter.get(label) ?? 0) + row.market_value_10k)
  }
  return Array.from(byQuarter.entries())
    .map(([period, market_value_10k]) => ({ period, market_value_10k }))
    .sort((a, b) => {
      const parse = (s: string) => {
        const m = s.match(/(\d{4})年(\d)季度/)
        return m ? parseInt(m[1], 10) * 10 + parseInt(m[2], 10) : 0
      }
      return parse(a.period) - parse(b.period)
    })
}
