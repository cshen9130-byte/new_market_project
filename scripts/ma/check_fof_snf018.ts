import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")

  // Check fof_underlying_summary rows matching SNF018 or 衡颐承和20号
  const summary = await query(
    `SELECT id, product_name, sequence_no, source_row_number, source_file, market_value
     FROM fof_underlying_summary
     WHERE product_name ILIKE '%衡颐承和20%'
        OR product_name ILIKE '%SNF018%'
     ORDER BY id`,
  )
  console.log("fof_underlying_summary rows:", JSON.stringify(summary, null, 2))

  // Check ops_fof_overview_list_cache for duplicates on those ids
  if (summary.length > 0) {
    const ids = summary.map((r: any) => r.id)
    const cache = await query(
      `SELECT fof_underlying_id, beian_hao, unit_nav, nav_date
       FROM ops_fof_overview_list_cache
       WHERE fof_underlying_id = ANY($1::int[])`,
      [ids],
    )
    console.log("\nops_fof_overview_list_cache rows:", JSON.stringify(cache, null, 2))
  }

  // Also check if beian_hao SNF018 appears multiple times in cache
  const cacheByBeian = await query(
    `SELECT fof_underlying_id, beian_hao FROM ops_fof_overview_list_cache
     WHERE beian_hao ILIKE '%SNF018%'`,
  )
  console.log("\ncache rows with beian SNF018:", JSON.stringify(cacheByBeian, null, 2))

  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
