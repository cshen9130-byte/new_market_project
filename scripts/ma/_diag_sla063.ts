/**
 * Diagnose 杉阳云杉混合1号 (SLA063) — merged NAV output vs raw platform DB.
 * Usage (with SSH tunnel):
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_diag_sla063.ts
 */
import { query } from "@/lib/db"
import {
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
  loadEmailNavSeries,
} from "@/lib/server/email-nav-query"

const BEIAN = process.env.BEIAN ?? "SLA063"

async function main() {
  const info = await query<{ product_name: string; short_name: string | null }>(
    `SELECT product_name, NULL::text AS short_name FROM private_fund_info WHERE beian_hao = $1
     UNION ALL
     SELECT product_name, short_name FROM private_fund_info_bfl WHERE beian_hao = $1
     LIMIT 1`,
    [BEIAN],
  )
  const productName = info[0]?.product_name ?? "杉阳云杉混合1号"
  const shortName = info[0]?.short_name ?? null
  console.log(`=== ${BEIAN} ${productName} ===\n`)

  const oct2022 = await query<{
    price_date: string
    nav: string
    cumulative_nav: string
    cum_nav_withdrawal: string
    tbl: string
  }>(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text, tbl
     FROM (
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 'type6' AS tbl, 0 AS pri
       FROM private_fund_nav_group_type6 WHERE beian_hao = $1 AND price_date BETWEEN '2022-09-01' AND '2022-11-30'
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 'group' AS tbl, 1 AS pri
       FROM private_fund_nav_group WHERE beian_hao = $1 AND price_date BETWEEN '2022-09-01' AND '2022-11-30'
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 'nav' AS tbl, 2 AS pri
       FROM private_fund_nav WHERE beian_hao = $1 AND price_date BETWEEN '2022-09-01' AND '2022-11-30'
     ) u ORDER BY price_date, pri`,
    [BEIAN],
  )

  console.log(`=== Raw platform DB around 2022-10 (${oct2022.length} rows) ===`)
  for (const r of oct2022) {
    console.log(`  ${r.price_date} [${r.tbl}]: unit=${r.nav}, adj=${r.cumulative_nav}, cum=${r.cum_nav_withdrawal}`)
  }

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, productName, shortName, {})
  const email = await loadEmailNavSeries(BEIAN, productName, shortName, [])
  const merged = mergeNavSeriesWithEmail(legacy, email)

  console.log(`\n=== Merged series (${merged.length} rows) around 2022-10 ===`)
  for (const r of merged.filter((x) => x.price_date >= "2022-09-01" && x.price_date <= "2022-11-30")) {
    console.log(`  ${r.price_date}: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}, pct=${r.price_change}`)
  }

  const latest = merged[merged.length - 1]
  console.log(`\n=== Latest merged ===`)
  console.log(latest)

  const adjs = merged.map((r) => parseFloat(r.cumulative_nav)).filter(Number.isFinite)
  let peak = adjs[0]
  let maxDd = 0
  for (const v of adjs) {
    if (v > peak) peak = v
    const dd = (v / peak - 1) * 100
    if (dd < maxDd) maxDd = dd
  }
  console.log(`\nMax drawdown (adj): ${maxDd.toFixed(2)}%`)

  const cache = await query<{ ret_6m: string; unit_nav: string; nav_date: string }>(
    `SELECT ret_6m::text, unit_nav::text, nav_date::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1 LIMIT 1`,
    [BEIAN],
  ).catch(() => [])
  console.log("\n=== tracking cache ===", cache[0] ?? "none")

  const pfi = await query<{ ret_6m: string }>(
    `SELECT ret_6m::text FROM private_fund_info WHERE beian_hao = $1`,
    [BEIAN],
  ).catch(() => [])
  console.log("=== private_fund_info ret_6m ===", pfi[0]?.ret_6m ?? "none")

  const nov2025 = await query<{ price_date: string; nav: string; cumulative_nav: string; cum_nav_withdrawal: string; src: string }>(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text, src FROM (
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 'group' AS src, 0 AS pri FROM private_fund_nav_group
       WHERE beian_hao = $1 AND price_date BETWEEN '2025-11-01' AND '2025-12-15'
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 'nav' AS src, 1 AS pri FROM private_fund_nav
       WHERE beian_hao = $1 AND price_date BETWEEN '2025-11-01' AND '2025-12-15'
     ) u ORDER BY price_date, pri`,
    [BEIAN],
  )
  console.log("\n=== Unit nav around 2025-11 (6m lookback window) ===")
  for (const r of nov2025) {
    console.log(`  ${r.price_date} [${r.src}]: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
