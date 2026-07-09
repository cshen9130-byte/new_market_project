import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
loadProjectEnvFiles()

async function main() {
  const { loadPrivateFundLegacyNavRows, loadEmailNavSeries, mergeNavSeriesWithEmail } =
    await import("../../lib/server/email-nav-query.ts")

  const legacy = await loadPrivateFundLegacyNavRows("SBPC20", "六妙星九紫一号私募证券投资基金", "六妙星九紫一号")
  const email = await loadEmailNavSeries("SBPC20", "六妙星九紫一号私募证券投资基金")
  const nav_series = mergeNavSeriesWithEmail(legacy, email)

  console.log("legacy", legacy.length, "email", email.length)
  for (const r of nav_series.filter((x) => x.price_date >= "2026-06-28")) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }
  const latest = nav_series.at(-1)
  console.log("\nlatest:", latest?.nav, latest?.cum_nav_withdrawal, latest?.cumulative_nav)
}

main()
