/**
 * Rewrite product names that are actually 估值表 filenames.
 *   npx tsx scripts/ma/_repair_valuation_filename_product_names.ts
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

import { parseValuationWorkbookFilename } from "../../lib/server/valuation-filename"
import { query } from "../../lib/db"

type NamedRow = { src: string; id: string; code: string; name: string }

async function main() {
  const rows = await query<NamedRow>(
    `SELECT 'nav' AS src, id::text, COALESCE(product_code, '') AS code, fund_name AS name
       FROM ops_email_nav_records
      WHERE fund_name ~ '估值报表|估值表' AND fund_name ~ '20\\d{2}'
     UNION ALL
     SELECT 'val', id::text, COALESCE(product_code, ''), fund_name
       FROM ops_email_valuation_records
      WHERE fund_name ~ '估值报表|估值表' AND fund_name ~ '20\\d{2}'
     UNION ALL
     SELECT 'pool', id::text, COALESCE(register_number, ''), product_name
       FROM user_custom_pool
      WHERE product_name ~ '估值报表|估值表' AND product_name ~ '20\\d{2}'
     UNION ALL
     SELECT 'cache', beian_hao, beian_hao, product_name
       FROM ops_tracking_funds_list_cache
      WHERE product_name ~ '估值报表|估值表' AND product_name ~ '20\\d{2}'
     UNION ALL
     SELECT 'track', register_number, register_number, product_name
       FROM tracking_pool
      WHERE product_name ~ '估值报表|估值表' AND product_name ~ '20\\d{2}'
     UNION ALL
     SELECT 'bfl', beian_hao, beian_hao, product_name
       FROM private_fund_info_bfl
      WHERE product_name ~ '估值报表|估值表' AND product_name ~ '20\\d{2}'
     UNION ALL
     SELECT 'job', id::text, COALESCE(beian_hao, ''), COALESCE(product_name, '')
       FROM ops_element_extract_jobs
      WHERE product_name ~ '估值报表|估值表' AND product_name ~ '20\\d{2}'
     UNION ALL
     SELECT 'unreg', id::text, COALESCE(temp_beian_hao, ''), product_name
       FROM ops_unregistered_products
      WHERE product_name ~ '估值报表|估值表' AND product_name ~ '20\\d{2}'`,
  ).catch((err) => {
    console.error("lookup failed", err)
    return [] as NamedRow[]
  })

  console.log(`found ${rows.length} filename-like names`)
  let updated = 0
  for (const row of rows) {
    const parsed = parseValuationWorkbookFilename(row.name)
    if (!parsed?.fundName || parsed.fundName === row.name) {
      console.log(`skip ${row.src} ${row.code} ${row.name}`)
      continue
    }
    const code = parsed.code || row.code
    if (row.src === "nav") {
      await query(
        `UPDATE ops_email_nav_records
            SET fund_name = $2, product_code = COALESCE(NULLIF(BTRIM(product_code), ''), $3)
          WHERE id = $1`,
        [Number(row.id), parsed.fundName, code],
      )
    } else if (row.src === "val") {
      await query(
        `UPDATE ops_email_valuation_records
            SET fund_name = $2, product_code = COALESCE(NULLIF(BTRIM(product_code), ''), $3)
          WHERE id = $1`,
        [Number(row.id), parsed.fundName, code],
      )
    } else if (row.src === "pool") {
      await query(
        `UPDATE user_custom_pool SET product_name = $2, updated_at = NOW() WHERE id = $1`,
        [Number(row.id), parsed.fundName],
      )
    } else if (row.src === "cache") {
      await query(
        `UPDATE ops_tracking_funds_list_cache SET product_name = $2, updated_at = NOW() WHERE beian_hao = $1`,
        [row.id, parsed.fundName],
      )
    } else if (row.src === "track") {
      await query(
        `UPDATE tracking_pool SET product_name = $2 WHERE register_number = $1`,
        [row.id, parsed.fundName],
      )
    } else if (row.src === "bfl") {
      await query(
        `UPDATE private_fund_info_bfl SET product_name = $2, updated_at = NOW() WHERE beian_hao = $1`,
        [row.id, parsed.fundName],
      )
    } else if (row.src === "job") {
      await query(
        `UPDATE ops_element_extract_jobs SET product_name = $2 WHERE id = $1`,
        [Number(row.id), parsed.fundName],
      )
    } else if (row.src === "unreg") {
      await query(
        `UPDATE ops_unregistered_products SET product_name = $2 WHERE id = $1`,
        [Number(row.id), parsed.fundName],
      )
    }
    updated += 1
    console.log(`${row.src} ${row.code || row.id}: ${row.name} → ${parsed.fundName}`)
  }
  console.log(`updated ${updated}`)
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})
