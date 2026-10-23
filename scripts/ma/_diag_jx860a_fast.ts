/** Print JX860A valuation-fallback and detail-series tails. */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const { query } = await import("../../lib/db")
  const { loadFundValuationNavFallbackSeries } = await import("../../lib/server/managed-fof-underlying-pg")
  const { loadDetailNavSeriesFast } = await import("../../lib/server/fund-detail-fast-path")
  const { fofUnderlyingNavLookupKeys } = await import("../../lib/server/fund-holding-code")

  console.log("keys", fofUnderlyingNavLookupKeys("交睿宏观配置1号A类", "JX860A"))

  const cache = await query(
    `SELECT nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache
     WHERE UPPER(BTRIM(register_number)) = 'JX860A'
        OR product_name LIKE '%交睿宏观配置1号A%'
     LIMIT 5`,
  ).catch((err: Error) => [{ error: err.message }])
  console.log("list cache", cache)

  const detail = await query(
    `SELECT tip_nav_date::text, tip_unit_nav::text, jsonb_array_length(nav_series) AS n
     FROM ops_private_fund_detail_nav_cache WHERE cache_key = 'JX860A'`,
  )
  console.log("detail cache", detail)

  const fallback = await loadFundValuationNavFallbackSeries(
    "JX860A",
    "交睿宏观配置1号A类",
    null,
    { sinceDate: "2026-06-01", extraBeianCodes: ["JX860A"] },
  )
  console.log("fallback n", fallback.length)
  for (const row of fallback.filter((r) => r.price_date >= "2026-06-01")) {
    console.log(`  fb ${row.price_date.slice(0, 10)} ${row.nav}`)
  }

  const series = await loadDetailNavSeriesFast({
    beian_hao: "JX860A",
    product_name: "交睿宏观配置1号A类",
    short_name: "",
  })
  const tail = series.filter((r) => r.price_date.slice(0, 10) >= "2026-07-01")
  console.log("detail series", series.length, "from July", tail.length)
  for (const row of tail) {
    console.log(`  ${row.price_date.slice(0, 10)} u=${row.nav} cum=${row.cum_nav_withdrawal ?? ""}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
