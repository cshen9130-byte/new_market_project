import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  for (const t of ["private_fund_nav","private_fund_info","ops_team_nav_manual","ops_email_nav_records","ops_private_fund_detail_nav_cache","private_fund_nav_group"]) {
    try {
      const cols = await query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
        [t]
      )
      console.log("====", t, "====")
      for (const c of cols as any[]) console.log(c.column_name, c.data_type)
    } catch (e: any) {
      console.log(t, e.message)
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
