import { loadProjectEnvFiles } from "../../lib/server/load-project-env.ts"
loadProjectEnvFiles()

async function main() {
  const { loadEmailNavSeries, mergeNavSeriesWithEmail } = await import("@/lib/server/email-nav-query")
  const email = await loadEmailNavSeries("SBPC20", "六妙星九紫一号私募证券投资基金")
  const merged = mergeNavSeriesWithEmail([], email)

  console.log("email selected Jul:")
  for (const r of email.filter((x) => x.price_date >= "2026-06-01")) {
    console.log(r.price_date, "nav", r.nav, "cum", r.cumulative_nav, "adj", r.adjusted_nav)
  }

  console.log("\nmerged Jul:")
  for (const r of merged.filter((x) => x.price_date >= "2026-06-01")) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cum_nav_withdrawal, "adj", r.cumulative_nav)
  }
}

main()
