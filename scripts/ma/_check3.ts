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

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    const r1 = await pool.query(`SELECT COUNT(*) AS cnt FROM ops_team_nav_manual WHERE beian_hao='SBAH99'`)
    console.log("SBAH99 count:", r1.rows[0].cnt)
    
    const r2 = await pool.query(`SELECT nav_date::text, unit_nav::text, cumulative_nav::text FROM ops_team_nav_manual WHERE beian_hao='SBAH99' ORDER BY nav_date DESC LIMIT 5`)
    console.log("Last 5:")
    for (const row of r2.rows) console.log(" ", row)
  } catch (e) {
    console.error("Error:", e)
  } finally {
    await pool.end()
  }
  process.exit(0)
}
main()
