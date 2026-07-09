import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
loadProjectEnvFiles()
import pg from "pg"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const r = await pool.query(
    `SELECT c.beian_hao, c.nav_date::text, c.unit_nav::text, f.product_name
     FROM ops_fof_overview_list_cache c
     JOIN fof_underlying_summary f ON f.id = c.fof_underlying_id
     WHERE f.product_name ILIKE '%共赢%'
     ORDER BY f.product_name`,
  )
  for (const row of r.rows) console.log(row.beian_hao, row.nav_date, row.unit_nav, row.product_name)
  await pool.end()
}

main()
