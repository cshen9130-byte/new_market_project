/**
 * Fix 金舆守安一号 → wrong page (峰云汇高山一号 / SBYC86).
 *
 * Root cause: FOF virtual-NAV subjects like
 *   金舆守安一号…【SBYC86-峰云汇高山一号…】虚拟净值…
 * were stored as product_code=SBYC86 + fund_name=金舆守安一号, so managed-product
 * beian resolution linked 金舆守安一号 to SBYC86 (the underlying holding).
 *
 * Correct mapping: 金舆守安一号 = SBVC25, 峰云汇高山一号 = SBYC86.
 *
 * Usage:
 *   npx tsx scripts/ma/_fix_jinyou_shouan_beian.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { resolveManagedProductBeian } from "../../lib/server/managed-product-beian"
import { refreshManagedProductsListCache } from "../../lib/server/managed-products-list-cache-pg"

loadProjectEnvFiles()

async function main() {
  console.log(
    "resolve override:",
    resolveManagedProductBeian("金舆守安一号", "SBYC86"),
    resolveManagedProductBeian("峰云汇高山一号", null),
  )

  const retagUnderlying = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_email_nav_records
       SET fund_name = '峰云汇高山一号'
       WHERE product_code = 'SBYC86'
         AND (
           fund_name ILIKE '%金舆守安%'
           OR subject ILIKE '%【SBYC86-%峰云汇高山%'
         )
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
  )
  console.log("Retagged SBYC86 fund_name → 峰云汇高山一号:", retagUnderlying[0]?.n)

  const retagManaged = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_email_nav_records
       SET fund_name = '金舆守安一号'
       WHERE product_code = 'SBVC25'
         AND fund_name ILIKE '%峰云汇高山%'
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
  )
  console.log("Retagged SBVC25 fund_name → 金舆守安一号:", retagManaged[0]?.n)

  const n = await refreshManagedProductsListCache()
  console.log("refreshed managed products cache rows:", n)

  const managed = await query(
    `SELECT m.product_name, cache.beian_hao, cache.nav_date::text, cache.unit_nav::text
     FROM managed_products m
     LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
     WHERE m.product_name ILIKE '%守安%' OR m.product_name ILIKE '%峰云汇高山%'`,
  )
  console.log("managed cache after:", managed)

  const nav = await query(
    `SELECT product_code, fund_name, COUNT(*)::int n
     FROM ops_email_nav_records
     WHERE product_code IN ('SBYC86','SBVC25')
     GROUP BY 1,2 ORDER BY 1,2`,
  )
  console.log("nav labels:", nav)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
