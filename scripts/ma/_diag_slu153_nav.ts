/**
 * Diagnose 荣熙恒盈2号A类 (BAH99A) NAV — scoped to this fund only.
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const { selectEmailNavSeriesRows } = await import("@/lib/server/email-nav-query")
  const { BatchNavResolver } = await import("@/lib/server/list-cache-nav-batch")

  const summary = await query<{ id: string; product_name: string }>(
    `SELECT id::text, product_name
     FROM fof_underlying_summary
     WHERE product_name ILIKE '%恒盈2号%A%'
     ORDER BY id`,
  )
  console.log("fof_underlying_summary:", summary)

  const cache = await query(
    `SELECT f.product_name, c.beian_hao, c.unit_nav::text, c.nav_date::text, c.return_pct::text
     FROM ops_fof_overview_list_cache c
     JOIN fof_underlying_summary f ON f.id = c.fof_underlying_id
     WHERE f.product_name ILIKE '%恒盈2号%A%'`,
  )
  console.log("cache:", cache)

  const emails = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code,
            LEFT(fund_name, 100) AS fund_name, source, LEFT(subject, 80) AS subject
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%恒盈2号%A%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 6`,
  )
  console.log("email rows (latest):", emails)

  const rawRows = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            product_code, fund_name, attachment_filename, subject, source
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%恒盈2号%A%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 30`,
  )
  const picked = selectEmailNavSeriesRows(rawRows as never[], "BAH99A", ["荣熙恒盈2号A类"])
  console.log("selectEmailNavSeriesRows latest:", picked.slice(-3))

  const resolver = await BatchNavResolver.create(
    [{ beian_hao: "BAH99A", product_name: "荣熙恒盈2号A类", short_name: null }],
    "2026-06-28",
  )
  const resolved = resolver.resolveAt(
    { beian_hao: "BAH99A", product_name: "荣熙恒盈2号A类", short_name: null },
    "2026-06-28",
  )
  console.log("BatchNavResolver:", resolved)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
