import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const nulls = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_tracking_funds_list_cache WHERE unit_nav IS NULL`,
  )
  console.log("null nav rows:", nulls[0]?.n)
  process.exit(0)
}
main()
