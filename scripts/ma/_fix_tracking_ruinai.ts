/**
 * Refresh 锐耐稳健对冲11号 (SBDF95) + A类 (BDF95A) tracking cache rows.
 * Usage (SSH tunnel):
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_fix_tracking_ruinai.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()

const FUNDS = [
  { beian: "SBDF95", name: "锐耐稳健对冲11号私募证券投资基金" },
  { beian: "BDF95A", name: "锐耐稳健对冲11号A类" },
] as const

async function showCache(beian: string) {
  const rows = await query(
    `SELECT beian_hao, product_name, unit_nav::text, nav_date::text, return_pct::text,
            ret_1w::text, ret_1m::text, refreshed_at::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [beian],
  )
  return rows[0] ?? null
}

async function showSeries(beian: string, name: string) {
  const rows = await loadMergedFundNavRows(beian, name, "")
  return { len: rows.length, first: rows[0] ?? null, last: rows.at(-1) ?? null }
}

async function main() {
  for (const fund of FUNDS) {
    console.log(`\n=== ${fund.beian} ${fund.name} ===`)
    console.log("BEFORE cache:", await showCache(fund.beian))
    console.log("BEFORE series:", await showSeries(fund.beian, fund.name))

    await upsertTrackingFundListCacheEntry(fund.beian, fund.name)

    console.log("AFTER cache:", await showCache(fund.beian))
    console.log("AFTER series:", await showSeries(fund.beian, fund.name))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
