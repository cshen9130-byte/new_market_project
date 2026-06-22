import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")

  // Find all beian_hao values that appear multiple times in the cache
  const dupes = await query<{ beian_hao: string; ids: string; product_names: string; count: string }>(
    `SELECT
       cache.beian_hao,
       STRING_AGG(cache.fof_underlying_id::text, ', ' ORDER BY cache.fof_underlying_id) AS ids,
       STRING_AGG(f.product_name, ' | ' ORDER BY cache.fof_underlying_id) AS product_names,
       COUNT(*)::text AS count
     FROM ops_fof_overview_list_cache cache
     JOIN fof_underlying_summary f ON f.id = cache.fof_underlying_id
     WHERE NULLIF(TRIM(cache.beian_hao), '') IS NOT NULL
     GROUP BY cache.beian_hao
     HAVING COUNT(*) > 1
     ORDER BY cache.beian_hao`,
  )

  console.log(`Found ${dupes.length} duplicate beian_hao(s) in cache:`)
  for (const d of dupes) {
    console.log(`  ${d.beian_hao} — fof_ids: [${d.ids}] — names: "${d.product_names}"`)
  }

  if (dupes.length === 0) { process.exit(0) }

  // For each duplicate beian_hao: the auto-added row (source_file='email_valuation_auto')
  // is the duplicate — delete it from fof_underlying_summary (and cascade will clean cache).
  // If no auto-added row, keep the lowest id.
  const autoAddedToDelete: number[] = []
  const lowestToKeep: { keep: number; deleteIds: number[] }[] = []

  for (const d of dupes) {
    const ids = d.ids.split(', ').map(Number)
    const rows = await query<{ id: number; product_name: string; source_file: string }>(
      `SELECT id, product_name, source_file FROM fof_underlying_summary WHERE id = ANY($1::int[])`,
      [ids],
    )
    const autoAdded = rows.filter(r => r.source_file === 'email_valuation_auto')
    if (autoAdded.length > 0) {
      for (const r of autoAdded) {
        console.log(`  → Will delete auto-added duplicate id=${r.id} "${r.product_name}"`)
        autoAddedToDelete.push(r.id)
      }
    } else {
      // Keep lowest id, delete the rest
      const sorted = rows.sort((a, b) => a.id - b.id)
      const deleteIds = sorted.slice(1).map(r => r.id)
      for (const r of sorted.slice(1)) {
        console.log(`  → Will delete duplicate id=${r.id} "${r.product_name}" (keeping id=${sorted[0].id})`)
      }
      lowestToKeep.push({ keep: sorted[0].id, deleteIds })
    }
  }

  const allDeleteIds = [...autoAddedToDelete, ...lowestToKeep.flatMap(x => x.deleteIds)]

  if (allDeleteIds.length === 0) { console.log("Nothing to delete."); process.exit(0) }

  const deleted = await query<{ id: number; product_name: string }>(
    `DELETE FROM fof_underlying_summary WHERE id = ANY($1::int[]) RETURNING id, product_name`,
    [allDeleteIds],
  )
  console.log(`\nDeleted ${deleted.length} row(s) from fof_underlying_summary:`)
  for (const r of deleted) console.log(`  id=${r.id} "${r.product_name}"`)

  // Clean up cache for deleted ids
  await query(
    `DELETE FROM ops_fof_overview_list_cache WHERE fof_underlying_id = ANY($1::int[])`,
    [allDeleteIds],
  )
  console.log("Cache cleaned up.")

  process.exit(0)
}
main().catch(e => { console.error(e.message); process.exit(1) })
