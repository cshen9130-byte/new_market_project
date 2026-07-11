/**
 * Refresh SBFM35 / BFM35A tracking cache after corrupt-cum unit inference fix.
 * Usage: npx tsx scripts/ma/_fix_sbfm35.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"

loadProjectEnvFiles()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL!
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const FUNDS = [
  { beian: "SBFM35", name: "金友至远1号私募证券投资基金", short: null },
  { beian: "BFM35A", name: "金友至远1号私募证券投资基金A类份额", short: "南京金友A类" },
]

async function main() {
  const { upsertTrackingFundListCacheEntry } = await import(
    "../../lib/server/tracking-funds-list-cache-pg"
  )
  const { BatchNavResolver } = await import("../../lib/server/list-cache-nav-batch")
  const { query } = await import("../../lib/db")

  const identities = FUNDS.map((f) => ({
    beian_hao: f.beian,
    product_name: f.name,
    short_name: f.short,
  }))
  const resolver = await BatchNavResolver.create(identities, "2026-07-11")

  for (const f of FUNDS) {
    const identity = { beian_hao: f.beian, product_name: f.name, short_name: f.short }
    const at = resolver.resolveAt(identity, "2026-07-11")
    console.log(`BatchNavResolver ${f.beian}:`, at)
    await upsertTrackingFundListCacheEntry(f.beian, f.name)
    const cache = await query(
      `SELECT unit_nav::text, nav_date::text, return_pct::text
       FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
      [f.beian],
    )
    console.log(`cache ${f.beian}:`, cache[0])
  }
}

main().catch(console.error)
