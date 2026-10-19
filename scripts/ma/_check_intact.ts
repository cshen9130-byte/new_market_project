import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv(); configureEtlDbTimeout()
async function main() {
  const { query } = await import("../../lib/db")
  for (const code of ["SBAH99", "SNF018", "GA681A"]) {
    const rows = await query(
      `SELECT cache_key, tip_nav_date::text, tip_unit_nav::text, refreshed_at::text,
              nav_series->-1 AS tip
       FROM ops_private_fund_detail_nav_cache
       WHERE cache_key=$1 OR beian_hao=$1 LIMIT 1`, [code])
    console.log(code, JSON.stringify(rows[0] ?? null))
  }
  // Confirm no accidental writes to other team manuals today for those codes
  const recent = await query(
    `SELECT beian_hao, count(*)::int n, max(created_at)::text mx
     FROM ops_team_nav_manual
     WHERE beian_hao IN ('SBAH99','SNF018','GA681A')
     GROUP BY 1`)
  console.log("team rows", JSON.stringify(recent))
}
main().catch(e=>{console.error(e);process.exit(1)})
