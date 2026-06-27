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
    const r = await pool.query(`SELECT nav_type, COUNT(*) AS cnt FROM ops_team_nav_manual WHERE beian_hao='SBAH99' GROUP BY nav_type`)
    console.log("nav_type distribution:", JSON.stringify(r.rows))
    
    // Also check first row details
    const r2 = await pool.query(`SELECT id, nav_date::text, nav_type, unit_nav::text FROM ops_team_nav_manual WHERE beian_hao='SBAH99' LIMIT 3`)
    console.log("First 3 rows:", JSON.stringify(r2.rows))
  } catch (e) {
    console.error("Error:", e)
  } finally {
    await pool.end()
  }
  process.exit(0)
}
main()
