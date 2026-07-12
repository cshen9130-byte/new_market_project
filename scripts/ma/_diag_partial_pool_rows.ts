import pg from "pg"

const DB =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const NAMES = [
  "青钱基石1号B类",
  "铸锋太阿3号A类",
  "聚鸣积极成长2号",
  "笃熙禀泰文艺复兴26号",
  "格上安盈2号私募",
  "明汯中性6号1期",
]

async function main() {
  const p = new pg.Pool({ connectionString: DB })
  for (const n of NAMES) {
    const pool = await p.query(
      `SELECT register_number, product_name, source_file
       FROM user_custom_pool WHERE pool_key = 'custom_email_nav' AND product_name ILIKE $1`,
      [`%${n.replace(/[AB]类$/, "").slice(0, 8)}%`],
    )
    const cache = await p.query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text,
              return_pct::text, ret_1w::text, ret_1m::text, ret_1y::text, sharpe_1y::text
       FROM ops_tracking_funds_list_cache WHERE product_name ILIKE $1`,
      [`%${n.replace(/[AB]类$/, "").slice(0, 8)}%`],
    )
    const beian = cache.rows[0]?.beian_hao ?? pool.rows[0]?.register_number
    let navStats = { n: 0, min_date: null as string | null, max_date: null as string | null }
    if (beian) {
      const nav = await p.query(
        `SELECT COUNT(*)::int AS n, MIN(nav_date)::text AS min_date, MAX(nav_date)::text AS max_date
         FROM ops_email_nav_records
         WHERE product_code = $1 OR fund_name ILIKE $2`,
        [beian, `%${n.replace(/[AB]类$/, "").slice(0, 6)}%`],
      )
      navStats = nav.rows[0]
    }
    const legacy = beian
      ? await p.query(
          `SELECT COUNT(*)::int AS n FROM private_fund_nav_group WHERE beian_hao = $1`,
          [beian],
        )
      : { rows: [{ n: 0 }] }

    console.log(`\n=== ${n} ===`)
    console.log("pool:", pool.rows)
    console.log("cache:", cache.rows)
    console.log("email_nav_records:", navStats, "legacy_nav:", legacy.rows[0]?.n)
  }
  await p.end()
}

main().catch(console.error)
