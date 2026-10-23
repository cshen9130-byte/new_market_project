/**
 * Rewrite the ZG868A detail cache from the platform series and rewind list
 * tips that still point at the later 虚拟净值 (2.1538 on 2026-10-20).
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()
process.env.DATABASE_URL =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const BEIAN = "ZG868A"
const PRODUCT = "博衍留芳1号A类"

function pct(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 100 * 10000) / 10000
}

async function main() {
  const { query, withTransaction } = await import("../../lib/db")
  const { loadMergedFundNavRows, resolveFundNames } = await import("../../lib/server/fund-nav-series")
  const {
    calcPeriodReturnsFromHistory,
    computeOneYearRiskMetrics,
    NAV_HISTORY_LOOKBACK_DAYS,
    addDays,
  } = await import("../../lib/server/list-cache-nav-batch")
  const { isPlausibleRiskRatio } = await import("../../lib/fund-nav-metrics")

  const names = await resolveFundNames(BEIAN, PRODUCT)
  const productName = names.product_name || PRODUCT
  const series = await loadMergedFundNavRows(BEIAN, productName, names.short_name)
  const tip = series.at(-1)
  if (!tip || tip.price_date.slice(0, 10) !== "2026-09-22" || Math.abs(parseFloat(tip.nav) - 2.2335) > 0.00015) {
    throw new Error(`unexpected series tip ${tip?.price_date} ${tip?.nav} n=${series.length}`)
  }
  const bad = series.filter((row) => row.price_date.slice(0, 10) > "2026-09-22")
  if (bad.length > 0) throw new Error(`series still has ${bad.length} points after the platform tip`)

  const history = series.map((row) => {
    const nav = parseFloat(row.nav)
    const cum = parseFloat(row.cumulative_nav)
    return {
      nav,
      nav_date: row.price_date.slice(0, 10),
      return_nav: Number.isFinite(cum) && cum > 0 ? cum : undefined,
    }
  })
  const unit = parseFloat(tip.nav)
  const navDate = tip.price_date.slice(0, 10)
  const returns = calcPeriodReturnsFromHistory(history, unit, navDate)
  const risk = computeOneYearRiskMetrics(
    navDate,
    history.filter((p) => p.nav_date >= addDays(navDate, NAV_HISTORY_LOOKBACK_DAYS)),
  )
  const prev = series.at(-2)
  const returnPct = prev && parseFloat(prev.nav) > 0 ? unit / parseFloat(prev.nav) - 1 : null
  const tipFields = {
    unit,
    navDate,
    returnPct: pct(returnPct),
    ret_1w: pct(returns.ret_1w),
    ret_1m: pct(returns.ret_1m),
    ret_3m: pct(returns.ret_3m),
    ret_6m: pct(returns.ret_6m),
    ret_1y: pct(returns.ret_1y),
    sharpe_1y: isPlausibleRiskRatio(risk.sharpe_1y) ? risk.sharpe_1y : null,
    calmar_1y: isPlausibleRiskRatio(risk.calmar_1y) ? risk.calmar_1y : null,
  }
  console.log("tip fields", tipFields, "n", series.length)

  await withTransaction(async (tx) => {
    await tx(
      `INSERT INTO ops_private_fund_detail_nav_cache (
         cache_key, beian_hao, product_name, short_name,
         nav_series, nav_data_source, tip_nav_date, tip_unit_nav, refreshed_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'team', $6::date, $7, NOW())
       ON CONFLICT (cache_key) DO UPDATE SET
         beian_hao = EXCLUDED.beian_hao,
         product_name = EXCLUDED.product_name,
         short_name = EXCLUDED.short_name,
         nav_series = EXCLUDED.nav_series,
         nav_data_source = EXCLUDED.nav_data_source,
         tip_nav_date = EXCLUDED.tip_nav_date,
         tip_unit_nav = EXCLUDED.tip_unit_nav,
         refreshed_at = NOW()`,
      [BEIAN, BEIAN, productName, names.short_name ?? null, JSON.stringify(series), navDate, unit],
    )
    const info = await tx(
      `UPDATE private_fund_info SET
         latest_nav = $2,
         latest_nav_date = $3::date,
         ret_1w = $4, ret_1m = $5, ret_3m = $6, ret_6m = $7, ret_1y = $8,
         sharpe_1y = COALESCE($9, sharpe_1y),
         calmar_1y = COALESCE($10, calmar_1y),
         updated_at = NOW()
       WHERE UPPER(BTRIM(beian_hao)) = $1
       RETURNING latest_nav_date::text, latest_nav::text`,
      [
        BEIAN, unit, navDate,
        tipFields.ret_1w, tipFields.ret_1m, tipFields.ret_3m, tipFields.ret_6m, tipFields.ret_1y,
        tipFields.sharpe_1y, tipFields.calmar_1y,
      ],
    )
    console.log("private_fund_info", info)
    for (const table of [
      "ops_tracking_funds_list_cache",
      "ops_fof_overview_list_cache",
      "ops_managed_products_list_cache",
    ]) {
      const updated = await tx(
        `UPDATE ${table} SET
           unit_nav = $2,
           nav_date = $3::date,
           return_pct = $4,
           ret_1w = $5, ret_1m = $6, ret_3m = $7, ret_6m = $8, ret_1y = $9,
           sharpe_1y = COALESCE($10, sharpe_1y),
           calmar_1y = COALESCE($11, calmar_1y),
           refreshed_at = NOW()
         WHERE UPPER(BTRIM(beian_hao)) = $1
         RETURNING beian_hao, nav_date::text, unit_nav::text`,
        [
          BEIAN, unit, navDate, tipFields.returnPct,
          tipFields.ret_1w, tipFields.ret_1m, tipFields.ret_3m, tipFields.ret_6m, tipFields.ret_1y,
          tipFields.sharpe_1y, tipFields.calmar_1y,
        ],
      )
      console.log(table, updated)
    }
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
