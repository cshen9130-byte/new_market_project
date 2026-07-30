/**
 * One-off: sync 百奕小天鹅2号B类 FOF list tip from detail 平台数据.
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("@/lib/db")
  const { syncFofOverviewLatestFromDetail } = await import(
    "@/lib/server/fof-overview-list-cache-pg"
  )

  const beian = "BSJ74B"
  const name = "百奕小天鹅2号B类"

  const before = await query<{
    beian_hao: string | null
    product_name: string
    unit_nav: string | null
    nav_date: string | null
    return_pct: string | null
    refreshed_at: string | null
  }>(
    `SELECT beian_hao, product_name, unit_nav::text, nav_date::text,
            return_pct::text, refreshed_at::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao ILIKE $1 OR product_name = $2`,
    [`%BSJ74%`, name],
  )
  console.log("BEFORE", before)

  const n = await syncFofOverviewLatestFromDetail([
    { product_name: name, beian_hao: beian, short_name: name },
  ])
  console.log("synced", n)

  const after = await query<{
    beian_hao: string | null
    product_name: string
    unit_nav: string | null
    nav_date: string | null
    return_pct: string | null
    refreshed_at: string | null
  }>(
    `SELECT beian_hao, product_name, unit_nav::text, nav_date::text,
            return_pct::text, refreshed_at::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao ILIKE $1 OR product_name = $2`,
    [`%BSJ74%`, name],
  )
  console.log("AFTER", after)
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
