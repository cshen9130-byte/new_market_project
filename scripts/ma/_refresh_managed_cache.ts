/** Lightweight rebuild of ops_managed_products_list_cache only (~3 min). */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"
loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("@/lib/db")
  const { refreshManagedProductsListCache } = await import(
    "@/lib/server/managed-products-list-cache-pg"
  )

  const before = await query<{ product_name: string; nav_date: string; unit_nav: string }>(
    `SELECT product_name, nav_date::text, unit_nav::text
     FROM ops_managed_products_list_cache ORDER BY nav_date`,
  )
  console.log("BEFORE:")
  for (const r of before) console.log(`  ${r.nav_date} ${r.product_name} ${r.unit_nav}`)

  const n = await refreshManagedProductsListCache()
  console.log(`\nRebuilt ${n} rows.`)

  const after = await query<{ product_name: string; nav_date: string; unit_nav: string }>(
    `SELECT product_name, nav_date::text, unit_nav::text
     FROM ops_managed_products_list_cache ORDER BY nav_date`,
  )
  console.log("AFTER:")
  for (const r of after) console.log(`  ${r.nav_date} ${r.product_name} ${r.unit_nav}`)

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
