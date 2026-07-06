import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const procs = await query<{
    pid: number
    duration: string
    state: string
    wait_event_type: string | null
    wait_event: string | null
    query_snippet: string
  }>(
    `SELECT pid,
            (now() - query_start)::text AS duration,
            state,
            wait_event_type,
            wait_event,
            left(regexp_replace(query, E'\\s+', ' ', 'g'), 100) AS query_snippet
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND pid <> pg_backend_pid()
       AND state <> 'idle'
     ORDER BY query_start`,
  )
  console.log(`Active queries: ${procs.length}`)
  for (const row of procs) {
    console.log(
      `  pid=${row.pid} dur=${row.duration} state=${row.state} wait=${row.wait_event_type}/${row.wait_event}`,
    )
    console.log(`    ${row.query_snippet}`)
  }

  const etl = await query<{ pid: number; duration: string; query_snippet: string }>(
    `SELECT pid,
            (now() - query_start)::text AS duration,
            left(regexp_replace(query, E'\\s+', ' ', 'g'), 120) AS query_snippet
     FROM pg_stat_activity
     WHERE datname = current_database()
       AND query ILIKE '%ops_email_valuation%'
       AND state = 'active'
     ORDER BY query_start DESC
     LIMIT 5`,
  )
  if (etl.length > 0) {
    console.log("\nValuation-related active queries:")
    for (const row of etl) console.log(`  pid=${row.pid} dur=${row.duration} | ${row.query_snippet}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
