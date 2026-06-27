import * as dotenv from "dotenv"
import path from "path"
import fs from "fs"
import { mergeNavSeriesWithEmail, mergeLegacyWithTeamNav } from "../../lib/server/email-nav-query"
import { loadManagedProductNavSeed } from "../../lib/server/managed-product-nav-seed"
import { loadManagedProductNavSeries } from "../../lib/server/team-nav-manage-pg"
import { loadPrivateFundLegacyNavRows } from "../../lib/server/email-nav-query"

for (const fname of [".env.local", ".env"]) {
  const envPath = path.join(process.cwd(), fname)
  if (!fs.existsSync(envPath)) continue
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2]
  }
}

async function main() {
  const beianHao = "SBAH99"
  const productName = "荣熙恒盈2号"

  console.log("Loading data...")
  const [teamSeries, seedRows] = await Promise.all([
    loadManagedProductNavSeries(beianHao, productName, []),
    Promise.resolve(loadManagedProductNavSeed(beianHao)),
  ])

  console.log(`teamSeries: ${teamSeries.length} rows`)
  console.log(`seedRows: ${seedRows.length} rows`)

  const legacyNoType6 = await loadPrivateFundLegacyNavRows(beianHao, productName, null, { excludeType6: true })
  console.log(`legacyNoType6: ${legacyNoType6.length} rows`)

  const firstTeamDate = teamSeries[0]?.price_date ?? ""
  const seedBackfill = seedRows.filter(row => !firstTeamDate || row.price_date < firstTeamDate)
  console.log(`seedBackfill: ${seedBackfill.length} rows`)

  let base = mergeNavSeriesWithEmail(legacyNoType6, [])
  if (seedBackfill.length > 0) {
    base = mergeLegacyWithTeamNav(base, seedBackfill)
  }
  const nav_series = mergeLegacyWithTeamNav(base, teamSeries)

  console.log(`\nnav_series total: ${nav_series.length}`)

  // Show rows around 4.30
  console.log("\nRows around 2026-04-30:")
  for (const r of nav_series.filter(r => r.price_date >= "2026-04-28" && r.price_date <= "2026-05-07")) {
    console.log(`  ${r.price_date}  unit=${r.nav}  cum=${r.cum_nav_withdrawal}  adj=${r.cumulative_nav}`)
  }

  // Show last 5 rows
  console.log("\nLast 5 rows:")
  for (const r of nav_series.slice(-5)) {
    console.log(`  ${r.price_date}  unit=${r.nav}  cum=${r.cum_nav_withdrawal}  adj=${r.cumulative_nav}`)
  }

  // Count rows with empty adj
  const emptyAdj = nav_series.filter(r => !r.cumulative_nav || r.cumulative_nav === "")
  console.log(`\nRows with empty adj: ${emptyAdj.length}`)
  if (emptyAdj.length > 0) {
    console.log("First 3 empty adj rows:", emptyAdj.slice(0, 3).map(r => r.price_date))
    console.log("Last 3 empty adj rows:", emptyAdj.slice(-3).map(r => r.price_date))
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
