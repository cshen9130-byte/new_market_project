import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  // SLC571 mid week - who has 2025-06-23..26?
  const rows = await query<any>(`
    SELECT 'fof99' s, beian_hao c, price_date::text d, nav::text u, cumulative_nav::text a, cum_nav_withdrawal::text cum
    FROM private_fund_nav WHERE beian_hao IN ('SLC571','LC571B','LC571A') AND price_date BETWEEN '2025-06-18' AND '2025-07-02'
    UNION ALL
    SELECT 'type6', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
    FROM private_fund_nav_group_type6 WHERE beian_hao IN ('SLC571','LC571B','LC571A') AND price_date BETWEEN '2025-06-18' AND '2025-07-02'
    UNION ALL
    SELECT 'group', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
    FROM private_fund_nav_group WHERE beian_hao IN ('SLC571','LC571B','LC571A') AND price_date BETWEEN '2025-06-18' AND '2025-07-02'
    UNION ALL
    SELECT 'email', product_code, nav_date::text, nav::text, adjusted_nav::text, cumulative_nav::text
    FROM ops_email_nav_records WHERE product_code IN ('SLC571','LC571B','LC571A') AND nav_date BETWEEN '2025-06-18' AND '2025-07-02'
    UNION ALL
    SELECT 'manual', beian_hao, nav_date::text, unit_nav::text, adjusted_nav::text, cumulative_nav::text
    FROM ops_team_nav_manual WHERE beian_hao IN ('SLC571','LC571B','LC571A') AND nav_date BETWEEN '2025-06-18' AND '2025-07-02'
    ORDER BY d, c, s`)
  for (const r of rows) console.log(r.s, r.c, r.d, r.u, r.a, r.cum)

  // LC571B earlier window 2024-06
  const rows2 = await query<any>(`
    SELECT 'fof99' s, beian_hao c, price_date::text d, nav::text u, cumulative_nav::text a, cum_nav_withdrawal::text cum
    FROM private_fund_nav WHERE beian_hao IN ('SLC571','LC571B') AND price_date BETWEEN '2024-06-18' AND '2024-07-05'
    UNION ALL
    SELECT 'type6', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
    FROM private_fund_nav_group_type6 WHERE beian_hao IN ('SLC571','LC571B') AND price_date BETWEEN '2024-06-18' AND '2024-07-05'
    UNION ALL
    SELECT 'group', beian_hao, price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
    FROM private_fund_nav_group WHERE beian_hao IN ('SLC571','LC571B') AND price_date BETWEEN '2024-06-18' AND '2024-07-05'
    UNION ALL
    SELECT 'email', product_code, nav_date::text, nav::text, adjusted_nav::text, cumulative_nav::text
    FROM ops_email_nav_records WHERE product_code IN ('SLC571','LC571B') AND nav_date BETWEEN '2024-06-18' AND '2024-07-05'
    ORDER BY d, c, s`)
  console.log('\\n--- LC571B 2024-06 ---')
  for (const r of rows2) console.log(r.s, r.c, r.d, r.u, r.a, r.cum)
}
main().catch((e)=>{console.error(e);process.exit(1)})
