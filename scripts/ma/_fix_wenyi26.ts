/**
 * Fix 笃熙禀泰文艺复兴26号 in 邮箱运维池.
 *
 * Root cause: pool row used Chinese register_number; email NAV rows for 26号 were
 * tagged product_code SQQ300 (same code as 笃熙禀泰多资产轮动策略3号), so cache
 * could not join and BatchNavResolver mixed both funds.
 *
 * Fix: split 文艺复兴26 NAV rows to SQQ26A, repair pool + refresh tracking cache.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"
 *   npx tsx scripts/ma/_fix_wenyi26.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  EMAIL_OPS_POOL_KEY,
} from "../../lib/server/email-tracking-pool-sync"
import { invalidateTrackingPoolListCaches } from "../../lib/server/tracking-pool-membership"
import { upsertTrackingFundListCacheEntry } from "../../lib/server/tracking-funds-list-cache-pg"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

const BEIAN = "SQQ26A"
const PRODUCT = "笃熙禀泰文艺复兴26号"
const OLD_REGISTER = "笃熙禀泰文艺复兴26号"

async function main() {
  console.log("=== BEFORE ===")
  console.log(
    "pool:",
    await query(
      `SELECT register_number, product_name, source_file FROM user_custom_pool
       WHERE pool_key = $1 AND (register_number = $2 OR register_number = $3 OR product_name = $2)`,
      [EMAIL_OPS_POOL_KEY, OLD_REGISTER, BEIAN],
    ),
  )
  console.log(
    "cache:",
    await query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, ret_1m::text
       FROM ops_tracking_funds_list_cache
       WHERE beian_hao IN ($1, $2) OR product_name = $3`,
      [OLD_REGISTER, BEIAN, PRODUCT],
    ),
  )

  const retag = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ops_email_nav_records
       SET product_code = $1,
           subject = REPLACE(COALESCE(subject, ''), 'SQQ300', $1),
           fund_name = REPLACE(COALESCE(fund_name, ''), 'SQQ300', $1),
           attachment_filename = REPLACE(COALESCE(attachment_filename, ''), 'SQQ300', $1)
       WHERE (
         fund_name ILIKE '%文艺复兴26%'
         OR subject ILIKE '%文艺复兴26%'
       )
       AND COALESCE(fund_name, '') NOT ILIKE '%多资产轮动策略3%'
       AND COALESCE(subject, '') NOT ILIKE '%多资产轮动策略3%'
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
    [BEIAN],
  )
  console.log("\nRetagged 文艺复兴26 nav rows →", BEIAN, ":", retag[0]?.n)

  const deletedPool = await query(
    `DELETE FROM user_custom_pool
     WHERE pool_key = $1 AND register_number = $2
     RETURNING register_number, product_name`,
    [EMAIL_OPS_POOL_KEY, OLD_REGISTER],
  )
  console.log("Deleted name-only pool rows:", deletedPool)

  await query(
    `DELETE FROM ops_tracking_funds_list_cache
     WHERE beian_hao = $1
     RETURNING beian_hao, product_name`,
    [OLD_REGISTER],
  )

  const sync = { note: "skipped syncEmailTrackingPool to avoid re-inserting junk rows" }
  console.log("sync:", sync)

  // Ensure pool row exists with correct code (sync may skip if only name-key existed before)
  const poolExists = await query(
    `SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2 LIMIT 1`,
    [EMAIL_OPS_POOL_KEY, BEIAN],
  )
  if (poolExists.length === 0) {
    await query(
      `INSERT INTO user_custom_pool
         (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
       SELECT $1,
              COALESCE((SELECT MAX(source_row_number) FROM user_custom_pool WHERE pool_key = $1), 0) + 1,
              $2, $3,
              encode(sha256(($1 || '::' || $3 || '::' || $2)::bytea), 'hex'),
              'email_nav_etl', NOW(), NOW()`,
      [EMAIL_OPS_POOL_KEY, PRODUCT, BEIAN],
    )
    console.log("Inserted pool row", BEIAN, PRODUCT)
  } else {
    await query(
      `UPDATE user_custom_pool
       SET product_name = $2, updated_at = NOW()
       WHERE pool_key = $1 AND register_number = $3 AND product_name IS DISTINCT FROM $2`,
      [EMAIL_OPS_POOL_KEY, PRODUCT, BEIAN],
    )
  }

  await upsertTrackingFundListCacheEntry(BEIAN, PRODUCT)
  invalidateTrackingPoolListCaches([EMAIL_OPS_POOL_KEY, "all"])

  const asOf = new Date().toISOString().slice(0, 10)
  const resolver = await BatchNavResolver.create(
    [{ beian_hao: BEIAN, product_name: PRODUCT, short_name: PRODUCT }],
    asOf,
  )
  const identity = { beian_hao: BEIAN, product_name: PRODUCT, short_name: PRODUCT }
  const latest = resolver.resolveAt(identity, asOf)
  console.log("\nresolver latest:", latest)
  if (latest) {
    console.log("daily:", resolver.calcDailyReturnPct(identity, latest.nav, latest.nav_date, null))
    console.log("period:", resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date))
  }

  console.log("\n=== AFTER ===")
  console.log(
    "pool:",
    await query(
      `SELECT register_number, product_name FROM user_custom_pool
       WHERE pool_key = $1 AND (register_number IN ($2, 'SQQ300') OR product_name ILIKE '%文艺复兴26%' OR product_name ILIKE '%多资产轮动策略3%')`,
      [EMAIL_OPS_POOL_KEY, BEIAN],
    ),
  )
  console.log(
    "cache:",
    await query(
      `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text, ret_1m::text, ret_1y::text
       FROM ops_tracking_funds_list_cache
       WHERE beian_hao IN ($1, 'SQQ300') OR product_name ILIKE '%文艺复兴26%'`,
      [BEIAN],
    ),
  )
  console.log(
    "nav split:",
    await query(
      `SELECT product_code, fund_name, COUNT(*)::int n, MAX(nav_date)::text max_date
       FROM ops_email_nav_records
       WHERE product_code IN ('SQQ300', $1) OR fund_name ILIKE '%文艺复兴26%' OR fund_name ILIKE '%多资产轮动策略3%'
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [BEIAN],
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
