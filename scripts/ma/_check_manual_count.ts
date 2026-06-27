import * as dotenv from "dotenv"
import path from "path"
import fs from "fs"
import { query } from "../../lib/db"

for (const fname of [".env.local", ".env"]) {
  const envPath = path.join(process.cwd(), fname)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2]
  }
}

async function main() {
  const r1 = await query<{cnt: string}>(`SELECT COUNT(*)::text AS cnt FROM ops_team_nav_manual WHERE beian_hao = 'SBAH99'`)
  console.log("SBAH99 manual rows:", r1.rows[0].cnt)

  const r2 = await query<{nav_date: string, unit_nav: string, cumulative_nav: string}>(
    `SELECT nav_date::text, unit_nav::text, cumulative_nav::text FROM ops_team_nav_manual WHERE beian_hao='SBAH99' ORDER BY nav_date DESC LIMIT 5`
  )
  console.log("Last 5 rows:")
  for (const r of r2.rows) console.log(" ", r)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
