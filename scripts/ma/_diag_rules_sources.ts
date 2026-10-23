import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const rows = await query<{ src: string; code: string; d: string; unit: string | null; adj: string | null; cum: string | null }>(
    `SELECT src, code, d, unit, adj, cum FROM (
       SELECT 'fof99' AS src, beian_hao AS code, price_date::text AS d, nav::text AS unit,
              cumulative_nav::text AS adj, cum_nav_withdrawal::text AS cum
       FROM private_fund_nav
       WHERE beian_hao IN ('SVP162','SLC571','LC571B') AND price_date BETWEEN '2025-06-16' AND '2025-06-30'
       UNION ALL
       SELECT 'type6', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
       FROM private_fund_nav_group_type6
       WHERE beian_hao IN ('SVP162','SLC571','LC571B') AND price_date BETWEEN '2025-06-16' AND '2025-06-30'
       UNION ALL
       SELECT 'email', product_code, nav_date::text, nav::text, adjusted_nav::text, cumulative_nav::text
       FROM ops_email_nav_records
       WHERE product_code IN ('SVP162','SLC571','LC571B','VP162A','VP162B','VP162C')
         AND nav_date BETWEEN '2026-02-02' AND '2026-02-13'
       UNION ALL
       SELECT 'fof99b', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
       FROM private_fund_nav
       WHERE beian_hao = 'SVP162' AND price_date BETWEEN '2026-02-02' AND '2026-02-13'
     ) t ORDER BY src, code, d`,
  )
  for (const row of rows) console.log(row.src, row.code, row.d, row.unit, row.adj, row.cum)
  console.log("count", rows.length)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
