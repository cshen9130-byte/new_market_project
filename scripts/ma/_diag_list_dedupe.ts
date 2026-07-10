import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { SQL_SHARE_CLASS_DISPLAY_DEDUPE_ORDER } from "../../lib/server/fund-name-match"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

async function listQuery(keyword: string) {
  return query<{ beian_hao: string; product_name: string; unit_nav: string | null; nav_date: string | null }>(
    `SELECT i.beian_hao, i.product_name, cache.unit_nav::text, cache.nav_date::text
     FROM (
       SELECT DISTINCT ON (LOWER(BTRIM(product_name)))
         p.register_number AS beian_hao,
         p.product_name
       FROM user_custom_pool p
       WHERE p.register_number IS NOT NULL AND p.pool_key = 'custom_email_nav'
       ORDER BY LOWER(BTRIM(product_name)), ${SQL_SHARE_CLASS_DISPLAY_DEDUPE_ORDER}
     ) i
     LEFT JOIN ops_tracking_funds_list_cache cache ON cache.beian_hao = i.beian_hao
     WHERE i.product_name ILIKE $1 OR i.beian_hao ILIKE $1`,
    [`%${keyword}%`],
  )
}

async function main() {
  for (const kw of ["恒盈2号", "泰渊流", "笃照", "SAVM35"]) {
    const rows = await listQuery(kw)
    console.log(`keyword=${kw} count=${rows.length}`, rows)
  }

  const pool = await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav'
       AND (product_name ILIKE '%泰渊流%' OR register_number IN ('SAVM35','AVM35A'))`,
  )
  console.log("\npool SAVM35 family:", pool)

  const asOfDate = new Date().toISOString().slice(0, 10)
  const resolver = await BatchNavResolver.create(
    [{ beian_hao: "SAVM35", product_name: "笃熙景泰泰渊流1号", short_name: null }],
    asOfDate,
  )
  console.log("\nBatchNavResolver SAVM35:", resolver.resolveAt(
    { beian_hao: "SAVM35", product_name: "笃熙景泰泰渊流1号", short_name: null },
    asOfDate,
  ))
}

main().catch(console.error)
