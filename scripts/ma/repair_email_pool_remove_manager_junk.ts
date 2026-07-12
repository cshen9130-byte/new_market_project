/**
 * Remove manager-name junk rows from 邮箱运维池 (青岛立心, 泉州棕榈滩, 上海务扬).
 * Usage: npx tsx scripts/ma/repair_email_pool_remove_manager_junk.ts --apply
 */
import pg from "pg"

const DB =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const POOL_KEY = "custom_email_nav"

const JUNK: { register_number: string; product_name: string }[] = [
  { register_number: "青岛立心", product_name: "青岛立心" },
  { register_number: "泉州棕榈滩", product_name: "泉州棕榈滩" },
  { register_number: "上海务扬", product_name: "上海务扬" },
  { register_number: "上海众量", product_name: "上海众量" },
  { register_number: "SVN917", product_name: "号" },
  { register_number: "BHS17A", product_name: "上海务扬A类" },
]

async function main() {
  const apply = process.argv.includes("--apply")
  const pool = new pg.Pool({ connectionString: DB })

  try {
    console.log(apply ? "=== APPLY ===" : "=== DRY RUN ===")

    for (const row of JUNK) {
      const existing = await pool.query(
        `SELECT id, register_number, product_name FROM user_custom_pool
         WHERE pool_key = $1 AND register_number = $2 AND product_name = $3`,
        [POOL_KEY, row.register_number, row.product_name],
      )
      const cache = await pool.query(
        `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
         FROM ops_tracking_funds_list_cache
         WHERE beian_hao = $1 OR product_name = $2`,
        [row.register_number, row.product_name],
      )

      console.log(`\n${row.product_name}:`)
      console.log("  pool rows:", existing.rows.length)
      console.log("  cache rows:", cache.rows)

      if (apply && existing.rows.length > 0) {
        await pool.query(
          `DELETE FROM user_custom_pool
           WHERE pool_key = $1 AND register_number = $2 AND product_name = $3`,
          [POOL_KEY, row.register_number, row.product_name],
        )
      }

      if (apply && cache.rows.length > 0) {
        await pool.query(
          `DELETE FROM ops_tracking_funds_list_cache
           WHERE beian_hao = $1 OR product_name = $2`,
          [row.register_number, row.product_name],
        )
      }
    }

    if (apply) {
      const { invalidateTrackingPoolListCaches } = await import(
        "../../lib/server/tracking-pool-membership"
      )
      invalidateTrackingPoolListCaches([POOL_KEY])

      const count = await pool.query(
        `SELECT COUNT(*)::text AS n FROM user_custom_pool WHERE pool_key = $1`,
        [POOL_KEY],
      )
      console.log(`\nPool total: ${count.rows[0]?.n}`)
      console.log("Done. Refresh 邮箱运维池 in the browser.")
    } else {
      console.log("\nRe-run with --apply to execute.")
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
