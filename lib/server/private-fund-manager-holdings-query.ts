import {
  aggregateHoldingsTrend,
  filterHoldingsByQuarterRange,
  listQuarterOptions,
  lookupManagerHoldingsSeed,
  type ManagerStockHoldingRow,
} from "@/lib/ma/manager-holdings-seed"
import { lookupManagerByRegistrationNo } from "@/lib/server/private-fund-manager-query"

export async function loadManagerHoldings(
  registrationNo: string,
  startQuarter?: string,
  endQuarter?: string,
) {
  const manager = await lookupManagerByRegistrationNo(registrationNo)
  if (!manager) return null

  const seed = lookupManagerHoldingsSeed(registrationNo)
  const latest_dynamics = seed?.latest_dynamics ?? []
  const allQuarterly = seed?.quarterly_holdings ?? []
  const quarter_options = listQuarterOptions(allQuarterly)

  const defaultStart = quarter_options[0] ?? ""
  const defaultEnd = quarter_options[quarter_options.length - 1] ?? ""
  const start = startQuarter && quarter_options.includes(startQuarter) ? startQuarter : defaultStart
  const end = endQuarter && quarter_options.includes(endQuarter) ? endQuarter : defaultEnd

  const quarterly_holdings = start && end
    ? filterHoldingsByQuarterRange(allQuarterly, start, end)
    : allQuarterly

  const trend = aggregateHoldingsTrend(quarterly_holdings)

  return {
    manager_name: manager.manager_name,
    latest_dynamics,
    quarterly_holdings,
    trend,
    quarter_options,
    start_quarter: start,
    end_quarter: end,
  }
}

export type ManagerHoldingsData = NonNullable<Awaited<ReturnType<typeof loadManagerHoldings>>>

export type { ManagerStockHoldingRow }
