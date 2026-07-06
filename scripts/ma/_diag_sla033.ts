/**
 * Diagnose nav data for 杉阳云杉混合1号 (SLA033).
 * Usage: npx tsx scripts/ma/_diag_sla033.ts
 */
import { query } from "@/lib/db"
import { loadEmailNavSeries } from "@/lib/server/email-nav-query"

const BEIAN = "SLA033"

async function main() {
  const pfiRows = await query<{ product_name: string; beian_hao: string }>(
    `SELECT product_name, beian_hao FROM private_fund_info WHERE beian_hao = $1 OR product_name LIKE '%云杉混合%' LIMIT 10`,
    [BEIAN]
  ).catch(() => [] as { product_name: string; beian_hao: string }[])

  const bflRows = await query<{ product_name: string; beian_hao: string }>(
    `SELECT product_name, beian_hao FROM private_fund_info_bfl WHERE beian_hao = $1 OR product_name LIKE '%云杉混合%' LIMIT 10`,
    [BEIAN]
  ).catch(() => [] as { product_name: string; beian_hao: string }[])

  console.log("=== Fund lookup ===")
  console.log("pfi:", JSON.stringify(pfiRows))
  console.log("bfl:", JSON.stringify(bflRows))

  const beian = BEIAN
  const productName = pfiRows[0]?.product_name ?? bflRows[0]?.product_name ?? "杉阳云杉混合1号"
  console.log(`\nUsing: beian=${beian}, name=${productName}`)

  const emailRows = await query<{
    id: string
    nav_date: string
    nav: string
    cumulative_nav: string | null
    adjusted_nav: string | null
    fund_name: string | null
    product_code: string | null
    source: string | null
    subject: string | null
  }>(
    `SELECT id::text, nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            fund_name, product_code, source, subject
     FROM ops_email_nav_records
     WHERE product_code = $1
        OR fund_name LIKE $2
        OR fund_name LIKE $3
     ORDER BY nav_date DESC, id DESC
     LIMIT 30`,
    [beian, `%云杉混合%`, `%杉阳%`]
  ).catch(() => [] as { id: string; nav_date: string; nav: string; cumulative_nav: string | null; adjusted_nav: string | null; fund_name: string | null; product_code: string | null; source: string | null; subject: string | null }[])

  console.log(`\n=== Email nav records (${emailRows.length} rows, newest first) ===`)
  for (const r of emailRows) {
    console.log(`  ${r.nav_date}: nav=${r.nav}, cum=${r.cumulative_nav ?? "null"}, adj=${r.adjusted_nav ?? "null"} [${r.source}] code=${r.product_code}`)
  }

  const oct2022 = await query<{
    price_date: string
    nav: string
    cumulative_nav: string
    cum_nav_withdrawal: string
    price_change: string
    tbl: string
  }>(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text, price_change::text, tbl
     FROM (
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 'type6' AS tbl, 0 AS pri FROM private_fund_nav_group_type6 WHERE beian_hao = $1 AND price_date BETWEEN '2022-09-01' AND '2022-11-30'
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 'group' AS tbl, 1 AS pri FROM private_fund_nav_group WHERE beian_hao = $1 AND price_date BETWEEN '2022-09-01' AND '2022-11-30'
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 'nav' AS tbl, 2 AS pri FROM private_fund_nav WHERE beian_hao = $1 AND price_date BETWEEN '2022-09-01' AND '2022-11-30'
     ) u
     ORDER BY price_date, pri ASC`,
    [beian]
  ).catch(() => [] as { price_date: string; nav: string; cumulative_nav: string; cum_nav_withdrawal: string; price_change: string; tbl: string }[])

  console.log(`\n=== Platform nav around 2022-10 (${oct2022.length} rows) ===`)
  for (const r of oct2022) {
    console.log(`  ${r.price_date} [${r.tbl}]: unit=${r.nav}, adj=${r.cumulative_nav}, cum=${r.cum_nav_withdrawal}, chg=${r.price_change}`)
  }

  const platformRows = await query<{
    price_date: string
    nav: string
    cumulative_nav: string
    cum_nav_withdrawal: string
    price_change: string
  }>(
    `SELECT DISTINCT ON (price_date)
        price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text, price_change::text
     FROM (
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 0 AS pri FROM private_fund_nav_group_type6 WHERE beian_hao = $1
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 1 AS pri FROM private_fund_nav_group WHERE beian_hao = $1
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 2 AS pri FROM private_fund_nav WHERE beian_hao = $1
     ) u
     ORDER BY price_date DESC, pri ASC
     LIMIT 10`,
    [beian]
  ).catch(() => [] as { price_date: string; nav: string; cumulative_nav: string; cum_nav_withdrawal: string; price_change: string }[])

  console.log(`\n=== Platform nav (last ${platformRows.length} rows) ===`)
  for (const r of platformRows) {
    console.log(`  ${r.price_date}: unit=${r.nav}, adj=${r.cumulative_nav}, cum=${r.cum_nav_withdrawal}, chg=${r.price_change}`)
  }

  const indicators = await query<{ ret_6m: string | null; ret_1y: string | null; latest_nav: string | null; latest_nav_date: string | null }>(
    `SELECT ret_6m::text, ret_1y::text, latest_nav::text, latest_nav_date::text
     FROM private_fund_indicators WHERE beian_hao = $1 LIMIT 1`,
    [beian]
  ).catch(() => [] as { ret_6m: string | null; ret_1y: string | null; latest_nav: string | null; latest_nav_date: string | null }[])

  console.log("\n=== private_fund_indicators ===")
  console.log(JSON.stringify(indicators[0] ?? null))

  const emailNavRows = await loadEmailNavSeries(beian, productName, null, []).catch(() => [])
  console.log(`\n=== loadEmailNavSeries (${emailNavRows.length} rows) ===`)
  const around2022 = emailNavRows.filter((r) => r.nav_date >= "2022-09-01" && r.nav_date <= "2022-11-30")
  console.log("Around 2022-10:")
  for (const r of around2022) {
    console.log(`  ${r.nav_date}: unit=${r.nav}, cum=${r.cumulative_nav ?? "null"}, adj=${r.adjusted_nav ?? "null"}`)
  }
  console.log("Latest 5:")
  for (const r of emailNavRows.slice(-5)) {
    console.log(`  ${r.nav_date}: unit=${r.nav}, cum=${r.cumulative_nav ?? "null"}, adj=${r.adjusted_nav ?? "null"}`)
  }
}

main().catch(console.error)
