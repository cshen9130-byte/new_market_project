import { ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()

async function main() {
  const { query } = await import("../../lib/db")
  const rows = await query<{
    pid: number
    state: string
    wait: string | null
    age: string
    query: string
  }>(
    `SELECT pid,
            state,
            wait_event_type || ':' || wait_event AS wait,
            (now() - query_start)::text AS age,
            LEFT(query, 180) AS query
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND state <> 'idle'
       AND pid <> pg_backend_pid()
     ORDER BY query_start`,
  )
  for (const row of rows) console.log(JSON.stringify(row))
  if (rows.length === 0) console.log("no active queries")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
