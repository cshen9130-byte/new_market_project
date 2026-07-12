/**
 * Remove junk rows from 邮箱运维池 and add email funds missing from the pool.
 *
 * Usage:
 *   npx tsx scripts/ma/repair_email_pool_junk_and_missing.ts --dry-run
 *   npx tsx scripts/ma/repair_email_pool_junk_and_missing.ts --apply
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"

loadProjectEnvFiles()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL!
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const POOL_KEY = "custom_email_nav"

const JUNK_ROWS: { register_number: string; product_name: string }[] = [
  { register_number: "2026年07月07日金舆基石一号", product_name: "2026年07月07日金舆基石一号" },
  { register_number: "国泰海通金舆基石一号", product_name: "国泰海通金舆基石一号" },
  { register_number: "SVN917", product_name: "号" },
  { register_number: "上海诚奇", product_name: "上海诚奇" },
  { register_number: "上海奇盾世家", product_name: "上海奇盾世家" },
  { register_number: "BHS17A", product_name: "上海务扬A类" },
  { register_number: "上海众量", product_name: "上海众量" },
  { register_number: "aaa私募", product_name: "AAA私募" },
]

/** Email funds missing from pool — optional hint beian from subject/export. */
const TO_ADD: { product_name: string; hint_beian?: string; skip?: string }[] = [
  { product_name: "笃熙禀泰文艺复兴16号", hint_beian: "SNG210" },
  { product_name: "富善投资星牛1号B类", hint_beian: "ACZ75B" },
  { product_name: "格上安盈2号私募" },
  { product_name: "古曲祥辰5号", hint_beian: "SXN097" },
  { product_name: "衡颐海岳1号" },
  { product_name: "君得安星牛1号B类" },
  { product_name: "明汯中性6号1期" },
  { product_name: "上海荣熙", skip: "manager name, not a fund product" },
  { product_name: "天戈钻选CTA1号", hint_beian: "SVN917" },
  { product_name: "致邃投资-优孚1号A类", hint_beian: "BBR65A" },
  { product_name: "纵贯白马成长2号", hint_beian: "SAGW15" },
]

function normName(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase()
}

async function resolveBeian(
  productName: string,
  hint: string | undefined,
  query: typeof import("../../lib/db").query,
): Promise<string | null> {
  if (hint?.trim()) {
    const hit = await query<{ register_number: string }>(
      `SELECT register_number FROM user_custom_pool
       WHERE pool_key = $1 AND register_number = $2 LIMIT 1`,
      [POOL_KEY, hint.trim().toUpperCase()],
    )
    if (hit.length) return hint.trim().toUpperCase()

    const nav = await query<{ product_code: string }>(
      `SELECT product_code FROM ops_email_nav_records
       WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
         AND (fund_name ILIKE $1 OR subject ILIKE $1)
       ORDER BY nav_date DESC NULLS LAST LIMIT 1`,
      [`%${productName.replace(/[AB]类$/, "").slice(0, 8)}%`],
    )
    if (nav[0]?.product_code) return nav[0].product_code.trim().toUpperCase()
    return hint.trim().toUpperCase()
  }

  const pattern = `%${productName.replace(/[AB]类$/, "").slice(0, 10)}%`
  for (const sql of [
    `SELECT product_code AS beian FROM ops_email_nav_records
     WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
       AND (fund_name ILIKE $1 OR subject ILIKE $1)
     ORDER BY nav_date DESC NULLS LAST LIMIT 1`,
    `SELECT product_code AS beian FROM ops_email_valuation_records
     WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
       AND (fund_name ILIKE $1 OR subject ILIKE $1)
     ORDER BY valuation_date DESC NULLS LAST LIMIT 1`,
    `SELECT beian_hao AS beian FROM private_fund_info
     WHERE product_name ILIKE $1 LIMIT 1`,
    `SELECT beian_hao AS beian FROM private_fund_info_bfl
     WHERE product_name ILIKE $1 LIMIT 1`,
    `SELECT register_number AS beian FROM fof_mom_tracking
     WHERE product_name ILIKE $1 LIMIT 1`,
    `SELECT beian_hao AS beian FROM fof_underlying_detail
     WHERE product_name ILIKE $1 AND NULLIF(BTRIM(beian_hao), '') IS NOT NULL LIMIT 1`,
  ]) {
    const rows = await query<{ beian: string }>(sql, [pattern])
    if (rows[0]?.beian?.trim()) return rows[0].beian.trim().toUpperCase()
  }
  return null
}

async function main() {
  const apply = process.argv.includes("--apply")
  const dryRun = !apply

  const { query } = await import("../../lib/db")
  const { addFundToTrackingPool, invalidateTrackingPoolListCaches } = await import(
    "../../lib/server/tracking-pool-membership"
  )
  const { upsertTrackingFundListCacheEntry } = await import(
    "../../lib/server/tracking-funds-list-cache-pg"
  )

  console.log(dryRun ? "=== DRY RUN ===" : "=== APPLY ===")

  console.log("\n--- Delete junk rows ---")
  for (const row of JUNK_ROWS) {
    const existing = await query<{ id: number; product_name: string; register_number: string }>(
      `SELECT id, product_name, register_number FROM user_custom_pool
       WHERE pool_key = $1 AND register_number = $2 AND product_name = $3`,
      [POOL_KEY, row.register_number, row.product_name],
    )
    if (existing.length === 0) {
      console.log(`  skip (not found): ${row.product_name} / ${row.register_number}`)
      continue
    }
    console.log(`  delete: ${row.product_name} (${row.register_number})`)
    if (apply) {
      await query(
        `DELETE FROM user_custom_pool
         WHERE pool_key = $1 AND register_number = $2 AND product_name = $3`,
        [POOL_KEY, row.register_number, row.product_name],
      )
    }
  }

  console.log("\n--- Add missing email funds ---")
  let added = 0
  let skipped = 0
  for (const item of TO_ADD) {
    if (item.skip) {
      console.log(`  skip: ${item.product_name} — ${item.skip}`)
      skipped++
      continue
    }

    const beian = await resolveBeian(item.product_name, item.hint_beian, query)
    if (!beian) {
      console.log(`  FAILED (no beian): ${item.product_name}`)
      skipped++
      continue
    }

    const poolRows = await query<{ product_name: string; register_number: string }>(
      `SELECT product_name, register_number FROM user_custom_pool WHERE pool_key = $1`,
      [POOL_KEY],
    )
    const key = normName(item.product_name)
    const exists = poolRows.some(
      (r) =>
        r.register_number.toUpperCase() === beian.toUpperCase()
        || normName(r.product_name) === key,
    )
    if (exists) {
      console.log(`  already in pool: ${item.product_name} (${beian})`)
      continue
    }

    console.log(`  add: ${item.product_name} → ${beian}`)
    if (apply) {
      const { created } = await addFundToTrackingPool(POOL_KEY, beian, item.product_name)
      if (created) {
        added++
        try {
          await upsertTrackingFundListCacheEntry(beian, item.product_name)
        } catch (err) {
          console.warn("    cache upsert failed:", err)
        }
      }
    } else {
      added++
    }
  }

  if (apply) {
    invalidateTrackingPoolListCaches([POOL_KEY])
    const count = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM user_custom_pool WHERE pool_key = $1`,
      [POOL_KEY],
    )
    console.log(`\nPool total after repair: ${count[0]?.n}`)
    console.log(`Added: ${added}, skipped: ${skipped}`)
  } else {
    console.log(`\nWould add ${added} fund(s), skip ${skipped}. Re-run with --apply to execute.`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
