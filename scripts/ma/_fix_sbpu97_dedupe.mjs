/** Clean SBPU97 duplicate valuation NAV rows so only header-correct value remains per date. */
import pg from "pg"

const HEADER = {
  "2026-07-06": 1.067,
  "2026-07-07": 1.0642,
  "2026-07-08": 1.0651,
  "2026-07-09": 1.0645,
}

async function main() {
  const p = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://market_user:2026SmartDashboard!@127.0.0.1:5432/market_data",
  })

  for (const [date, nav] of Object.entries(HEADER)) {
    const del = await p.query(
      `DELETE FROM ops_email_nav_records
       WHERE product_code = 'SBPU97'
         AND source = 'attachment_valuation_table'
         AND nav_date = $1::date
         AND ABS(nav::numeric - $2::numeric) >= 0.00005
       RETURNING id, nav::text`,
      [date, nav],
    )
    console.log(date, "deleted wrong:", del.rows)
  }

  const after = await p.query(
    `SELECT nav_date::text, nav::text, COUNT(*)::int n
     FROM ops_email_nav_records
     WHERE product_code = 'SBPU97' AND nav_date >= '2026-07-01'
     GROUP BY 1,2 ORDER BY 1 DESC, 2`,
  )
  console.log("after:", after.rows)

  await p.query(
    `UPDATE ops_managed_products_list_cache cache
     SET unit_nav = 1.0645, nav_date = '2026-07-09'::date, beian_hao = 'SBPU97', refreshed_at = NOW()
     FROM managed_products m
     WHERE cache.managed_product_id = m.id AND m.product_name ILIKE '%海泰1号%'`,
  )
  await p.end()
}

main().catch(console.error)
