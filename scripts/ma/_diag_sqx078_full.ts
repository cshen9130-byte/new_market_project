/**
 * Full SQX078 NAV diagnostic — legacy + email merge (detail page path).
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

async function main() {
  const BEIAN = "SQX078"
  const productName = "特夫郁金香全量化私募证券投资基金"
  const shortName = "特夫郁金香全量化"
  const {
    loadPrivateFundLegacyNavRows,
    loadEmailNavSeries,
    mergeNavSeriesWithEmail,
  } = await import("@/lib/server/email-nav-query")

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, productName, shortName)
  const email = await loadEmailNavSeries(BEIAN, productName, shortName)
  const merged = mergeNavSeriesWithEmail(legacy, email)

  console.log("legacy:", legacy.length, "email:", email.length, "merged:", merged.length)
  console.log("first:", merged[0])
  console.log("latest:", merged[merged.length - 1])

  const ratio = (r: (typeof merged)[0]) => {
    const cum = parseFloat(r.cum_nav_withdrawal)
    const adj = parseFloat(r.cumulative_nav)
    return cum > 0 ? adj / cum : NaN
  }

  console.log("\nadj/cum ratio samples:")
  for (const d of ["2021-07-02", "2022-01-01", "2023-01-01", "2024-01-01", "2024-12-31", "2025-06-01", "2025-12-31", "2026-05-29", "2026-07-15"]) {
    const r = merged.find((x) => x.price_date === d)
    if (r) {
      console.log(d, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav, "ratio", ratio(r).toFixed(6))
    }
  }

  console.log("\nemail tail:")
  for (const r of email.slice(-10)) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cumulative_nav, "adj", r.adjusted_nav)
  }

  console.log("\nmerged May-Jul:")
  for (const r of merged.filter((x) => x.price_date >= "2026-05-01")) {
    console.log(
      r.price_date,
      "unit", r.nav,
      "cum", r.cum_nav_withdrawal,
      "adj", r.cumulative_nav,
      "ratio", ratio(r).toFixed(6),
      "chg", r.price_change,
    )
  }

  // Large daily moves on adj
  console.log("\nlarge adj daily moves (|chg|>3%):")
  for (let i = 1; i < merged.length; i++) {
    const chg = parseFloat(merged[i].price_change)
    if (Math.abs(chg) > 3) {
      console.log(merged[i].price_date, "chg", chg.toFixed(2), "unit", merged[i].nav, "adj", merged[i].cumulative_nav)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
