import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
loadProjectEnvFiles()
import pg from "pg"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const ref = await pool.query(`SELECT MAX(refreshed_at)::text FROM ops_fof_overview_list_cache`)
  const byDate = await pool.query(
    `SELECT nav_date::text, COUNT(*)::int n FROM ops_fof_overview_list_cache GROUP BY 1 ORDER BY 1 DESC NULLS LAST`,
  )
  console.log("refreshed:", ref.rows[0]?.max)
  console.log("by date:", byDate.rows)

  const check = ["SNF018", "ASX73A", "BHK26A", "AZU19A", "SBPC20", "ATL22A", "BGW80A"]
  for (const code of check) {
    const r = await pool.query(
      `SELECT c.nav_date::text, c.unit_nav::text, f.product_name
       FROM ops_fof_overview_list_cache c
       JOIN fof_underlying_summary f ON f.id = c.fof_underlying_id
       WHERE c.beian_hao = $1`,
      [code],
    )
    console.log(code, r.rows[0]?.nav_date, r.rows[0]?.unit_nav, r.rows[0]?.product_name?.slice(0, 20))
  }

  const stuck = await pool.query(
    `SELECT COUNT(*)::int n FROM ops_fof_overview_list_cache WHERE nav_date = '2026-07-07'`,
  )
  console.log("still 07-07:", stuck.rows[0]?.n)
  await pool.end()
}

main()
