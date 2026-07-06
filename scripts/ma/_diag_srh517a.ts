/**
 * Diagnose 务扬赤壁1号A类 (SRH517A) NAV
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const { selectEmailNavSeriesRows } = await import("@/lib/server/email-nav-query")
  const { BatchNavResolver } = await import("@/lib/server/list-cache-nav-batch")
  const { FOF_UNDERLYING_BEIAN_EXPR, buildFofUnderlyingSummaryFrom } = await import(
    "@/lib/server/fof-underlying-query"
  )

  const summary = await query<{ id: string; product_name: string; beian_hao: string | null }>(
    `SELECT f.id::text, f.product_name, ${FOF_UNDERLYING_BEIAN_EXPR} AS beian_hao
     ${buildFofUnderlyingSummaryFrom("f.product_name")}
     WHERE f.product_name ILIKE '%赤壁%' OR f.product_name ILIKE '%务扬%'
     ORDER BY f.id`,
  )
  console.log("fof_underlying_summary:", summary)

  const cache = await query(
    `SELECT f.product_name, c.beian_hao, c.unit_nav::text, c.nav_date::text, c.return_pct::text, c.market_value::text
     FROM ops_fof_overview_list_cache c
     JOIN fof_underlying_summary f ON f.id = c.fof_underlying_id
     WHERE f.product_name ILIKE '%赤壁%' OR f.product_name ILIKE '%务扬%'`,
  )
  console.log("cache:", cache)

  const emails = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code,
            LEFT(fund_name, 120) AS fund_name, source, LEFT(subject, 80) AS subject
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%赤壁%' OR fund_name ILIKE '%务扬%' OR product_code ILIKE '%SRH517%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 15`,
  )
  console.log("email rows (latest):", emails)

  const beian = summary[0]?.beian_hao ?? "SRH517A"
  const productName = summary[0]?.product_name ?? "务扬赤壁1号私募证券投资基金A类"

  const rawRows = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            product_code, fund_name, attachment_filename, subject, source
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%赤壁%' OR fund_name ILIKE '%务扬%' OR product_code ILIKE '%SRH517%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 50`,
  )
  const picked = selectEmailNavSeriesRows(rawRows as never[], beian, [productName])
  console.log("selectEmailNavSeriesRows count:", picked.length)
  console.log("selectEmailNavSeriesRows latest:", picked.slice(-5))

  const resolver = await BatchNavResolver.create(
    [{ beian_hao: beian, product_name: productName, short_name: productName }],
    "2026-06-28",
  )
  const resolved = resolver.resolveAt(
    { beian_hao: beian, product_name: productName, short_name: productName },
    "2026-06-28",
  )
  console.log("BatchNavResolver 2026-06-28:", resolved)

  const resolver2025 = await BatchNavResolver.create(
    [{ beian_hao: beian, product_name: productName, short_name: productName }],
    "2025-07-02",
  )
  console.log("BatchNavResolver 2025-07-02:", resolver2025.resolveAt(
    { beian_hao: beian, product_name: productName, short_name: productName },
    "2025-07-02",
  ))

  console.log("nav date range:", await query(
    `SELECT MIN(nav_date)::text AS min_date, MAX(nav_date)::text AS max_date, COUNT(*)::text AS cnt
     FROM ops_email_nav_records
     WHERE product_code ILIKE '%SBHS17%' OR fund_name ILIKE '%赤壁%'`,
  ))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
