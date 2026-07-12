import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { loadEmailPoolFunds } from "../../lib/server/team-data-query-pg"
import pg from "pg"

loadProjectEnvFiles()

const DB =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

async function main() {
  const funds = await loadEmailPoolFunds()
  console.log("loadEmailPoolFunds count:", funds.length)

  const p = new pg.Pool({ connectionString: DB })
  const pool = await p.query(
    `SELECT register_number, product_name, source_file
     FROM user_custom_pool WHERE pool_key = 'custom_email_nav'
     ORDER BY source_file, product_name`,
  )
  console.log("DB pool count:", pool.rows.length)
  const bySource = new Map<string, number>()
  for (const r of pool.rows) {
    bySource.set(r.source_file, (bySource.get(r.source_file) ?? 0) + 1)
  }
  console.log("by source:", Object.fromEntries(bySource))

  const inPool = new Set(
    (
      await p.query(
        `SELECT register_number FROM user_custom_pool WHERE pool_key = 'custom_email_nav'`,
      )
    ).rows.map((r) => r.register_number.toUpperCase()),
  )
  const missing = funds.filter((f) => !inPool.has(f.register_number.toUpperCase()))
  console.log("\nIn email sync but not in pool:", missing.length)
  for (const f of missing) {
    console.log(" ", f.register_number, "|", f.product_name)
  }

  await p.end()
}

main().catch(console.error)
