import { query } from "../../lib/db"
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

async function main() {
  try {
    const r = await query(`SELECT COUNT(*) AS cnt FROM ops_team_nav_manual WHERE beian_hao='SBAH99'`)
    console.log("rows:", JSON.stringify(r.rows))
  } catch(e: unknown) {
    console.error("Error:", String(e))
  }
  process.exit(0)
}
main()
