import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { loadEmailPoolFunds } from "../../lib/server/team-data-query-pg"
import { query } from "../../lib/db"

loadProjectEnvFiles()

async function main() {
  const funds = await loadEmailPoolFunds()
  const pool = await query<{
    register_number: string
    product_name: string
    source_file: string
  }>(
    `SELECT register_number, product_name, source_file
     FROM user_custom_pool WHERE pool_key = 'custom_email_nav'`,
  )
  const fundSet = new Set(funds.map((f) => f.register_number))
  const etl = pool.filter(
    (r) => r.source_file === "email_nav_etl" || r.source_file === "email_nav_seed",
  )
  const wouldRemove = etl.filter((r) => !fundSet.has(r.register_number))
  console.log("loadEmailPoolFunds", funds.length)
  console.log("pool", pool.length, "etl", etl.length)
  console.log("sync would REMOVE", wouldRemove.length)
  for (const r of wouldRemove) {
    console.log(" ", r.register_number, "|", r.product_name, "|", r.source_file)
  }
  const wouldAdd = funds.filter(
    (f) => !pool.some((r) => r.register_number === f.register_number),
  )
  console.log("sync would ADD", wouldAdd.length)
  for (const f of wouldAdd) {
    console.log(" ", f.register_number, "|", f.product_name)
  }
}

main().catch(console.error)
