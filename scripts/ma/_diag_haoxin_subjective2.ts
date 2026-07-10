import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

async function main() {
  const funds = await query<{ beian_hao: string; product_name: string }>(
    `SELECT beian_hao, product_name FROM private_fund_info_bfl
     WHERE product_name ILIKE '%豪鑫主观2号%' OR product_name ILIKE '%六妙星豪鑫主观%'
     UNION ALL
     SELECT beian_hao, product_name FROM private_fund_info
     WHERE product_name ILIKE '%豪鑫主观2号%' OR product_name ILIKE '%六妙星豪鑫主观%'`,
  )
  console.log("funds:", funds)
  const beian = funds[0]?.beian_hao
  if (!beian) return

  const email = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, left(subject,80) AS subj
     FROM ops_email_nav_records
     WHERE product_code = $1 OR fund_name ILIKE '%豪鑫主观2号%' OR subject ILIKE '%豪鑫主观2号%'
     ORDER BY nav_date DESC LIMIT 10`,
    [beian],
  )
  console.log("\nemail:", email)

  const cache = await query(
    `SELECT unit_nav::text, nav_date::text, return_pct::text, ret_1w::text, ret_3m::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [beian],
  )
  console.log("\ncache:", cache[0])

  const name = funds[0].product_name
  const legacy = await loadPrivateFundLegacyNavRows(beian, name, name.replace(/私募证券投资基金.*$/u, ""))
  const emailNav = await loadEmailNavSeries(beian, name)
  console.log("\nemailNav count:", emailNav.length, "tail:", emailNav.slice(-3))

  const type6 = await query(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text, product_name
     FROM private_fund_nav_group_type6
     WHERE beian_hao = $1 AND price_date >= '2026-04-01'
     ORDER BY price_date DESC LIMIT 20`,
    [beian],
  )
  console.log("\ntype6 recent:", type6)

  const badEmail = await query(
    `SELECT id, nav_date::text, nav::text, cumulative_nav::text, left(subject,100) AS subj
     FROM ops_email_nav_records
     WHERE (product_code = $1 OR fund_name ILIKE '%豪鑫主观2号%')
       AND nav::numeric > 1000
     ORDER BY nav_date DESC`,
    [beian],
  )
  console.log("\nbad email rows (>1000):", badEmail)

  const jul2 = await query(
    `SELECT id, nav_date::text, nav::text, cumulative_nav::text, source, left(subject,80) AS subj
     FROM ops_email_nav_records
     WHERE product_code = $1 AND nav_date = '2026-07-02'
     ORDER BY id`,
    [beian],
  )
  console.log("\nall Jul 2 rows:", jul2)

  const merged = mergeNavSeriesWithEmail(legacy, emailNav)
  console.log("\nmerged tail:", merged.slice(-5).map((r) => ({ d: r.price_date, u: r.nav, c: r.cum_nav_withdrawal })))

  const identity = { beian_hao: beian, product_name: name, short_name: null }
  const resolver2 = await BatchNavResolver.create([identity], "2026-07-10")
  const atJul10 = resolver2.resolveAt(identity, "2026-07-10")
  console.log("\nBatchNavResolver resolveAt 2026-07-10:", atJul10)

  const latest = merged.at(-1)
  if (latest) {
    const resolver = await BatchNavResolver.create([identity], latest.price_date)
    const at = resolver.resolveAt(identity, latest.price_date)
    console.log("\nresolver latest:", at)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
