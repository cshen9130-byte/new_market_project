import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { loadPrivateFundLegacyNavRows } = await import("@/lib/server/email-nav-query")
  const legacy = await loadPrivateFundLegacyNavRows("SNF018", "钜融添宝20号私募证券投资基金")
  console.log("legacy count", legacy.length, "last", legacy.at(-1)?.price_date)
  const withRatio = legacy
    .map((r) => {
      const cum = parseFloat(r.cum_nav_withdrawal || r.cumulative_nav || "0")
      const adj = parseFloat(r.cumulative_nav || "0")
      return { date: r.price_date, ratio: cum > 0 ? adj / cum : 0, unit: r.nav, cum: r.cum_nav_withdrawal, adj: r.cumulative_nav }
    })
    .filter((x) => x.ratio > 1.001)
  console.log("last 5 good-ratio legacy:")
  for (const r of withRatio.slice(-5)) {
    console.log(r.date, "ratio", r.ratio.toFixed(4), "unit", r.unit, "cum", r.cum, "adj", r.adj)
  }
}

main()
