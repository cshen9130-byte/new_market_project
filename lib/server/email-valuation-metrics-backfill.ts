/**
 * Re-extract custody_balance / net_asset_value from stored holdings JSONB.
 */

import { query } from "@/lib/db"
import { enrichValuationMetrics } from "@/lib/server/email-valuation-metrics"
import type { ValuationAnalysis, ValuationRow } from "@/lib/server/valuation-analyzer"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"

export async function backfillValuationMetricsFromRecords(): Promise<{ recordsUpdated: number }> {
  await ensureEmailValuationTable()

  const records = await query<{
    id: string
    holdings: ValuationRow[]
    summary: ValuationAnalysis["summary"] | null
  }>(
    `SELECT id, holdings, summary FROM ops_email_valuation_records
     WHERE jsonb_array_length(holdings) > 0`,
  )

  let recordsUpdated = 0
  for (const record of records) {
    const holdings = Array.isArray(record.holdings) ? record.holdings : []
    const analysis: ValuationAnalysis = {
      portfolio_data: holdings,
      summary: record.summary ?? {
        fund_name: "",
        valuation_date: "",
        nav: 0,
        total_asset: 0,
        total_liability: 0,
      },
    }
    const { summary } = enrichValuationMetrics(analysis)
    await query(
      `UPDATE ops_email_valuation_records
       SET custody_balance = $2,
           net_asset_value = $3,
           total_asset = $4,
           total_liability = $5,
           summary = $6
       WHERE id = $1`,
      [
        parseInt(record.id, 10),
        summary.custody_balance > 0 ? summary.custody_balance : null,
        summary.net_asset_value > 0 ? summary.net_asset_value : null,
        summary.total_asset > 0 ? summary.total_asset : null,
        summary.total_liability > 0 ? summary.total_liability : null,
        JSON.stringify(summary),
      ],
    )
    recordsUpdated++
  }

  return { recordsUpdated }
}
