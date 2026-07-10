import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"

loadProjectEnvFiles()

async function main() {
  const nav = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name,
            source, left(subject,120) AS subj, attachment_filename, sent_at::text
     FROM ops_email_nav_records
     WHERE product_code ILIKE 'SAUV26' OR fund_name ILIKE '%邦客%' OR subject ILIKE '%SAUV26%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 20`,
  )
  console.log("ops_email_nav_records:", nav)

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = 'SAUV26'`,
  )
  console.log("\ncache:", cache)

  const parse = await query(
    `SELECT left(subject,150) AS subj, table_nav_status, post_table_nav_status, sent_at::text
     FROM (
       SELECT subject, 'n/a' AS table_nav_status, 'n/a' AS post_table_nav_status, sent_at
       FROM ops_email_nav_records WHERE subject ILIKE '%SAUV26%'
       LIMIT 5
     ) x`,
  )
  console.log("\nsubjects from nav:", parse)
}

main().catch(console.error)
