import pg from "pg"

const DB =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const NAMES = ["青岛立心", "泉州棕榈滩", "上海务扬"]

async function main() {
  const p = new pg.Pool({ connectionString: DB })
  for (const n of NAMES) {
    const pool = await p.query(
      `SELECT register_number, product_name, source_file
       FROM user_custom_pool
       WHERE pool_key = 'custom_email_nav' AND product_name ILIKE $1`,
      [`%${n}%`],
    )
    const cache = await p.query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, as_of_date::text
       FROM ops_tracking_funds_list_cache WHERE product_name ILIKE $1`,
      [`%${n}%`],
    )
    const nav = await p.query(
      `SELECT COUNT(*)::int AS n FROM ops_email_nav_records
       WHERE fund_name ILIKE $1 OR subject ILIKE $1`,
      [`%${n}%`],
    )
    const val = await p.query(
      `SELECT COUNT(*)::int AS n FROM ops_email_valuation_records
       WHERE fund_name ILIKE $1 OR subject ILIKE $1`,
      [`%${n}%`],
    )
    console.log(`\n=== ${n} ===`)
    console.log("user_custom_pool:", pool.rows)
    console.log("list_cache:", cache.rows)
    console.log("nav_records:", nav.rows[0]?.n, "valuation:", val.rows[0]?.n)
  }
  await p.end()
}

main().catch(console.error)
