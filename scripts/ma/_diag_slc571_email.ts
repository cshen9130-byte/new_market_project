import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const rows = await query<{ code: string; d: string; unit: string | null; cum: string | null; name: string | null }>(
    `SELECT product_code AS code, nav_date::text AS d, nav::text AS unit,
            cumulative_nav::text AS cum, fund_name AS name
     FROM ops_email_nav_records
     WHERE nav_date BETWEEN '2025-06-20' AND '2025-06-27'
       AND (product_code ILIKE '%571%' OR fund_name LIKE '%极正量利%')
     ORDER BY code, d
     LIMIT 40`,
  )
  for (const row of rows) console.log(row.code, row.d, row.unit, row.cum, row.name)
  console.log("n", rows.length)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
