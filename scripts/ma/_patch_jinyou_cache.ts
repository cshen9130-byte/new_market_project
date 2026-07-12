/**
 * Patch ops_managed_products_list_cache for 金舆基石一号 → SAVW72 without full refresh.
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"
import { clampPgNumeric } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

async function main() {
  const product = "金舆基石一号"
  const beian = "SAVW72"
  const asOf = new Date().toISOString().slice(0, 10)

  const identity = { beian_hao: beian, product_name: product, short_name: product }
  const resolver = await BatchNavResolver.create([identity], asOf)
  const latest = resolver.resolveAt(identity, asOf)
  const daily =
    latest != null
      ? resolver.calcDailyReturnPct(identity, latest.nav, latest.nav_date, null)
      : null
  const period =
    latest != null
      ? resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
      : null

  console.log("resolver latest:", latest)
  console.log("period:", period)

  const updated = await query(
    `UPDATE ops_managed_products_list_cache cache
     SET beian_hao = $1,
         unit_nav = $2,
         nav_date = $3::date,
         return_pct = $4,
         ret_1w = $5,
         ret_1m = $6,
         ret_3m = $7,
         ret_6m = $8,
         ret_1y = $9,
         refreshed_at = NOW()
     FROM managed_products m
     WHERE cache.managed_product_id = m.id
       AND m.product_name = $10
     RETURNING m.product_name, cache.beian_hao, cache.nav_date::text, cache.unit_nav::text`,
    [
      beian,
      clampPgNumeric(latest?.nav ?? null, 16, 6),
      latest?.nav_date ?? null,
      clampPgNumeric(daily, 16, 8),
      clampPgNumeric(period?.ret_1w ?? null, 16, 8),
      clampPgNumeric(period?.ret_1m ?? null, 16, 8),
      clampPgNumeric(period?.ret_3m ?? null, 16, 8),
      clampPgNumeric(period?.ret_6m ?? null, 16, 8),
      clampPgNumeric(period?.ret_1y ?? null, 16, 8),
      product,
    ],
  )
  console.log("updated cache:", updated)

  await query(
    `UPDATE user_custom_pool
     SET product_name = '古曲祥辰5号', updated_at = NOW()
     WHERE pool_key = 'custom_email_nav' AND register_number = 'SXN097'
       AND product_name IS DISTINCT FROM '古曲祥辰5号'`,
  )
  console.log("pool SXN097/SAVW72:", await query(
    `SELECT register_number, product_name FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav' AND register_number IN ('SXN097','SAVW72')`,
  ))
}

main().catch(console.error)
