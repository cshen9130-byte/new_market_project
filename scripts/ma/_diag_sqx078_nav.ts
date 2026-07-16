/**
 * Diagnose 特夫郁金香全量化 (SQX078) NAV — scoped to this fund only.
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const {
    loadPrivateFundLegacyNavRows,
    mergeNavSeriesWithEmail,
    findNavInvariantViolations,
  } = await import("@/lib/server/email-nav-query")

  const BEIAN = "SQX078"
  const info = await query<{ beian_hao: string; product_name: string; short_name: string | null }>(
    `SELECT beian_hao, product_name, short_name
     FROM private_fund_info_bfl
     WHERE beian_hao = $1`,
    [BEIAN],
  )
  console.log("info:", info)

  const productName = info[0]?.product_name ?? "特夫郁金香全量化私募证券投资基金"
  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, productName)
  const finalized = mergeNavSeriesWithEmail(legacy, [])
  const violations = findNavInvariantViolations(finalized)

  console.log("legacy count:", legacy.length)
  console.log("invariant violations:", violations.length)

  const recent = finalized.filter((r) => r.price_date >= "2026-05-15")
  console.log("\nrecent after finalizeNavSeries:")
  for (const r of recent) {
    console.log(
      r.price_date,
      "unit", r.nav,
      "cum", r.cum_nav_withdrawal,
      "adj", r.cumulative_nav,
      "chg", r.price_change,
    )
  }

  const emailCount = await query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM ops_email_nav_records
     WHERE UPPER(TRIM(COALESCE(product_code, ''))) = $1
        OR fund_name ILIKE '%郁金香%全量化%'`,
    [BEIAN],
  )
  console.log("\nemail nav rows:", emailCount[0]?.cnt)

  const { loadFundValuationNavFallbackSeries } = await import("@/lib/server/managed-fof-underlying-pg")
  const fallback = await loadFundValuationNavFallbackSeries(BEIAN, productName, info[0]?.short_name ?? null, {
    sinceDate: "2026-05-01",
  })
  console.log("\nvaluation fallback count:", fallback.length)
  console.log("valuation fallback tail:", fallback.slice(-8))

  const fofRows = await query<{ valuation_date: string; unit_nav: string; fof_product_name: string }>(
    `SELECT valuation_date::text, unit_nav::text, fof_product_name
     FROM ops_managed_fof_underlying
     WHERE UPPER(TRIM(COALESCE(underlying_product_code, ''))) = $1
        OR underlying_name ILIKE '%郁金香%全量化%'
     ORDER BY valuation_date DESC
     LIMIT 8`,
    [BEIAN],
  )
  console.log("\nops_managed_fof_underlying tail:", fofRows)

  const { BatchNavResolver } = await import("@/lib/server/list-cache-nav-batch")
  const identity = { beian_hao: BEIAN, product_name: productName, short_name: info[0]?.short_name ?? null }
  const resolver = await BatchNavResolver.create([identity], "2026-07-16")
  const at = resolver.resolveAt(identity, "2026-07-16")
  console.log("\nBatchNavResolver latest:", at)

  const cache = await query<{ nav_date: string; unit_nav: string; refreshed_at: string }>(
    `SELECT nav_date::text, unit_nav::text, refreshed_at::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao = $1`,
    [BEIAN],
  )
  console.log("\nfof list cache:", cache[0])

  const mergedWithFallback = mergeNavSeriesWithEmail(
    finalized,
    fallback.filter((p) => p.price_date > (finalized[finalized.length - 1]?.price_date ?? "")),
  )
  console.log("\ndetail merge simulation tail:")
  for (const r of mergedWithFallback.filter((row) => row.price_date >= "2026-05-25")) {
    console.log(
      r.price_date,
      "unit", r.nav,
      "cum", r.cum_nav_withdrawal,
      "adj", r.cumulative_nav,
      "chg", r.price_change,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
