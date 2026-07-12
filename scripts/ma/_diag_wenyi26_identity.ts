import pg from "pg"

const DB =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const p = new pg.Pool({ connectionString: DB })

  for (const tbl of [
    "private_fund_info_bfl",
    "private_fund_info_fd",
    "private_fund_info",
    "type6_ops_team_full",
  ]) {
    try {
      const r = await p.query(
        `SELECT * FROM ${tbl}
         WHERE product_name ILIKE '%文艺复兴26%' OR fund_name ILIKE '%文艺复兴26%'
            OR short_name ILIKE '%文艺复兴26%' OR beian_hao ILIKE '%26%'
         LIMIT 5`,
      )
      if (r.rows.length) console.log(tbl, r.rows)
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string }
      if (err.code !== "42P01") console.log(tbl, err.message)
    }
  }

  // Count rows that would be retagged
  const tag = await p.query(`
    SELECT COUNT(*)::int n FROM ops_email_nav_records
    WHERE fund_name ILIKE '%文艺复兴26%'
       OR subject ILIKE '%文艺复兴26%'`)
  console.log("文艺复兴26 nav rows:", tag.rows[0])

  await p.end()
}

main().catch(console.error)
