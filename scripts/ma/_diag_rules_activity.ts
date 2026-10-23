import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

async function main() {
  ensureScriptDatabaseEnv()
  const { query } = await import("../../lib/db")
  const rows = await query<{ pid: string; state: string; wait: string; sec: string; q: string }>(
    `SELECT pid::text, state, COALESCE(wait_event, '') AS wait,
            EXTRACT(EPOCH FROM (NOW() - query_start))::int::text AS sec,
            LEFT(REGEXP_REPLACE(query, '\\s+', ' ', 'g'), 180) AS q
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND state <> 'idle'
       AND pid <> pg_backend_pid()
     ORDER BY query_start`,
  )
  console.log("active", rows.length)
  for (const row of rows) console.log(row.sec, row.state, row.wait, row.q)
  const n = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_nav_series_flags WHERE anomaly IS NOT NULL`,
  )
  console.log("flags", n[0]?.n)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
