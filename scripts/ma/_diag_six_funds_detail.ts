import pg from "pg"

const DB =
  "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const p = new pg.Pool({ connectionString: DB })

  // 青钱基石 B-class: what codes exist in email nav?
  const q1 = await p.query(`
    SELECT product_code, fund_name, nav_date::text, nav::text, left(subject,80) AS subj
    FROM ops_email_nav_records
    WHERE fund_name ILIKE '%青钱基石%' OR product_code LIKE '%BDW42%' OR product_code LIKE '%SBDW42%'
    ORDER BY nav_date DESC, product_code LIMIT 20`)
  console.log("\n=== 青钱基石 email nav (recent) ===")
  console.log(q1.rows)

  // 铸锋: all SB969A rows
  const q2 = await p.query(`
    SELECT nav_date::text, nav::text, product_code, fund_name, left(subject,100) AS subj
    FROM ops_email_nav_records WHERE product_code = 'SB969A' OR fund_name ILIKE '%铸锋太阿%'
    ORDER BY nav_date`)
  console.log("\n=== 铸锋太阿 nav series ===")
  console.log(q2.rows)

  // 聚鸣
  const q3 = await p.query(`
    SELECT nav_date::text, nav::text, product_code, fund_name, left(subject,100) AS subj
    FROM ops_email_nav_records WHERE product_code = 'SY2965' OR fund_name ILIKE '%聚鸣积极%'
    ORDER BY nav_date`)
  console.log("\n=== 聚鸣积极 nav ===")
  console.log(q3.rows)

  // 文艺复兴26
  const q4 = await p.query(`
    SELECT product_code, fund_name, COUNT(*)::int n, MIN(nav_date)::text d0, MAX(nav_date)::text d1
    FROM ops_email_nav_records
    WHERE fund_name ILIKE '%文艺复兴26%' OR fund_name ILIKE '%文艺复兴%26%'
    GROUP BY 1,2 ORDER BY n DESC LIMIT 10`)
  console.log("\n=== 文艺复兴26 nav groups ===")
  console.log(q4.rows)

  const q4b = await p.query(`
    SELECT nav_date::text, nav::text, product_code, fund_name
    FROM ops_email_nav_records WHERE fund_name ILIKE '%文艺复兴26%'
    ORDER BY nav_date DESC LIMIT 5`)
  console.log("文艺复兴26 direct:", q4b.rows)

  // 格上安盈 / 明汯
  for (const code of ["ST9331", "SCQ804"]) {
    const nav = await p.query(
      `SELECT COUNT(*)::int n FROM ops_email_nav_records WHERE product_code = $1`,
      [code],
    )
    const email = await p.query(
      `SELECT subject, received_at::text FROM ops_email_parse_records
       WHERE subject ILIKE $1 OR extracted_fund_names::text ILIKE $1
       ORDER BY received_at DESC LIMIT 3`,
      [`%${code === "ST9331" ? "格上安盈" : "明汯中性6号"}%`],
    )
    console.log(`\n=== ${code} === nav:`, nav.rows[0], "emails:", email.rows)
  }

  await p.end()
}

main().catch(console.error)
