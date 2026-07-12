import pg from "pg"

const DB =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const p = new pg.Pool({ connectionString: DB })

  const pool = await p.query(`
    SELECT register_number, product_name, source_file FROM user_custom_pool
    WHERE pool_key = 'custom_email_nav'
      AND (register_number = 'SQQ300' OR product_name ILIKE '%文艺复兴26%' OR product_name ILIKE '%多资产轮动策略3%')
    ORDER BY register_number`)

  const navGroups = await p.query(`
    SELECT product_code, fund_name, COUNT(*)::int n, MIN(nav_date)::text d0, MAX(nav_date)::text d1
    FROM ops_email_nav_records
    WHERE product_code = 'SQQ300' OR fund_name ILIKE '%文艺复兴26%' OR fund_name ILIKE '%多资产轮动策略3%'
    GROUP BY 1,2 ORDER BY n DESC`)

  const bfl = await p.query(`
    SELECT beian_hao, product_name, short_name FROM private_fund_info_bfl
    WHERE beian_hao = 'SQQ300' OR product_name ILIKE '%文艺复兴26%' OR product_name ILIKE '%多资产轮动策略3%'`)

  const recent26 = await p.query(`
    SELECT nav_date::text, nav::text, product_code, fund_name, left(subject,100) subj
    FROM ops_email_nav_records
    WHERE fund_name ILIKE '%文艺复兴26%'
    ORDER BY nav_date DESC LIMIT 5`)

  const recentSqq = await p.query(`
    SELECT nav_date::text, nav::text, product_code, fund_name, left(subject,100) subj
    FROM ops_email_nav_records
    WHERE product_code = 'SQQ300'
    ORDER BY nav_date DESC LIMIT 8`)

  console.log("pool:", pool.rows)
  console.log("\nbfl:", bfl.rows)
  console.log("\nnav groups:", navGroups.rows)
  console.log("\nrecent 文艺复兴26:", recent26.rows)
  console.log("\nrecent SQQ300:", recentSqq.rows)

  const type6 = await p.query(`
    SELECT register_number, fund_short_name, fund_full_name
    FROM private_fund_type6_register
    WHERE fund_full_name ILIKE '%文艺复兴26%' OR fund_short_name ILIKE '%文艺复兴26%'
       OR register_number = 'SQQ300'`)

  const fd = await p.query(`
    SELECT beian_hao, product_name FROM private_fund_info_fd
    WHERE product_name ILIKE '%文艺复兴26%' OR beian_hao = 'SQQ300'`)

  const cache = await p.query(`
    SELECT beian_hao, product_name, nav_date::text, unit_nav::text, ret_1m::text
    FROM ops_tracking_funds_list_cache
    WHERE beian_hao IN ('SQQ300', '笃熙禀泰文艺复兴26号') OR product_name ILIKE '%文艺复兴26%' OR product_name ILIKE '%多资产轮动策略3%'`)

  console.log("\ntype6:", type6.rows)
  console.log("\nfd:", fd.rows)
  console.log("\ncache:", cache.rows)

  await p.end()
}

main().catch(console.error)
