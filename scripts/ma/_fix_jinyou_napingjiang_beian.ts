/**
 * Fix 金舆木盛那平江1号 → wrong page (峰云汇高山一号 / SBVC85).
 *
 * Root cause: Guotai TA虚拟净值 subjects like
 *   峰云汇高山一号…【金舆木盛那平江1号…】TA虚拟净值…
 * were stored as product_code=SBVC85 + fund_name=金舆木盛那平江1号, so
 * managed-product beian resolution linked 那平江 to SBVC85 (the underlying).
 *
 * Correct mapping: 金舆木盛那平江1号 = SCP742, 峰云汇高山一号 = SBVC85.
 *
 * Usage (on server — reads DB_* from .env.local):
 *   npx tsx scripts/ma/_fix_jinyou_napingjiang_beian.ts
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { resolveManagedProductBeian } = await import("../../lib/server/managed-product-beian")
  const { refreshManagedProductsListCache } = await import("../../lib/server/managed-products-list-cache-pg")

  console.log(
    "resolve override:",
    resolveManagedProductBeian("金舆木盛那平江1号", "SBVC85"),
    resolveManagedProductBeian("峰云汇高山一号", "SBVC85"),
  )

  const retagUnderlying = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_email_nav_records
       SET fund_name = '峰云汇高山一号'
       WHERE product_code = 'SBVC85'
         AND (
           fund_name ILIKE '%那平江%'
           OR subject ILIKE '%【%那平江%】%TA虚拟净值%'
         )
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
  )
  console.log("Retagged SBVC85 fund_name → 峰云汇高山一号:", retagUnderlying[0]?.n)

  const n = await refreshManagedProductsListCache()
  console.log("refreshed managed products cache rows:", n)

  const managed = await query(
    `SELECT m.product_name, cache.beian_hao, cache.nav_date::text, cache.unit_nav::text
     FROM managed_products m
     LEFT JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
     WHERE m.product_name ILIKE '%那平江%' OR m.product_name ILIKE '%峰云汇高山%'`,
  )
  console.log("managed cache after:", managed)

  const nav = await query(
    `SELECT product_code, fund_name, COUNT(*)::int n
     FROM ops_email_nav_records
     WHERE product_code IN ('SBVC85','SCP742')
        OR fund_name ILIKE '%那平江%'
        OR fund_name ILIKE '%峰云汇高山%'
     GROUP BY 1,2 ORDER BY 1,2`,
  )
  console.log("nav labels:", nav)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
