/**
 * Repair stale 估值表分析 precomputed cache for managed products.
 *
 * The 在管产品 list reads ops_managed_products_list_cache (NAV dates).
 * The 估值表 page reads ops_valuation_precomputed_cache (snapshot).
 * When light ETL runs, list cache can advance while valuation cache lags.
 *
 * Usage:
 *   npx tsx scripts/ma/repair_valuation_precomputed_cache.ts [--managed-only] [--dry-run] [--refresh-metrics]
 */

import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import {
  invalidateValuationCache,
  upsertMetricsLatestForProductCodes,
} from "../../lib/server/valuation-cache-refresh"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

function subtractOneYear(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().slice(0, 10)
}

async function upsertManagedProductMetricsLatest(query: typeof import("../../lib/db").query): Promise<number> {
  const rows = await query<{ beian_hao: string }>(
    `SELECT beian_hao FROM ops_managed_products_list_cache WHERE beian_hao IS NOT NULL`,
  )
  return upsertMetricsLatestForProductCodes(rows.map((r) => r.beian_hao))
}

async function main() {
  const refreshMetrics = process.argv.includes("--refresh-metrics")
  const managedOnly = process.argv.includes("--managed-only")
  const dryRun = process.argv.includes("--dry-run")
  const { query } = await import("../../lib/db")
  const { refreshFundLatestValuationHoldings } = await import(
    "../../lib/server/email-valuation-holdings-pg"
  )
  const { ensureValuationCacheTable, writeValuationCache } = await import(
    "../../lib/server/valuation-precomputed-cache"
  )
  const { getFundValuationAllocation, getFundValuationTrendAnalysis } = await import(
    "../../lib/server/fund-valuation-allocation"
  )

  console.log("[repair] refresh holdings latest…")
  const holdingsRefreshed = await refreshFundLatestValuationHoldings()
  console.log("[repair] holdings latest rows:", holdingsRefreshed)

  if (managedOnly) {
    const n = await upsertManagedProductMetricsLatest(query)
    console.log("[repair] managed-product metrics upserted:", n)
  }

  if (refreshMetrics) {
    console.log("[repair] refresh metrics latest (slow)…")
    const { refreshEmailValuationMetricsLatest } = await import(
      "../../lib/server/email-valuation-metrics-pg"
    )
    const metrics = await refreshEmailValuationMetricsLatest()
    console.log("[repair] metrics latest:", metrics)
  }

  await ensureValuationCacheTable()

  const fundRows = await query<{
    beian_hao: string
    fund_name: string
    metrics_date: string
    cache_date: string | null
  }>(
    managedOnly
      ? `SELECT c.beian_hao,
                c.product_name AS fund_name,
                m.valuation_date::text AS metrics_date,
                (vc.data->>'valuation_date')::text AS cache_date
         FROM ops_managed_products_list_cache c
         INNER JOIN ops_email_valuation_fund_metrics_latest m
           ON m.product_code = c.beian_hao OR m.fund_name = c.product_name
         LEFT JOIN ops_valuation_precomputed_cache vc
           ON vc.beian_hao = c.beian_hao AND vc.cache_key = 'snapshot'
         WHERE c.beian_hao IS NOT NULL
         ORDER BY c.product_name`
      : `SELECT
           COALESCE(mp.beian_hao, m.product_code) AS beian_hao,
           m.fund_name,
           m.valuation_date::text AS metrics_date,
           (c.data->>'valuation_date')::text AS cache_date
         FROM ops_email_valuation_fund_metrics_latest m
         LEFT JOIN managed_products mp
           ON (m.product_code IS NOT NULL AND mp.beian_hao = m.product_code)
           OR mp.product_name = m.fund_name
         LEFT JOIN ops_valuation_precomputed_cache c
           ON c.beian_hao = COALESCE(mp.beian_hao, m.product_code) AND c.cache_key = 'snapshot'
         WHERE COALESCE(mp.beian_hao, m.product_code) IS NOT NULL
         ORDER BY beian_hao`,
  )

  const stale = fundRows.filter((r) => {
    const cacheDay = r.cache_date?.slice(0, 10) ?? ""
    const metricsDay = r.metrics_date?.slice(0, 10) ?? ""
    return !cacheDay || cacheDay < metricsDay
  })

  console.log(`[repair] ${stale.length}/${fundRows.length} fund(s) with stale/missing valuation cache`)
  if (stale.length > 0) {
    console.table(
      stale.slice(0, 20).map((r) => ({
        beian_hao: r.beian_hao,
        fund_name: r.fund_name,
        metrics_date: r.metrics_date?.slice(0, 10),
        cache_date: r.cache_date?.slice(0, 10) ?? "(missing)",
      })),
    )
  }

  if (dryRun) {
    console.log("[repair] dry-run — no cache rebuild")
    return
  }

  let ok = 0
  let failed = 0
  for (const fund of stale) {
    const beian = fund.beian_hao
    const toDate = fund.metrics_date.slice(0, 10)
    const fromDate = subtractOneYear(toDate)
    try {
      await invalidateValuationCache([beian])
      const snapshot = await getFundValuationAllocation(beian, "major")
      await writeValuationCache(beian, "snapshot", snapshot)
      try {
        const trend = await getFundValuationTrendAnalysis(beian, fromDate, toDate)
        await writeValuationCache(beian, "trend", trend, { fromDate, toDate })
      } catch {
        // trend is optional
      }
      try {
        const withCurves = await getFundValuationAllocation(beian, "major", {
          includeReturnCurves: true,
          curvesFrom: fromDate,
          curvesTo: toDate,
        })
        if (withCurves.layout_type === "fof" && withCurves.return_curves.length > 0) {
          await writeValuationCache(beian, "curves", withCurves.return_curves, { fromDate, toDate })
        }
      } catch {
        // curves optional
      }
      ok += 1
      console.log(`[repair] ✓ ${beian} ${fund.fund_name} → ${toDate}`)
    } catch (err) {
      failed += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[repair] ✗ ${beian}: ${msg}`)
    }
  }

  console.log(JSON.stringify({ ok, failed, stale: stale.length, total: fundRows.length }))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
