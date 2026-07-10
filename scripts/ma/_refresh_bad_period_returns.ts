/**
 * Refresh tracking cache rows whose |ret_1m| exceeds plausible max drawdown.
 * Usage (SSH tunnel):
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_refresh_bad_period_returns.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import {
  BatchNavResolver,
  NAV_HISTORY_LOOKBACK_DAYS,
  addDays,
  enrichReturnNavSeries,
} from "../../lib/server/list-cache-nav-batch"
import { computeFundNavMetrics } from "../../lib/fund-nav-metrics"

loadProjectEnvFiles()

function navForReturn(p: { nav: number; return_nav?: number }): number {
  return p.return_nav ?? p.nav
}

async function main() {
  const rows = await query<{
    beian_hao: string
    product_name: string
    nav_date: string
    ret_1m: string | null
  }>(
    `SELECT beian_hao, product_name, nav_date::text, ret_1m::text
     FROM ops_tracking_funds_list_cache
     WHERE nav_date IS NOT NULL AND ret_1m IS NOT NULL
       AND ABS(ret_1m) > 0.12
     ORDER BY ABS(ret_1m) DESC`,
  )
  console.log(`Checking ${rows.length} rows with |ret_1m| > 12%`)

  const toFix: string[] = []
  const batchSize = 40
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const identities = chunk.map((r) => ({
      beian_hao: r.beian_hao,
      product_name: r.product_name,
      short_name: null,
    }))
    const asOf = chunk[0].nav_date.slice(0, 10)
    const resolver = await BatchNavResolver.create(identities, asOf)
    for (const row of chunk) {
      const identity = {
        beian_hao: row.beian_hao,
        product_name: row.product_name,
        short_name: null,
      }
      const history = enrichReturnNavSeries(
        resolver.mergedHistoryForRiskMetrics(
          identity,
          addDays(row.nav_date, NAV_HISTORY_LOOKBACK_DAYS),
        ),
      )
      const values = history.map(navForReturn).filter((v) => v > 0)
      if (values.length < 5) {
        toFix.push(row.beian_hao)
        continue
      }
      const metrics = computeFundNavMetrics({
        dates: history.map((p) => p.nav_date),
        values,
      })
      const maxDd = metrics?.maxDD ?? null
      const ret1m = parseFloat(row.ret_1m!)
      if (maxDd == null || Math.abs(ret1m) > Math.abs(maxDd) + 0.02) {
        toFix.push(row.beian_hao)
      }
    }
    console.log(`scanned ${Math.min(i + batchSize, rows.length)}/${rows.length}, fix queue ${toFix.length}`)
  }

  const unique = [...new Set(toFix)]
  console.log(`Refreshing ${unique.length} funds…`)
  for (let i = 0; i < unique.length; i++) {
    const beian = unique[i]
    const row = rows.find((r) => r.beian_hao === beian)!
    if ((i + 1) % 20 === 0 || i + 1 === unique.length) {
      console.log(`  [${i + 1}/${unique.length}] ${beian}`)
    }
    await upsertTrackingFundListCacheEntry(beian, row.product_name)
  }

  const sample = await query(
    `SELECT beian_hao, unit_nav::text, nav_date::text, ret_1m::text, ret_3m::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao = ANY($1::text[])
     ORDER BY beian_hao`,
    [["ASX73A", ...unique.slice(0, 10)]],
  )
  console.log("\nSample after:", sample)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
