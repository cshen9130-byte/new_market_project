/**
 * Find and remove duplicate product_name rows in fof_underlying_summary,
 * keeping the row with the lowest id (original Excel import).
 * Also cleans up the FOF overview list cache for removed ids.
 *
 * Run:  npx tsx scripts/ma/fix_fof_underlying_duplicates.ts
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")

  // Show duplicates
  const dupes = await query<{ product_name: string; ids: string; count: string }>(
    `SELECT MIN(product_name) AS product_name,
            STRING_AGG(id::text, ', ' ORDER BY id) AS ids,
            COUNT(*)::text AS count
     FROM fof_underlying_summary
     WHERE product_name <> '合计'
     GROUP BY LOWER(TRIM(product_name))
     HAVING COUNT(*) > 1
     ORDER BY MIN(product_name)`,
  )

  if (dupes.length === 0) {
    console.log("No duplicates found in fof_underlying_summary.")
    process.exit(0)
  }

  console.log(`Found ${dupes.length} duplicate product name(s):`)
  for (const d of dupes) {
    console.log(`  "${d.product_name}" — ids: [${d.ids}] (keeping lowest)`)
  }

  // Delete all but the lowest id per (lowercased, trimmed) product_name
  const deleted = await query<{ id: number; product_name: string; source_file: string }>(
    `DELETE FROM fof_underlying_summary
     WHERE id IN (
       SELECT id FROM (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY LOWER(TRIM(product_name))
                  ORDER BY id ASC
                ) AS rn
         FROM fof_underlying_summary
         WHERE product_name <> '合计'
       ) ranked
       WHERE rn > 1
     )
     RETURNING id, product_name, source_file`,
  )

  console.log(`\nDeleted ${deleted.length} duplicate row(s):`)
  for (const r of deleted) {
    console.log(`  id=${r.id}  "${r.product_name}"  [source: ${r.source_file}]`)
  }

  // Clean up FOF overview list cache
  if (deleted.length > 0) {
    const deletedIds = deleted.map((r) => r.id)
    const cacheDeleted = await query<{ n: string }>(
      `WITH d AS (
         DELETE FROM ops_fof_overview_list_cache
         WHERE fof_underlying_id = ANY($1::int[])
         RETURNING 1
       ) SELECT COUNT(*)::text AS n FROM d`,
      [deletedIds],
    )
    console.log(`Cleaned up ${cacheDeleted[0]?.n ?? 0} cache row(s).`)
  }

  process.exit(0)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
