import fs from "fs"
import path from "path"

function loadEnv() {
  for (const fname of [".env.local", ".env"]) {
    const envPath = path.join(process.cwd(), fname)
    if (!fs.existsSync(envPath)) continue
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2]
    }
  }
}

async function main() {
  loadEnv()
  const { ensureDevPostgresTunnel } = await import("@/lib/server/dev-prod-db-tunnel")
  await ensureDevPostgresTunnel()
  const { query } = await import("@/lib/db")
  const manual = await query<{ n: number; protected: number; min_d: string; max_d: string }>(
    `SELECT COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE is_protected)::int AS protected,
      MIN(nav_date)::text AS min_d, MAX(nav_date)::text AS max_d
     FROM ops_team_nav_manual WHERE UPPER(BTRIM(beian_hao))='SBPC39' AND nav_type='pre_fee'`,
  )
  console.log("manual", manual[0])
  const email = await query<{ n: number; min_d: string; max_d: string }>(
    `SELECT COUNT(*)::int AS n, MIN(nav_date)::text AS min_d, MAX(nav_date)::text AS max_d
     FROM ops_email_nav_records WHERE UPPER(BTRIM(product_code)) IN ('SBPC39','BPC39')`,
  )
  console.log("email", email[0])

  const { listTeamNavManageRows } = await import("@/lib/server/team-nav-manage-pg")
  const rows = await listTeamNavManageRows({
    beian_hao: "SBPC39",
    product_name: "大树-前海安银8号私募证券投资基金",
    nav_type: "pre_fee",
  })
  console.log("listRows", rows.length, "first", rows[0]?.nav_date, rows[0]?.nav_source, "last", rows.at(-1)?.nav_date, rows.at(-1)?.nav_source)
  const sources: Record<string, number> = {}
  for (const r of rows) sources[r.nav_source] = (sources[r.nav_source] || 0) + 1
  console.log("sources", sources)

  const { isChinaTradingDay } = await import("@/lib/server/china-trading-calendar")
  const csv = fs.readFileSync("C:/Users/Administrator/SBPC39_nav.csv", "utf8").trim().split(/\n/).slice(1)
  let trading = 0, non = 0
  for (const line of csv) {
    const d = line.split(",")[0].trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    if (isChinaTradingDay(d)) trading++
    else non++
  }
  console.log("csv trading/non", trading, non, "total", trading + non)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
