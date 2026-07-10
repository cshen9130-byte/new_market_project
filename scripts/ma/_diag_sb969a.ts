import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { loadEmailNavSeries } from "../../lib/server/email-nav-query"
import { loadEmailPoolFunds } from "../../lib/server/team-data-query-pg"

loadProjectEnvFiles()

const cases = [
  { code: "SB969A", name: "铸锋太阿3号A类", kw: "铸锋太阿" },
  { code: "SB969", name: "铸锋太阿3号", kw: "铸锋太阿" },
  { code: "", name: "荣熙大同3号A类", kw: "荣熙大同" },
]

async function main() {
  for (const c of cases) {
    const nav = await query(
      `SELECT nav_date::text, nav::text, product_code, fund_name, source, left(subject,120) AS subj
       FROM ops_email_nav_records
       WHERE subject ILIKE $1 OR fund_name ILIKE $1 OR product_code = $2
       ORDER BY nav_date DESC LIMIT 8`,
      [`%${c.kw}%`, c.code || "___none___"],
    )
    console.log(`\n=== ${c.name} (${c.code || "?"}) email nav:`, nav.length ? nav : "none")

    const pool = await query(
      `SELECT register_number, product_name FROM user_custom_pool
       WHERE pool_key = 'custom_email_nav' AND (product_name ILIKE $1 OR register_number = $2)`,
      [`%${c.kw}%`, c.code || "___none___"],
    )
    console.log("pool:", pool)

    const cache = await query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
       FROM ops_tracking_funds_list_cache WHERE product_name ILIKE $1 OR beian_hao = $2`,
      [`%${c.kw}%`, c.code || "___none___"],
    )
    console.log("cache:", cache)
  }

  const poolFunds = await loadEmailPoolFunds()
  const hits = poolFunds.filter((f) => f.product_name.includes("铸锋") || f.product_name.includes("荣熙大同"))
  console.log("\nloadEmailPoolFunds hits:", hits)
}

main().catch(console.error)
