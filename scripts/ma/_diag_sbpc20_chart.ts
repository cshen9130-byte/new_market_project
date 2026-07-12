/**
 * Full SBPC20 chart-series diagnosis (API path).
 * Usage: npx tsx scripts/ma/_diag_sbpc20_chart.ts
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"
import { loadManualTeamNavBatch, loadManagedProductEmailPoints, loadManagedProductNavSeries } from "../../lib/server/team-nav-manage-pg"
import { lookupManagedProductOverride } from "../../lib/server/managed-product-beian"
import { loadManagedProductNavSeed, mergeManagedProductDetailNav } from "../../lib/server/managed-product-nav-seed"
import { mergeLegacyWithTeamNav } from "../../lib/server/email-nav-query"

loadProjectEnvFiles()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL!
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const BEIAN = "SBPC20"
const NAME = "六妙星九紫一号私募证券投资基金"
const SHORT = "六妙星九紫一号"

async function main() {
  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, NAME, SHORT)
  const email = await loadEmailNavSeries(BEIAN, NAME, SHORT, [])
  let series = mergeNavSeriesWithEmail(legacy, email)

  const managed = lookupManagedProductOverride(BEIAN) ?? lookupManagedProductOverride(NAME)
  const manual = await loadManualTeamNavBatch([BEIAN])
  console.log("managedOverride", managed)
  console.log("manualTeamNav rows", manual.get(BEIAN)?.length ?? 0)

  if (managed || (manual.get(BEIAN)?.length ?? 0) > 0) {
    const ov = managed ?? { beian_hao: BEIAN, product_name: NAME }
    const [teamEmail, teamSeries, seed] = await Promise.all([
      loadManagedProductEmailPoints({ beian_hao: ov.beian_hao, product_name: ov.product_name, short_name: SHORT }),
      loadManagedProductNavSeries({ beian_hao: ov.beian_hao, product_name: ov.product_name, short_name: SHORT }),
      Promise.resolve(loadManagedProductNavSeed(ov.beian_hao)),
    ])
    console.log("seed", seed.length, "teamEmail", teamEmail.length, "teamSeries", teamSeries.length)
    if (seed.length > 0) {
      const legacyNoType6 = await loadPrivateFundLegacyNavRows(BEIAN, NAME, SHORT, { excludeType6: true })
      series = mergeManagedProductDetailNav(seed, teamEmail, legacyNoType6)
      console.log("PATH: mergeManagedProductDetailNav")
    } else if (teamSeries.length > 0) {
      const legacyNoType6 = await loadPrivateFundLegacyNavRows(BEIAN, NAME, SHORT, { excludeType6: true })
      series = mergeLegacyWithTeamNav(mergeNavSeriesWithEmail(legacyNoType6, []), teamSeries)
      console.log("PATH: mergeLegacyWithTeamNav")
    }
  } else {
    console.log("PATH: mergeNavSeriesWithEmail (standard)")
  }

  // Find large daily moves (chart cliffs)
  console.log("\n=== daily |chg| > 5% ===")
  for (let i = 1; i < series.length; i++) {
    const chg = parseFloat(series[i].price_change)
    if (Number.isFinite(chg) && Math.abs(chg) > 5) {
      const p = series[i - 1]
      const c = series[i]
      console.log(
        c.price_date,
        "chg", chg.toFixed(2) + "%",
        "| prev", p.nav, p.cum_nav_withdrawal, p.cumulative_nav,
        "→", c.nav, c.cum_nav_withdrawal, c.cumulative_nav,
      )
    }
  }

  console.log("\n=== Jun 10 - Jul 09 ===")
  for (const r of series.filter((x) => x.price_date >= "2026-06-10" && x.price_date <= "2026-07-09")) {
    const unit = parseFloat(r.nav)
    const cum = parseFloat(r.cum_nav_withdrawal)
    const adj = parseFloat(r.cumulative_nav)
    console.log(
      r.price_date,
      "unit", unit.toFixed(4),
      "cum", cum.toFixed(4),
      "adj", adj.toFixed(4),
      "adj/cum", (adj / cum).toFixed(4),
      "chg", Number.isFinite(parseFloat(r.price_change)) ? (+parseFloat(r.price_change)).toFixed(2) + "%" : "",
    )
  }

  const first = series[0]
  const last = series[series.length - 1]
  const ret = parseFloat(last.cumulative_nav) / parseFloat(first.cumulative_nav) - 1
  console.log("\nfirst", first.price_date, first.nav, first.cum_nav_withdrawal, first.cumulative_nav)
  console.log("last", last.price_date, last.nav, last.cum_nav_withdrawal, last.cumulative_nav)
  console.log("ret_since_inception (adj)", (ret * 100).toFixed(2) + "%")
  console.log("ref platform: adj 1.4124, ret ~39.18%")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
