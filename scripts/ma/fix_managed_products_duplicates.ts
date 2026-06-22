/**
 * Find and remove duplicate rows in managed_products, keeping the lowest id per product_name.
 * Also cleans up the list cache for removed ids.
 *
 * Run:  npx tsx scripts/ma/fix_managed_products_duplicates.ts
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")

  // Show duplicates first
  const dupes = await query<{
    product_name: string
    ids: string
    count: string
  }>(
    `SELECT product_name,
            STRING_AGG(id::text, ', ' ORDER BY id) AS ids,
            COUNT(*)::text AS count
     FROM managed_products
     WHERE product_name <> '合计'
     GROUP BY product_name
     HAVING COUNT(*) > 1
     ORDER BY product_name`,
  )

  if (dupes.length === 0) {
    console.log("No duplicates found.")
    process.exit(0)
  }

  console.log(`Found ${dupes.length} duplicate product name(s):`)
  for (const d of dupes) {
    console.log(`  "${d.product_name}" — ids: [${d.ids}] (keeping lowest)`)
  }

  // Delete all but the lowest id per product_name
  const deleted = await query<{ id: number; product_name: string }>(
    `DELETE FROM managed_products
     WHERE id IN (
       SELECT id FROM (
         SELECT id,
                ROW_NUMBER() OVER (PARTITION BY product_name ORDER BY id ASC) AS rn
         FROM managed_products
         WHERE product_name <> '合计'
       ) ranked
       WHERE rn > 1
     )
     RETURNING id, product_name`,
  )

  console.log(`\nDeleted ${deleted.length} duplicate row(s):`)
  for (const r of deleted) {
    console.log(`  id=${r.id}  "${r.product_name}"`)
  }

  // Also remove from list cache
  if (deleted.length > 0) {
    const deletedIds = deleted.map((r) => r.id)
    await query(
      `DELETE FROM ops_managed_products_list_cache WHERE managed_product_id = ANY($1::int[])`,
      [deletedIds],
    )
    console.log(`Cleaned up list cache for ${deletedIds.length} removed id(s).`)
  }

  process.exit(0)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
