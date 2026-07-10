import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { SQL_SHARE_CLASS_DISPLAY_DEDUPE_ORDER } from "../../lib/server/fund-name-match"

loadProjectEnvFiles()

async function main() {
  const rows = await query(
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
     WHERE i.product_name ILIKE '%荣熙共赢%' OR i.beian_hao ILIKE '%荣熙共赢%'`,
  )
  console.log("list query rows:", rows)

  const raw = await query(
    `SELECT register_number, product_name, length(product_name) len, encode(convert_to(product_name,'UTF8'),'hex') hex
     FROM user_custom_pool WHERE pool_key='custom_email_nav' AND product_name ILIKE '%荣熙共赢%'`,
  )
  console.log("\nraw pool:", raw)
}

main().catch(console.error)
