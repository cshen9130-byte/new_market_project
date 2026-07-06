/**
 * Diagnose nav data for 六妙星九紫一号 (or any fund with SBPC20-like beian).
 * Usage: npx tsx scripts/ma/_diag_sbpc20.ts
 */
import { query } from "@/lib/db"
import { loadEmailNavSeries } from "@/lib/server/email-nav-query"

async function main() {
  // Step 1: find the fund's beian_hao
  const pfiRows = await query<{ product_name: string; beian_hao: string }>(
    `SELECT product_name, beian_hao FROM private_fund_info WHERE product_name LIKE '%六妙星九紫%' LIMIT 5`
  ).catch(() => [] as { product_name: string; beian_hao: string }[])

  const bflRows = await query<{ product_name: string; beian_hao: string }>(
    `SELECT product_name, beian_hao FROM private_fund_info_bfl WHERE product_name LIKE '%六妙星九紫%' LIMIT 5`
  ).catch(() => [] as { product_name: string; beian_hao: string }[])

  console.log("=== Fund lookup ===")
  console.log("pfi:", JSON.stringify(pfiRows))
  console.log("bfl:", JSON.stringify(bflRows))

  const beian = pfiRows[0]?.beian_hao ?? bflRows[0]?.beian_hao ?? "SBPC20"
  const productName = pfiRows[0]?.product_name ?? bflRows[0]?.product_name ?? "六妙星九紫一号"
  console.log(`\nUsing: beian=${beian}, name=${productName}`)

  // Step 2: check raw email records
  const emailRows = await query<{
    id: string
    nav_date: string
    nav: string
    cumulative_nav: string | null
    adjusted_nav: string | null
    fund_name: string | null
    product_code: string | null
    source: string | null
  }>(
    `SELECT id::text, nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            fund_name, product_code, source
     FROM ops_email_nav_records
     WHERE product_code = $1
        OR fund_name LIKE $2
     ORDER BY nav_date DESC, id DESC
     LIMIT 20`,
    [beian, `%六妙星九紫%`]
  ).catch(() => [] as { id: string; nav_date: string; nav: string; cumulative_nav: string | null; adjusted_nav: string | null; fund_name: string | null; product_code: string | null; source: string | null }[])

  console.log(`\n=== Email nav records (${emailRows.length} rows) ===`)
  for (const r of emailRows) {
    console.log(`  ${r.nav_date}: nav=${r.nav}, cum=${r.cumulative_nav ?? "null"}, adj=${r.adjusted_nav ?? "null"} [${r.source}] code=${r.product_code} name=${r.fund_name}`)
  }

  // Step 3: check platform DB nav series (last 10)
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
     LIMIT 15`,
    [beian]
  ).catch(() => [] as { price_date: string; nav: string; cumulative_nav: string; cum_nav_withdrawal: string; price_change: string }[])

  console.log(`\n=== Platform nav (last ${platformRows.length} rows, newest first) ===`)
  for (const r of platformRows) {
    console.log(`  ${r.price_date}: unit=${r.nav}, adj=${r.cumulative_nav}, cum=${r.cum_nav_withdrawal}, chg=${r.price_change}`)
  }

  // Step 4: check what the final merged series looks like
  const emailNavRows = await loadEmailNavSeries(beian, productName, null, []).catch(() => [])
  console.log(`\n=== Email nav series (${emailNavRows.length} rows) ===`)
  for (const r of emailNavRows.slice(-5)) {
    console.log(`  ${r.price_date}: nav=${r.nav}, cum=${r.cumulative_nav}, adj_nav=${r.adjusted_nav}`)
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
