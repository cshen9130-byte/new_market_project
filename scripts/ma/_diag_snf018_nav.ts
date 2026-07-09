import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { loadPrivateFundLegacyNavRows, loadEmailNavSeries, mergeNavSeriesWithEmail } =
    await import("@/lib/server/email-nav-query")
  const merged = mergeNavSeriesWithEmail(
    await loadPrivateFundLegacyNavRows("SNF018", "钜融添宝20号私募证券投资基金"),
    await loadEmailNavSeries("SNF018", "钜融添宝20号私募证券投资基金"),
  )
  const r = merged.find((x) => x.price_date === "2026-07-07")
  const ratio =
    r?.cum_nav_withdrawal && r?.cumulative_nav
      ? (parseFloat(r.cumulative_nav) / parseFloat(r.cum_nav_withdrawal)).toFixed(4)
      : ""
  console.log("2026-07-07", r?.nav, r?.cum_nav_withdrawal, r?.cumulative_nav, ratio)
}

main()
