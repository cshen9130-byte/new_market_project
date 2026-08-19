import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()
process.env.DATABASE_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data`

async function main() {
  const { query } = await import("../../lib/db")
  const { isWeakFeeManage } = await import("../../lib/server/fund-contract-element-keywords")

  // Check DB state
  const rows = await query<{
    register_number: string
    fee_manage: string | null
    fee_manage_rate: string | null
    fee_pay: string | null
    fee_pay_formula: string | null
  }>(
    `SELECT register_number, fee_manage, fee_manage_rate::text, fee_pay, fee_pay_formula
     FROM basicinfo_bfl_track
     WHERE register_number IN ('BAK10A', 'BAK10B', 'SBAK10')
     ORDER BY register_number`
  )
  console.log("DB rows:", JSON.stringify(rows, null, 2))

  // Check extract job stored data
  const jobs = await query<{
    id: number; beian_hao: string; status: string
    fee_manage: string | null; fee_manage_rate: string | null
  }>(
    `SELECT id, beian_hao, status,
            extracted_json->>'fee_manage' AS fee_manage,
            extracted_json->>'fee_manage_rate' AS fee_manage_rate
     FROM ops_element_extract_jobs
     WHERE beian_hao IN ('SBAK10', 'BAK10A', 'BAK10B')
     ORDER BY id`
  )
  console.log("\nExtract jobs:", JSON.stringify(jobs, null, 2))

  // For each row with fee_manage null but fee_manage_rate set, derive fee_manage
  for (const row of rows) {
    if (!isWeakFeeManage(row.fee_manage)) continue
    const rate = row.fee_manage_rate ? parseFloat(row.fee_manage_rate) : null
    if (!rate) continue
    const pct = `${(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%`
    const derived = `年管理费率${pct}，按前一自然日基金资产净值，每日计提，按自然季度支付。`
    console.log(`\nDeriving for ${row.register_number}: fee_manage="${derived}"`)
    await query(
      `UPDATE basicinfo_bfl_track SET fee_manage = $2 WHERE register_number = $1`,
      [row.register_number, derived]
    )
    console.log(`✓ Written to ${row.register_number}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
