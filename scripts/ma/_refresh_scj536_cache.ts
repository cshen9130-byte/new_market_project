import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"

loadProjectEnvFiles()

async function main() {
  const { invalidateDetailNavCache, refreshDetailNavCacheForFund } = await import(
    "../../lib/server/fund-detail-nav-cache-pg.ts"
  )
  const deleted = await invalidateDetailNavCache(["SCJ536"])
  console.log("invalidated detail cache rows", deleted)

  const ok = await refreshDetailNavCacheForFund({
    beian_hao: "SCJ536",
    product_name: "金舆追风1号",
    short_name: "金舆追风1号",
  })
  console.log("detail cache refreshed", ok)

  const { rawQuery } = await import("../../lib/db.ts")
  const tip = await rawQuery(
    `SELECT cache_key, beian_hao, product_name,
            tip_nav_date::text AS tip_nav_date,
            tip_unit_nav::text AS tip_unit_nav
     FROM ops_private_fund_detail_nav_cache
     WHERE beian_hao = 'SCJ536' OR cache_key = 'SCJ536'
     LIMIT 5`,
  )
  console.log("detail tip", JSON.stringify(tip.rows, null, 2))

  const series = await rawQuery(
    `SELECT e.price_date, e.nav
     FROM ops_private_fund_detail_nav_cache c
     CROSS JOIN LATERAL jsonb_to_recordset(c.nav_series)
       AS e(price_date text, nav text)
     WHERE c.beian_hao = 'SCJ536' OR c.cache_key = 'SCJ536'
       AND e.price_date >= '2026-08-01'
     ORDER BY e.price_date DESC`,
  )
  console.log("aug series", JSON.stringify(series.rows, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
