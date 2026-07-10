/**
 * Remove 2026-07-09 A-only share-class row when B-class NAV missing (SBDW42 青钱基石1号).
 * Usage (SSH tunnel):
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_repair_sbdw42_jul9.ts --apply
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query, rawQuery } from "../../lib/db"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"
import { BatchNavResolver, clampPgNumeric, computeOneYearRiskMetrics } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

const BEIAN = "SBDW42"
const PRODUCT = "青钱基石1号"
const APPLY = process.argv.includes("--apply")

async function main() {
  const bad = await query<{ nav_date: string; nav: string }>(
    `SELECT nav_date::text, nav::text
     FROM ops_email_nav_records
     WHERE product_code = $1 AND nav_date = '2026-07-09' AND nav::numeric < 1.2`,
    [BEIAN],
  )
  console.log("rows to remove:", bad)

  if (APPLY && bad.length > 0) {
    const del = await rawQuery(
      `DELETE FROM ops_email_nav_records
       WHERE product_code = $1 AND nav_date = '2026-07-09' AND nav::numeric < 1.2`,
      [BEIAN],
    )
    console.log("deleted:", del.rowCount)
  }

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, `${PRODUCT}私募证券投资基金`, PRODUCT)
  const email = await loadEmailNavSeries(BEIAN, `${PRODUCT}私募证券投资基金`, PRODUCT)
  const merged = mergeNavSeriesWithEmail(legacy, email)
  console.log("\nmerged tail:")
  for (const r of merged.filter((x) => x.price_date >= "2026-07-05")) {
    console.log(r.price_date, r.nav, r.price_change?.slice(0, 10))
  }

  const latest = merged.at(-1)
  console.log("latest merged:", latest?.price_date, latest?.nav)

  if (APPLY && latest) {
    const identity = {
      beian_hao: BEIAN,
      product_name: `${PRODUCT}私募证券投资基金`,
      short_name: PRODUCT,
    }
    const unit = parseFloat(latest.nav)
    const resolver = await BatchNavResolver.create([identity], latest.price_date)
    const returns = resolver.calcPeriodReturns(identity, unit, latest.price_date)
    const returnPct = resolver.calcDailyReturnPct(identity, unit, latest.price_date, null)
    const risk = computeOneYearRiskMetrics(
      latest.price_date,
      resolver.mergedHistoryForRiskMetrics(identity, "2025-01-01"),
    )
    await rawQuery(
      `UPDATE ops_tracking_funds_list_cache
       SET unit_nav = $2, nav_date = $3::date, return_pct = $4,
           ret_1w = $5, ret_1m = $6, ret_3m = $7, ret_6m = $8, ret_1y = $9,
           sharpe_1y = $10, calmar_1y = $11, refreshed_at = NOW()
       WHERE beian_hao = $1`,
      [
        BEIAN,
        clampPgNumeric(unit, 16, 6),
        latest.price_date,
        clampPgNumeric(returnPct, 16, 8),
        clampPgNumeric(returns.ret_1w, 16, 8),
        clampPgNumeric(returns.ret_1m, 16, 8),
        clampPgNumeric(returns.ret_3m, 16, 8),
        clampPgNumeric(returns.ret_6m, 16, 8),
        clampPgNumeric(returns.ret_1y, 16, 8),
        clampPgNumeric(risk.sharpe_1y, 16, 6),
        clampPgNumeric(risk.calmar_1y, 16, 6),
      ],
    )
    const cache = await query(
      `SELECT unit_nav::text, nav_date::text, return_pct::text, ret_1w::text
       FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
      [BEIAN],
    )
    console.log("\ntracking cache:", cache[0])
    console.log("returns:", returns)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
