import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"

loadProjectEnvFiles()

const CODE = process.argv[2] ?? "SBOW42"

async function main() {
  for (const code of [CODE, "SBDW42", "SBOW42"]) {
    const bfl = await query(
      `SELECT beian_hao, product_name, short_name FROM private_fund_info_bfl
       WHERE beian_hao = $1 OR product_name ILIKE '%青钱基石1号%'`,
      [code],
    )
    if (bfl.length) console.log("bfl", code, bfl)
  }

  const email = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name, source,
            attachment_filename, left(subject,100) AS subj
     FROM ops_email_nav_records
     WHERE product_code IN ('SBOW42','SBDW42') OR fund_name ILIKE '%青钱基石1号%'
     ORDER BY nav_date DESC, nav DESC, id DESC LIMIT 25`,
  )
  console.log("\nemail nav:", email)

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao IN ('SBOW42','SBDW42') OR product_name ILIKE '%青钱基石1号%'`,
  )
  console.log("\ncache:", cache)
}

main().catch(console.error)
