import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()
async function main() {
  const { query } = await import("@/lib/db")
  const r = await query(
    `SELECT beian_hao, unit_nav::text, nav_date::text,
            return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text
     FROM ops_fof_overview_list_cache WHERE beian_hao = 'ATL22A'`,
  )
  console.log("ATL22A after refresh:", r[0] ?? "(none)")
}
main().catch((e) => { console.error(e); process.exit(1) })
