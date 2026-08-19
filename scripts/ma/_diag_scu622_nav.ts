/**
 * Diagnose SCU622 金舆稳健增长1号FOF bad terminal NAV (1.0946 spike).
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("@/lib/db")
  const { loadMergedFundNavRows } = await import("@/lib/server/fund-nav-series")
  const { loadDetailNavSeriesFast } = await import("@/lib/server/fund-detail-fast-path")
  const { unitNavFromValuationSummary } = await import(
    "@/lib/server/email-valuation-nav-backfill"
  )

  const code = "SCU622"
  const name = "金舆稳健增长1号FOF"

  const email = await query<{
    nav_date: string
    nav: string
    cumulative_nav: string | null
    product_code: string | null
    fund_name: string | null
    source: string | null
    subject: string | null
  }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name, source, subject
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) ILIKE $1 OR fund_name ILIKE $2
     ORDER BY nav_date DESC
     LIMIT 20`,
    [code, `%${name}%`],
  )
  console.log("=== email_nav ===")
  for (const r of email) {
    console.log(
      `${r.nav_date?.slice(0, 10)} nav=${r.nav} cum=${r.cumulative_nav} src=${r.source} code=${r.product_code} subj=${(r.subject || "").slice(0, 80)}`,
    )
  }

  const vals = await query<{
    valuation_date: string
    unit_nav: string | null
    cumulative_nav: string | null
    product_code: string | null
    fund_name: string | null
    source: string | null
    subject: string | null
    summary: unknown
  }>(
    `SELECT valuation_date::text, unit_nav::text, cumulative_nav::text, product_code, fund_name, source, subject, summary
     FROM ops_email_valuation_records
     WHERE product_code = $1 OR fund_name ILIKE $2
     ORDER BY valuation_date DESC
     LIMIT 12`,
    [code, `%${name}%`],
  )
  console.log("\n=== valuation ===")
  for (const r of vals) {
    const headerUnit = unitNavFromValuationSummary(r.summary as any)
    const summary = r.summary as Record<string, unknown> | null
    const headerRows = Array.isArray(summary?.header_rows)
      ? (summary!.header_rows as string[]).slice(0, 12)
      : []
    console.log(
      `${r.valuation_date?.slice(0, 10)} col=${r.unit_nav} header=${headerUnit} cum=${r.cumulative_nav} src=${r.source}`,
    )
    console.log(`  subject: ${(r.subject || "").slice(0, 100)}`)
    if (headerRows.length) console.log(`  header_rows: ${JSON.stringify(headerRows)}`)
  }

  const legacy = await query<{
    price_date: string
    nav: string | null
    cumulative_nav: string | null
    cum_nav_withdrawal: string | null
  }>(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
     FROM fund_nav_data
     WHERE beian_hao = $1 OR fund_name ILIKE $2
     ORDER BY price_date DESC
     LIMIT 15`,
    [code, `%${name}%`],
  ).catch(() => [] as any[])
  console.log("\n=== fund_nav_data (legacy) ===")
  console.log(legacy)

  const caches = await query<{
    table_name: string
    beian_hao: string | null
    product_name: string | null
    unit_nav: string | null
    nav_date: string | null
    refreshed_at: string | null
  }>(
    `SELECT 'managed' AS table_name, beian_hao, product_name, unit_nav::text, nav_date::text, refreshed_at::text
     FROM ops_managed_products_list_cache
     WHERE beian_hao = $1 OR product_name ILIKE $2
     UNION ALL
     SELECT 'tracking', beian_hao, product_name, unit_nav::text, nav_date::text, refreshed_at::text
     FROM ops_tracking_products_list_cache
     WHERE beian_hao = $1 OR product_name ILIKE $2
     UNION ALL
     SELECT 'fof', beian_hao, product_name, unit_nav::text, nav_date::text, refreshed_at::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao = $1 OR product_name ILIKE $2`,
    [code, `%${name}%`],
  ).catch(async (err) => {
    console.log("cache union failed", err)
    return query(
      `SELECT 'managed' AS table_name, beian_hao, product_name, unit_nav::text, nav_date::text, refreshed_at::text
       FROM ops_managed_products_list_cache
       WHERE beian_hao = $1 OR product_name ILIKE $2`,
      [code, `%${name}%`],
    )
  })
  console.log("\n=== list caches ===")
  console.log(caches)

  const bleed = await query<{
    nav_date: string
    nav: string
    product_code: string | null
    fund_name: string | null
    subject: string | null
  }>(
    `SELECT nav_date::text, nav::text, product_code, fund_name, subject
     FROM ops_email_nav_records
     WHERE subject ILIKE '%虚拟净值提取%' AND subject ILIKE '%金舆稳健增长1号FOF%'
     ORDER BY nav_date DESC
     LIMIT 12`,
  )
  console.log("\n=== virtual emails with FOF in subject ===")
  for (const r of bleed) {
    console.log(
      `${r.nav_date?.slice(0, 10)} code=${r.product_code} fund_name=${r.fund_name} nav=${r.nav}`,
    )
    console.log(`  ${(r.subject || "").slice(0, 120)}`)
  }

  const { loadEmailNavSeries } = await import("@/lib/server/email-nav-query")
  const emailSeries = await loadEmailNavSeries(code, name, name)
  console.log("\n=== loadEmailNavSeries tail ===")
  for (const r of emailSeries.slice(-8)) {
    console.log(`${r.price_date} unit=${r.nav} cum=${r.cumulative_nav}`)
  }

  const merged = await loadMergedFundNavRows(code, name, name)
  console.log("\n=== loadMergedFundNavRows tail ===")
  for (const r of merged.slice(-8)) {
    console.log(
      `${r.price_date} unit=${r.nav} cum=${r.cum_nav_withdrawal} adj=${r.cumulative_nav}`,
    )
  }

  const { lookupListCacheFundHeader } = await import("@/lib/server/fund-detail-fast-path")
  const h1 = await lookupListCacheFundHeader(code)
  const h2 = await lookupListCacheFundHeader(name)
  const h3 = await lookupListCacheFundHeader("金舆稳健增长1号FOF私募证券投资基金")
  console.log("\n=== list headers ===", { h1, h2, h3 })

  const fullName = "金舆稳健增长1号FOF私募证券投资基金"
  const detail = await loadDetailNavSeriesFast({
    beian_hao: code,
    product_name: fullName,
    short_name: name,
    rawId: code,
  })
  console.log("\n=== loadDetailNavSeriesFast (full name) tip ===")
  for (const r of detail.slice(-5)) {
    console.log(
      `${r.price_date} unit=${r.nav} cum=${r.cum_nav_withdrawal} adj=${r.cumulative_nav}`,
    )
  }

  const detail2 = await loadDetailNavSeriesFast({
    beian_hao: code,
    product_name: name,
    short_name: name,
    rawId: code,
  })
  console.log("\n=== loadDetailNavSeriesFast (short name) tip ===")
  for (const r of detail2.slice(-5)) {
    console.log(
      `${r.price_date} unit=${r.nav} cum=${r.cum_nav_withdrawal} adj=${r.cumulative_nav}`,
    )
  }

  const detailCache = await query(
    `SELECT cache_key, beian_hao, tip_nav_date::text, tip_unit_nav::text, refreshed_at::text
     FROM ops_private_fund_detail_nav_cache
     WHERE beian_hao = $1 OR cache_key = $1 OR cache_key ILIKE $2
     LIMIT 10`,
    [code, `%${name}%`],
  )
  console.log("\n=== detail cache tips ===")
  console.log(detailCache)

  const detailSeries = await query(
    `SELECT e.price_date, e.nav
     FROM ops_private_fund_detail_nav_cache c
     CROSS JOIN LATERAL jsonb_to_recordset(c.nav_series)
       AS e(price_date text, nav text)
     WHERE c.beian_hao = $1 OR c.cache_key = $1
       AND e.price_date >= '2026-08-01'
     ORDER BY e.price_date DESC
     LIMIT 12`,
    [code],
  )
  console.log("\n=== detail cache series ===")
  console.log(detailSeries)
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
