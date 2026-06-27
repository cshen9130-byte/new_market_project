/**
 * Load per-contract option Greeks from raw_options_contracts_daily (EmQuant nightly ETL).
 */

import { query } from "@/lib/db"

export type ContractGreeks = {
  delta: number
  gamma: number
  vega: number
  theta: number
  rho: number
}

type GreekRow = {
  contract: string
  delta: string | null
  gamma: string | null
  vega: string | null
  theta: string | null
  rho: string | null
  em_delta: string | null
  em_gamma: string | null
  em_vega: string | null
  em_theta: string | null
  em_rho: string | null
}

function pickNum(primary: string | null, fallback: string | null): number {
  for (const v of [primary, fallback]) {
    if (v == null || v === "") continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function rowToGreeks(row: GreekRow): ContractGreeks {
  return {
    delta: pickNum(row.delta, row.em_delta),
    gamma: pickNum(row.gamma, row.em_gamma),
    vega: pickNum(row.vega, row.em_vega),
    theta: pickNum(row.theta, row.em_theta),
    rho: pickNum(row.rho, row.em_rho),
  }
}

/** Latest Greeks on or before tradeDate for each contract. */
export async function loadOptionMarketGreeks(
  contracts: string[],
  tradeDate: string | null,
): Promise<Map<string, ContractGreeks>> {
  const unique = [...new Set(contracts.filter(Boolean))]
  const out = new Map<string, ContractGreeks>()
  if (unique.length === 0 || !tradeDate) return out

  const date = tradeDate.slice(0, 10)

  try {
    const rows = await query<GreekRow>(
      `SELECT DISTINCT ON (contract)
         contract,
         delta::text, gamma::text, vega::text, theta::text, rho::text,
         em_delta::text, em_gamma::text, em_vega::text, em_theta::text, em_rho::text
       FROM raw_options_contracts_daily
       WHERE contract = ANY($1::text[])
         AND trade_date <= $2::date
       ORDER BY contract, trade_date DESC`,
      [unique, date],
    )

    for (const row of rows) {
      out.set(row.contract, rowToGreeks(row))
    }
  } catch {
    // Table may not exist in some environments.
  }

  return out
}
