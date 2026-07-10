import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { loadEmailPoolFunds } from "../../lib/server/team-data-query-pg"
import { EMAIL_OPS_POOL_KEY } from "../../lib/server/email-tracking-pool-sync"

loadProjectEnvFiles()

async function main() {
  const poolFunds = await loadEmailPoolFunds()
  const pool = await query<{ register_number: string; product_name: string }>(
    `SELECT register_number, product_name FROM user_custom_pool WHERE pool_key = $1`,
    [EMAIL_OPS_POOL_KEY],
  )
  const poolRegs = new Set(pool.map((r) => r.register_number))

  const missing = poolFunds.filter((f) => !poolRegs.has(f.register_number))
  console.log("loadEmailPoolFunds:", poolFunds.length, "pool:", pool.length, "missing:", missing.length)
  if (missing.length) console.log(missing.slice(0, 30))

  const extra = pool.filter((p) => !poolFunds.some((f) => f.register_number === p.register_number))
  console.log("in pool but not in target:", extra.length)
  if (extra.length) console.log(extra.slice(0, 15))
}

main().catch(console.error)
