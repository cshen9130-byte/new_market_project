import pg from "pg"

const DB =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const p = new pg.Pool({ connectionString: DB })

  for (const kw of ["金舆基石", "古曲祥辰5", "SXN097", "SAVW72"]) {
    console.log(`\n=== ${kw} ===`)
    for (const [label, sql, params] of [
      [
        "managed",
        `SELECT beian_hao, product_name, short_name FROM ops_managed_products
         WHERE product_name ILIKE $1 OR short_name ILIKE $1 OR beian_hao ILIKE $1
         LIMIT 10`,
        [`%${kw}%`],
      ],
      [
        "bfl",
        `SELECT beian_hao, product_name, short_name FROM private_fund_info_bfl
         WHERE product_name ILIKE $1 OR short_name ILIKE $1 OR beian_hao = $2
         LIMIT 10`,
        [`%${kw}%`, kw],
      ],
      [
        "pool",
        `SELECT register_number, product_name FROM user_custom_pool
         WHERE pool_key = 'custom_email_nav'
           AND (product_name ILIKE $1 OR register_number ILIKE $1)
         LIMIT 10`,
        [`%${kw}%`],
      ],
      [
        "email_nav",
        `SELECT product_code, fund_name, COUNT(*)::int n, MAX(nav_date)::text d
         FROM ops_email_nav_records
         WHERE fund_name ILIKE $1 OR product_code = $2 OR subject ILIKE $1
         GROUP BY 1,2 ORDER BY n DESC LIMIT 8`,
        [`%${kw}%`, kw],
      ],
    ] as const) {
      try {
        const r = await p.query(sql, params as string[])
        if (r.rows.length) console.log(label, r.rows)
      } catch (e: unknown) {
        console.log(label, (e as Error).message)
      }
    }
  }

  await p.end()
}

main().catch(console.error)
