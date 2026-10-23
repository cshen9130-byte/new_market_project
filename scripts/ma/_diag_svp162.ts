import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const rows = await query<any>(`
    SELECT 'fof99' s, price_date::text d, nav::text u, cumulative_nav::text a, cum_nav_withdrawal::text c
    FROM private_fund_nav WHERE beian_hao='SVP162' AND price_date BETWEEN '2026-01-20' AND '2026-02-20'
    UNION ALL
    SELECT 'type6', price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
    FROM private_fund_nav_group_type6 WHERE beian_hao='SVP162' AND price_date BETWEEN '2026-01-20' AND '2026-02-20'
    UNION ALL
    SELECT 'group', price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
    FROM private_fund_nav_group WHERE beian_hao='SVP162' AND price_date BETWEEN '2026-01-20' AND '2026-02-20'
    UNION ALL
    SELECT 'email', nav_date::text, nav::text, adjusted_nav::text, cumulative_nav::text
    FROM ops_email_nav_records WHERE product_code IN ('SVP162','VP162A','VP162B','VP162C') AND nav_date BETWEEN '2026-01-20' AND '2026-02-20'
    UNION ALL
    SELECT 'manual', nav_date::text, unit_nav::text, adjusted_nav::text, cumulative_nav::text
    FROM ops_team_nav_manual WHERE beian_hao='SVP162' AND nav_date BETWEEN '2026-01-20' AND '2026-02-20'
    ORDER BY d, s`)
  for (const r of rows) console.log(r.s, r.d, r.u, r.a, r.c)

  // share class family
  const fam = await query<any>(`SELECT beian_hao, product_name FROM private_fund_info WHERE product_name LIKE '%观理%' OR beian_hao LIKE '%VP162%' LIMIT 20`)
  console.log('family', fam)
}
main().catch(e=>{console.error(e);process.exit(1)})
