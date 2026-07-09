import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
loadProjectEnvFiles()
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch.ts"
import pg from "pg"

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const q = async (s: string, p?: unknown[]) => (await pool.query(s, p)).rows

async function main() {
  const codes = ["SBPV73", "SNF018", "BSJ74B", "BLE72A", "SBAH99"]
  for (const asOf of ["2026-07-08", "2026-07-09"]) {
    console.log(`\n=== asOf ${asOf} ===`)
    const identities = []
    for (const code of codes) {
      const rows = await q(
        `SELECT c.beian_hao, f.product_name
         FROM ops_fof_overview_list_cache c
         JOIN fof_underlying_summary f ON f.id = c.fof_underlying_id
         WHERE c.beian_hao = $1 LIMIT 1`,
        [code],
      )
      if (rows[0]) {
        identities.push({
          beian_hao: rows[0].beian_hao,
          product_name: rows[0].product_name,
          short_name: rows[0].product_name,
        })
      }
    }
    const resolver = await BatchNavResolver.create(identities, asOf)
    for (const id of identities) {
      const pt = resolver.resolveAt(id, asOf)
      console.log(id.beian_hao, pt?.nav_date, pt?.nav)
    }
  }
  await pool.end()
}

main()
