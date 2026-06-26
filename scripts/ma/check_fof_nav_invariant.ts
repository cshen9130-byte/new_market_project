/**
 * Verify adj >= cum >= unit for every FOF底层 fund detail series.
 * Usage: npx tsx scripts/ma/check_fof_nav_invariant.ts
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { query } = await import("@/lib/db")
  const {
    findNavInvariantViolations,
    loadEmailNavSeries,
    loadPrivateFundLegacyNavRows,
    mergeNavSeriesWithEmail,
  } = await import("@/lib/server/email-nav-query")

  const products = await query<{ id: string; product_name: string; beian_hao: string | null }>(
    `SELECT f.id::text AS id, f.product_name,
            COALESCE(cache.beian_hao, f.product_name) AS beian_hao
     FROM fof_underlying_summary f
     LEFT JOIN ops_fof_overview_list_cache cache ON cache.fof_underlying_id = f.id
     WHERE f.product_name <> '合计'
     ORDER BY f.sequence_no NULLS LAST, f.id`,
  )

  let failed = 0
  for (const p of products) {
    const beian = (p.beian_hao ?? "").trim() || p.product_name
    const legacy = await loadPrivateFundLegacyNavRows(beian, p.product_name, p.product_name).catch(() => [])
    const email = await loadEmailNavSeries(beian, p.product_name, p.product_name, [p.product_name]).catch(() => [])
    const merged = mergeNavSeriesWithEmail(legacy, email)
    const violations = findNavInvariantViolations(merged)
    if (violations.length === 0) continue

    failed++
    console.error(`\nFAIL ${p.product_name} (${beian}) — ${violations.length} violation(s):`)
    for (const v of violations.slice(-5)) {
      console.error(
        `  ${v.price_date}: unit=${v.nav.toFixed(4)} cum=${v.cum_nav_withdrawal.toFixed(4)} adj=${v.cumulative_nav.toFixed(4)}`,
      )
    }
  }

  if (failed === 0) {
    console.log(`OK — all ${products.length} FOF底层 funds satisfy adj >= cum >= unit`)
  } else {
    console.error(`\n${failed}/${products.length} funds failed`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
