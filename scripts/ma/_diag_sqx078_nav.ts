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
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
