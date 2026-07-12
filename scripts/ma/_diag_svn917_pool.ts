import pg from "pg"

const DB =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const p = new pg.Pool({ connectionString: DB })
  const r = await p.query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav' AND (register_number = 'SVN917' OR product_name ILIKE '%天戈%')`,
  )
  console.log("SVN917 / 天戈:", r.rows)
  await p.end()
}

main().catch(console.error)
