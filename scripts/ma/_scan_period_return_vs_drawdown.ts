/**
 * Find tracking-cache funds whose period returns exceed plausible max drawdown.
 * Usage: npx tsx scripts/ma/_scan_period_return_vs_drawdown.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../lib/db"
import {
  BatchNavResolver,
  NAV_HISTORY_LOOKBACK_DAYS,
  addDays,
  computeOneYearRiskMetrics,
} from "../lib/server/list-cache-nav-batch"
import { computeFundNavMetrics } from "../../lib/fund-nav-metrics"

loadProjectEnvFiles()

function navForReturn(p: { nav: number; return_nav?: number }): number {
  return p.return_nav ?? p.nav
}

async function main() {
  const rows = await query<{
    beian_hao: string
    product_name: string
    short_name: string | null
    nav_date: string
    ret_1m: string | null
    ret_3m: string | null
  }>(
    `SELECT beian_hao, product_name, short_name, nav_date::text,
            ret_1m::text, ret_3m::text
     FROM ops_tracking_funds_list_cache
     WHERE nav_date IS NOT NULL AND ret_1m IS NOT NULL
     ORDER BY ABS(ret_1m) DESC
     LIMIT 80`,
  )

  const identities = rows.map((r) => ({
    beian_hao: r.beian_hao,
    product_name: r.product_name,
    short_name: r.short_name,
  }))
  const asOf = rows[0]?.nav_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const resolver = await BatchNavResolver.create(identities, asOf)

  const bad: Array<Record<string, unknown>> = []
  for (const row of rows) {
    const identity = {
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      short_name: row.short_name,
    }
    const history = resolver.mergedHistoryForRiskMetrics(
      identity,
      addDays(row.nav_date, NAV_HISTORY_LOOKBACK_DAYS),
    )
    const values = history.map(navForReturn).filter((v) => v > 0)
    if (values.length < 5) continue
    const metrics = computeFundNavMetrics({
      dates: history.map((p) => p.nav_date),
      values,
    })
      const maxDd = metrics?.maxDD ?? null
    const ret1m = row.ret_1m != null ? parseFloat(row.ret_1m) : null
    if (maxDd == null || ret1m == null) continue
    if (Math.abs(ret1m) > Math.abs(maxDd) + 0.02) {
      const latest = resolver.resolveAt(identity, row.nav_date)
      const fresh = latest
        ? resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
        : null
      bad.push({
        beian: row.beian_hao,
        name: row.product_name.slice(0, 20),
        nav_date: row.nav_date,
        cache_ret_1m: (ret1m * 100).toFixed(2) + "%",
        max_dd: (maxDd * 100).toFixed(2) + "%",
        fresh_ret_1m: fresh?.ret_1m != null ? (fresh.ret_1m * 100).toFixed(2) + "%" : null,
      })
    }
  }
  console.log("Suspicious count:", bad.length)
  console.table(bad.slice(0, 30))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
