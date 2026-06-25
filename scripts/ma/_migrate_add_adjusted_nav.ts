import { query } from "../../lib/db"

async function main() {
  await query(`ALTER TABLE ops_team_nav_manual ADD COLUMN IF NOT EXISTS adjusted_nav NUMERIC(16,6)`)
  console.log("Migration done: added adjusted_nav column to ops_team_nav_manual")
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
