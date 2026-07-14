/**
 * Diagnose 锐耐稳健对冲11号 / A类 on server DB (via SSH tunnel :5433).
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"
import { lookupFundNavCorrectionRule } from "../../lib/server/fund-nav-correction-rules"
import { loadMergedFundNavRows } from "../../lib/server/fund-nav-series"

loadProjectEnvFiles()

const CODES = ["SBDF95", "BDP99A", "BDF95A"]

async function diagCode(code: string) {
  console.log(`\n=== ${code} ===`)
  const cache = await query(
    `SELECT beian_hao, product_name, unit_nav::text, nav_date::text, return_pct::text,
            ret_1w::text, ret_1m::text, refreshed_at::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [code],
  )
  console.log("cache:", cache[0] ?? "(none)")

  const bfl = await query(
    `SELECT beian_hao, product_name, short_name FROM private_fund_info_bfl WHERE beian_hao = $1`,
    [code],
  ).catch(() => [])
  console.log("bfl:", bfl[0] ?? "(none)")

  const pool = await query(
    `SELECT register_number, product_name, pool_key FROM user_custom_pool
     WHERE register_number = $1`,
    [code],
  )
  console.log("pool:", pool)

  const email = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) = $1
     ORDER BY nav_date DESC LIMIT 8`,
    [code],
  )
  console.log("email latest:", email)

  const rule = lookupFundNavCorrectionRule(code)
  console.log("correction rule:", rule)
}

async function diagByName(name: string, beian: string) {
  console.log(`\n=== NAV series: ${name} (${beian}) ===`)
  const rows = await loadMergedFundNavRows(beian, name, "")
  console.log("series length:", rows.length)
  if (rows.length > 0) {
    console.log("first:", rows[0])
    console.log("last:", rows.at(-1))
  }
  const asOf = new Date().toISOString().slice(0, 10)
  const resolver = await BatchNavResolver.create(
    [{ beian_hao: beian, product_name: name, short_name: null }],
    asOf,
  )
  const latest = resolver.resolveAt({ beian_hao: beian, product_name: name, short_name: null }, asOf)
  console.log("resolver latest:", latest)
  if (latest) {
    const chg = resolver.calcDailyReturnPct(
      { beian_hao: beian, product_name: name, short_name: null },
      latest.nav,
      latest.nav_date,
      null,
    )
    console.log("daily return %:", chg != null ? chg * 100 : null)
  }
}

async function main() {
  for (const code of CODES) await diagCode(code)

  const byName = await query(
    `SELECT beian_hao, product_name, short_name FROM private_fund_info_bfl
     WHERE product_name ILIKE '%锐耐稳健对冲11%' OR short_name ILIKE '%锐耐稳健对冲11%'`,
  )
  console.log("\n=== all bfl matches ===")
  console.log(byName)

  await diagByName("锐耐稳健对冲11号私募证券投资基金", "SBDF95")
  await diagByName("锐耐稳健对冲11号A类", "BDF95A")
  await diagByName("锐耐稳健对冲11号A类", "BDP99A")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
