/**
 * Diagnose 百奕小天鹅2号B类 (BSJ748) list-cache vs detail latest NAV mismatch.
 */
import { loadProjectEnvFiles, configureEtlDbTimeout } from "@/lib/server/load-project-env"

loadProjectEnvFiles()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("@/lib/db")
  const { BatchNavResolver, addDays, NAV_HISTORY_LOOKBACK_DAYS } = await import(
    "@/lib/server/list-cache-nav-batch"
  )
  const { loadMergedFundNavRows } = await import("@/lib/server/fund-nav-series")
  const { loadDetailNavSeriesFast } = await import("@/lib/server/fund-detail-fast-path")
  const { loadManagedUnderlyingNavHistoryIncremental } = await import(
    "@/lib/server/managed-fof-underlying-pg"
  )

  const beian = "BSJ74B"
  const name = "百奕小天鹅2号B类"

  const cache = await query<{
    unit_nav: string | null
    nav_date: string | null
    refreshed_at: string | null
  }>(
    `SELECT unit_nav::text, nav_date::text, refreshed_at::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao = $1 OR product_name = $2
     ORDER BY refreshed_at DESC NULLS LAST
     LIMIT 3`,
    [beian, name],
  )
  console.log("list_cache:", cache)

  const email = await query<{
    nav_date: string
    nav: string
    cumulative_nav: string | null
    product_code: string | null
    fund_name: string | null
    source: string | null
  }>(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name, source
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) ILIKE $1
        OR fund_name ILIKE $2
     ORDER BY nav_date DESC
     LIMIT 8`,
    [`%${beian}%`, `%小天鹅2号%B%`],
  )
  console.log("email_nav recent:", email)

  const asOf = new Date().toISOString().slice(0, 10)
  const since = addDays(asOf, NAV_HISTORY_LOOKBACK_DAYS)
  const identity = { beian_hao: beian, product_name: name, short_name: name }
  const resolver = await BatchNavResolver.create([identity], asOf)
  const hist = await loadManagedUnderlyingNavHistoryIncremental(since, [
    { product_name: name, beian_hao: beian },
  ])
  resolver.setValuationNavHistory(hist.byCode, hist.byName)

  const resolved = resolver.resolveAt(identity, asOf)
  const merged = resolver.mergedHistory(identity, since)
  console.log("resolveAt:", resolved)
  console.log(
    "mergedHistory tail:",
    merged.slice(-5).map((p) => ({ d: p.nav_date, nav: p.nav, source: p.source })),
  )

  const mergedRows = await loadMergedFundNavRows(beian, name, name)
  console.log(
    "loadMergedFundNavRows tail:",
    mergedRows.slice(-5).map((r) => ({ d: r.price_date, nav: r.nav })),
  )

  const detail = await loadDetailNavSeriesFast({
    beian_hao: beian,
    product_name: name,
    short_name: name,
    rawId: beian,
  })
  console.log(
    "loadDetailNavSeriesFast tail:",
    detail.slice(-5).map((r) => ({ d: r.price_date, nav: r.nav })),
  )
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
