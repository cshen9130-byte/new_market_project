/**
 * Backfill normalized valuation holdings from existing JSONB records, then refresh latest snapshot.
 *
 * Usage:
 *   npx tsx scripts/ma/backfill_valuation_holdings.ts
 */

import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

async function main() {
  const {
    backfillValuationHoldingsFromRecords,
    refreshFundLatestValuationHoldings,
  } = await import("@/lib/server/email-valuation-holdings-pg")
  const { refreshEmailValuationMetricsLatest } = await import(
    "@/lib/server/email-valuation-metrics-pg"
  )
  const { backfillValuationMetricsFromRecords } = await import(
    "@/lib/server/email-valuation-metrics-backfill"
  )

  const metricsBackfill = await backfillValuationMetricsFromRecords()
  const backfill = await backfillValuationHoldingsFromRecords()
  const latestRefreshed = await refreshFundLatestValuationHoldings()
  const metrics = await refreshEmailValuationMetricsLatest()

  console.log(
    JSON.stringify({
      ok: true,
      ...metricsBackfill,
      ...backfill,
      latestRefreshed,
      ...metrics,
    }),
  )
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
