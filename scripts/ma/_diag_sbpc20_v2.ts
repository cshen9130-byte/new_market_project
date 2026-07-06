/**
 * Diagnose raw DB nav data for SBPC20 (六妙星九紫一号).
 * Usage: npx tsx scripts/ma/_diag_sbpc20_v2.ts
 */
import { Pool } from "pg"

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function q<T = Record<string, string | null>>(sql: string, args: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query(sql, args)
  return rows as T[]
}

async function main() {
  const BEIAN = "SBPC20"

  // 1. Email nav records
  const emailRows = await q(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            fund_name, product_code, source
     FROM ops_email_nav_records
     WHERE product_code = $1
     ORDER BY nav_date ASC`,
    [BEIAN]
  )
  console.log(`\n=== ops_email_nav_records for ${BEIAN} (${emailRows.length} rows) ===`)
  for (const r of emailRows) {
    console.log(`  ${r.nav_date}: nav=${r.nav}, cum=${r.cumulative_nav}, adj=${r.adjusted_nav} [${r.source}]`)
  }

  // 2. Platform legacy nav tables (raw, without finalize)
  const navGroup = await q(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text, price_change::text
     FROM private_fund_nav_group
     WHERE beian_hao = $1
     ORDER BY price_date ASC`,
    [BEIAN]
  )
  console.log(`\n=== private_fund_nav_group (${navGroup.length} rows) ===`)
  for (const r of navGroup.slice(-10)) {
    console.log(`  ${r.price_date}: unit=${r.nav}, adj=${r.cumulative_nav}, cum=${r.cum_nav_withdrawal}, chg=${r.price_change}`)
  }

  const navGroupType6 = await q(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text, price_change::text
     FROM private_fund_nav_group_type6
     WHERE beian_hao = $1
     ORDER BY price_date ASC`,
    [BEIAN]
  )
  console.log(`\n=== private_fund_nav_group_type6 (${navGroupType6.length} rows) ===`)
  for (const r of navGroupType6.slice(-10)) {
    console.log(`  ${r.price_date}: unit=${r.nav}, adj=${r.cumulative_nav}, cum=${r.cum_nav_withdrawal}, chg=${r.price_change}`)
  }

  // 3. Check managed product (ops_team_nav_manual)
  const manualNav = await q(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, price_change::text, source::text
     FROM ops_team_nav_manual
     WHERE product_code = $1
        OR product_name LIKE '%九紫%'
     ORDER BY nav_date ASC`,
    [BEIAN]
  )
  console.log(`\n=== ops_team_nav_manual (${manualNav.length} rows) ===`)
  for (const r of manualNav.slice(-10)) {
    console.log(`  ${r.nav_date}: nav=${r.nav}, cum=${r.cumulative_nav}, chg=${r.price_change} [${r.source}]`)
  }

  // 4. Check private_fund_info for this beian
  const fundInfo = await q(
    `SELECT product_name, beian_hao, fund_type, manager_name FROM private_fund_info WHERE beian_hao = $1`,
    [BEIAN]
  )
  console.log(`\n=== private_fund_info: ${JSON.stringify(fundInfo)}`)

  const fundInfoBfl = await q(
    `SELECT product_name, beian_hao FROM private_fund_info_bfl WHERE beian_hao = $1`,
    [BEIAN]
  )
  console.log(`=== private_fund_info_bfl: ${JSON.stringify(fundInfoBfl)}`)

  await pool.end()
}

main().catch(e => { console.error(e); process.exit(1) })
