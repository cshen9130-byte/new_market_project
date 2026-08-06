/**
 * Invalidate + rebuild detail NAV cache for one product.
 *
 * Usage:
 *   npx tsx scripts/ma/_refresh_cms_detail_cache.ts --code=SCU622 --name=金舆稳健增长1号FOF
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"

loadProjectEnvFiles()

const CODE = (
  process.argv.find((a) => a.startsWith("--code="))?.slice("--code=".length) || ""
).trim().toUpperCase()
const NAME = (
  process.argv.find((a) => a.startsWith("--name="))?.slice("--name=".length) || ""
).trim()

if (!CODE || !NAME) {
  console.error(
    "Usage: npx tsx scripts/ma/_refresh_cms_detail_cache.ts --code=SCU622 --name=金舆稳健增长1号FOF",
  )
  process.exit(1)
}

async function main() {
  const { invalidateDetailNavCache, refreshDetailNavCacheForFund } = await import(
    "../../lib/server/fund-detail-nav-cache-pg.ts"
  )
  const deleted = await invalidateDetailNavCache([CODE])
  console.log("invalidated", deleted)

  const ok = await refreshDetailNavCacheForFund({
    beian_hao: CODE,
    product_name: NAME,
    short_name: NAME,
  })
  console.log("refreshed", ok)

  const { rawQuery } = await import("../../lib/db.ts")
  const tip = await rawQuery(
    `SELECT cache_key, tip_nav_date::text AS tip_nav_date, tip_unit_nav::text AS tip_unit_nav
     FROM ops_private_fund_detail_nav_cache
     WHERE beian_hao = $1 OR cache_key = $1
     LIMIT 3`,
    [CODE],
  )
  console.log("tip", JSON.stringify(tip.rows, null, 2))

  const series = await rawQuery(
    `SELECT e.price_date, e.nav
     FROM ops_private_fund_detail_nav_cache c
     CROSS JOIN LATERAL jsonb_to_recordset(c.nav_series)
       AS e(price_date text, nav text)
     WHERE (c.beian_hao = $1 OR c.cache_key = $1)
       AND e.price_date >= '2026-08-01'
     ORDER BY e.price_date DESC`,
    [CODE],
  )
  console.log("aug series", JSON.stringify(series.rows, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
