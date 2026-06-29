/**
 * Diagnose and optionally terminate blocking queries on the postgres server.
 * Run with: npx tsx scripts/ma/_kill_blocking_queries.ts [--kill]
 */
import pg from "pg"
import path from "path"
import fs from "fs"

for (const fname of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), fname)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const shouldKill = process.argv.includes("--kill")
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  console.log("=== Long-running queries (>5 seconds) ===")
  const longRunning = await pool.query(`
    SELECT pid, state, wait_event_type, wait_event,
           EXTRACT(EPOCH FROM (now() - query_start))::int AS age_s,
           LEFT(query, 200) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND query_start IS NOT NULL
      AND now() - query_start > interval '5 seconds'
    ORDER BY age_s DESC
  `)
  if (longRunning.rows.length === 0) {
    console.log("  (none)")
  } else {
    for (const r of longRunning.rows) {
      console.log(`  pid=${r.pid} state=${r.state} wait=${r.wait_event_type}/${r.wait_event} age=${r.age_s}s`)
      console.log(`    query: ${r.query}`)
    }
  }

  console.log("\n=== Blocked queries (waiting for locks) ===")
  const blocked = await pool.query(`
    SELECT blocked.pid AS blocked_pid,
           blocked.state AS blocked_state,
           EXTRACT(EPOCH FROM (now() - blocked.query_start))::int AS blocked_age_s,
           LEFT(blocked.query, 200) AS blocked_query,
           blocking.pid AS blocking_pid,
           blocking.state AS blocking_state,
           LEFT(blocking.query, 200) AS blocking_query
    FROM pg_stat_activity AS blocked
    JOIN pg_stat_activity AS blocking
      ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
    WHERE blocked.datname = current_database()
    ORDER BY blocked_age_s DESC
  `)
  if (blocked.rows.length === 0) {
    console.log("  (none)")
  } else {
    for (const r of blocked.rows) {
      console.log(`  BLOCKED pid=${r.blocked_pid} (${r.blocked_age_s}s): ${r.blocked_query}`)
      console.log(`    BLOCKED BY pid=${r.blocking_pid} (${r.blocking_state}): ${r.blocking_query}`)
    }
  }

  console.log("\n=== Idle-in-transaction connections ===")
  const idleTx = await pool.query(`
    SELECT pid, state, wait_event_type, wait_event,
           EXTRACT(EPOCH FROM (now() - state_change))::int AS idle_s,
           LEFT(query, 200) AS last_query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state IN ('idle in transaction', 'idle in transaction (aborted)')
    ORDER BY idle_s DESC
  `)
  if (idleTx.rows.length === 0) {
    console.log("  (none)")
  } else {
    for (const r of idleTx.rows) {
      console.log(`  pid=${r.pid} ${r.state} for ${r.idle_s}s | last: ${r.last_query}`)
    }
  }

  if (shouldKill) {
    const toKill = [
      ...blocked.rows.map((r: { blocking_pid: number }) => r.blocking_pid),
      ...idleTx.rows.map((r: { pid: number }) => r.pid),
    ]
    const uniquePids = [...new Set(toKill)]
    if (uniquePids.length === 0) {
      console.log("\nNothing to kill.")
    } else {
      console.log(`\nTerminating pids: ${uniquePids.join(", ")}`)
      for (const pid of uniquePids) {
        const res = await pool.query(`SELECT pg_terminate_backend($1)`, [pid])
        console.log(`  pid ${pid}: terminated=${res.rows[0].pg_terminate_backend}`)
      }
    }
  } else {
    console.log("\nRun with --kill to terminate blocking/idle-in-transaction connections.")
  }

  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
