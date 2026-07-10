import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"

loadProjectEnvFiles()

async function main() {
  const rows = await query(
    `SELECT beian_hao, product_name, nav_date, unit_nav::text
     FROM ops_tracking_funds_list_cache
     WHERE product_name ILIKE '%邦客%' OR beian_hao = 'SAUV26'`,
  )
  console.log(rows)
}

main().catch(console.error)
