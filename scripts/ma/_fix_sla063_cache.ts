/**
 * Targeted cache fix for 杉阳云杉混合1号 (SLA063) after preferLegacyNavRow fix.
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const { BatchNavResolver, RETURN_OFFSETS, computeOneYearRiskMetrics, NAV_HISTORY_LOOKBACK_DAYS, addDays } =
    await import("@/lib/server/list-cache-nav-batch")

  const BEIAN = "SLA063"
  const info = await query<{ product_name: string; short_name: string | null }>(
    `SELECT product_name, NULL::text AS short_name FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
    [BEIAN],
  )
  const identity = {
    beian_hao: BEIAN,
    product_name: info[0]?.product_name ?? "杉阳云杉混合1号",
    short_name: info[0]?.short_name ?? null,
  }

  console.log("BEFORE tracking:", (await query(
    `SELECT unit_nav::text, nav_date::text, ret_6m::text, ret_1y::text, sharpe_1y::text, calmar_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [BEIAN],
  ))[0] ?? "(none)")

  console.log("BEFORE private_fund_info:", (await query(
    `SELECT latest_nav::text, latest_nav_date::text, ret_6m::text, ret_1y::text, sharpe_1y::text, calmar_1y::text
     FROM private_fund_info WHERE beian_hao = $1`,
    [BEIAN],
  ))[0] ?? "(none)")

  const asOf = "2026-05-29"
  const resolver = await BatchNavResolver.create([identity], asOf)
  const latest = resolver.resolveAt(identity, asOf)
  if (!latest) {
    console.error("No latest NAV")
    process.exit(1)
  }

  const returns = resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
  const returnPct = resolver.calcDailyReturnPct(identity, latest.nav, latest.nav_date, null)
  const risk = computeOneYearRiskMetrics(
    latest.nav_date,
    resolver.mergedHistoryForRiskMetrics(identity, addDays(latest.nav_date, NAV_HISTORY_LOOKBACK_DAYS)),
  )

  console.log("Computed:", { latest, returns, returnPct, risk })

  await query(
    `UPDATE private_fund_info
     SET ret_1w = $1,
         ret_1m = $2,
         ret_3m = $3,
         ret_6m = $4,
         ret_1y = $5,
         sharpe_1y = $6,
         calmar_1y = $7,
         latest_nav = $8,
         latest_nav_date = $9::date,
         updated_at = NOW()
     WHERE beian_hao = $10`,
    [
      returns.ret_1w != null ? Math.round(returns.ret_1w * 10000) / 100 : null,
      returns.ret_1m != null ? Math.round(returns.ret_1m * 10000) / 100 : null,
      returns.ret_3m != null ? Math.round(returns.ret_3m * 10000) / 100 : null,
      returns.ret_6m != null ? Math.round(returns.ret_6m * 10000) / 100 : null,
      returns.ret_1y != null ? Math.round(returns.ret_1y * 10000) / 100 : null,
      risk.sharpe_1y,
      risk.calmar_1y,
      latest.nav,
      latest.nav_date,
      BEIAN,
    ],
  )

  await query(
    `UPDATE ops_tracking_funds_list_cache
     SET unit_nav   = $1,
         nav_date   = $2,
         return_pct = $3,
         ret_1w     = $4,
         ret_1m     = $5,
         ret_3m     = $6,
         ret_6m     = $7,
         ret_1y     = $8,
         sharpe_1y  = $9,
         calmar_1y  = $10,
         refreshed_at = NOW()
     WHERE beian_hao = $11`,
    [
      latest.nav,
      latest.nav_date,
      returnPct,
      returns.ret_1w,
      returns.ret_1m,
      returns.ret_3m,
      returns.ret_6m,
      returns.ret_1y,
      risk.sharpe_1y,
      risk.calmar_1y,
      BEIAN,
    ],
  )

  console.log("AFTER tracking:", (await query(
    `SELECT unit_nav::text, nav_date::text, ret_6m::text, ret_1y::text, sharpe_1y::text, calmar_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [BEIAN],
  ))[0] ?? "(none)")

  console.log("AFTER private_fund_info:", (await query(
    `SELECT latest_nav::text, latest_nav_date::text, ret_6m::text, ret_1y::text, sharpe_1y::text, calmar_1y::text
     FROM private_fund_info WHERE beian_hao = $1`,
    [BEIAN],
  ))[0] ?? "(none)")

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
