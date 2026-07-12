import pg from "pg"

const DB =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const p = new pg.Pool({ connectionString: DB })

  const cols = await p.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'user_custom_pool' ORDER BY ordinal_position`)
  console.log("pool columns:", cols.rows)

  const constraints = await p.query(`
    SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
    WHERE conrelid = 'user_custom_pool'::regclass`)
  console.log("constraints:", constraints.rows)

  const cache = await p.query(`
    SELECT beian_hao, product_name, nav_date::text, unit_nav::text, ret_1m::text, ret_1y::text
    FROM ops_tracking_funds_list_cache
    WHERE beian_hao = 'SQQ300' OR product_name ILIKE '%文艺复兴26%' OR product_name ILIKE '%多资产轮动策略3%'`)

  console.log("cache:", cache.rows)

  // Check if 文艺复兴26 and 3号 overlap dates
  const overlap = await p.query(`
    SELECT nav_date::text, COUNT(DISTINCT fund_name) names, array_agg(DISTINCT fund_name) funds
    FROM ops_email_nav_records WHERE product_code = 'SQQ300'
    GROUP BY nav_date HAVING COUNT(DISTINCT fund_name) > 1 ORDER BY nav_date`)
  console.log("overlap dates:", overlap.rows)

  await p.end()
}

main().catch(console.error)
