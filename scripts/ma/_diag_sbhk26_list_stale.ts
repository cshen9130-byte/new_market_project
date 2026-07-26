/**
 * Why 邮箱运维池 list sticks at 2026-06-30 for 六妙星豪鑫6号 while detail shows 2026-07-23.
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { BatchNavResolver } = await import("../../lib/server/list-cache-nav-batch")
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const { enrichTrackFundMetricsRows } = await import("../../lib/server/list-cache-nav-batch")

  const id = { beian_hao: "SBHK26", product_name: "六妙星豪鑫6号", short_name: null as string | null }
  const asOf = "2026-07-26"

  const cache = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text,
            ret_1w::text, ret_1m::text
     FROM ops_tracking_funds_list_cache
     WHERE beian_hao IN ('SBHK26','BHK26A') OR product_name ILIKE '%豪鑫6号%'`,
  )
  console.log("CACHE", cache)

  const email = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name,
            source, left(subject, 90) AS subject
     FROM ops_email_nav_records
     WHERE product_code IN ('SBHK26','BHK26A')
        OR fund_name ILIKE '%豪鑫6号%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 40`,
  )
  console.log("\nEMAIL recent:")
  for (const r of email.filter((x: { nav_date: string }) => x.nav_date >= "2026-06-20")) {
    console.log(r)
  }

  const t6 = await query(
    `SELECT beian_hao, product_name, price_date::text, nav::text
     FROM private_fund_nav_group_type6
     WHERE beian_hao IN ('SBHK26','BHK26A')
        OR product_name ILIKE '%豪鑫6号%'
     ORDER BY price_date DESC
     LIMIT 20`,
  )
  console.log("\nTYPE6 private_fund_nav_group_type6:", t6)

  const legacy = await query(
    `SELECT beian_hao, product_name, price_date::text, nav::text
     FROM (
       SELECT beian_hao, product_name, price_date, nav FROM private_fund_nav_group
       UNION ALL
       SELECT beian_hao, product_name, price_date, nav FROM private_fund_nav_history
     ) x
     WHERE beian_hao IN ('SBHK26','BHK26A') OR product_name ILIKE '%豪鑫6号%'
     ORDER BY price_date DESC
     LIMIT 20`,
  )
  console.log("\nLEGACY:", legacy)

  const resolver = await BatchNavResolver.create([id], asOf)
  const latest = resolver.resolveAt(id, asOf)
  console.log("\nresolveAt parent:", latest)

  const idA = { beian_hao: "BHK26A", product_name: "六妙星豪鑫6号A类", short_name: null as string | null }
  const resolverA = await BatchNavResolver.create([idA], asOf)
  console.log("resolveAt A类:", resolverA.resolveAt(idA, asOf))

  const emailHist = (resolver as unknown as { emailByBeian: Map<string, Array<{ nav_date: string; nav: number }>> })
  // peek via merged history
  const hist = resolver.mergedHistory(id, "2026-06-01")
  console.log("\nmergedHistory tail:", hist.slice(-12))

  const merged = await loadMergedFundNavRows("SBHK26", "六妙星豪鑫6号", "")
  console.log(
    "\ndetail merged tail:",
    merged.filter((r) => r.price_date >= "2026-06-20").slice(-12).map((r) => ({
      d: r.price_date,
      n: r.nav,
    })),
  )

  const enriched = await enrichTrackFundMetricsRows(
    [{
      beian_hao: "SBHK26",
      product_name: "六妙星豪鑫6号",
      short_name: null,
      latest_nav: "1.1227",
      latest_nav_date: "2026-06-30",
      latest_price_change: "0",
      ret_1w: "0",
      ret_1m: "0",
      ret_3m: null,
      ret_6m: null,
      ret_1y: null,
      sharpe_1y: null,
      calmar_1y: null,
    }],
    asOf,
  )
  console.log("\nenrich result:", enriched[0])
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
