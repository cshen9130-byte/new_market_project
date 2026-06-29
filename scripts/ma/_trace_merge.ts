import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { mergeNavSeriesWithEmail } = await import("@/lib/server/email-nav-query")

  const legacy = [
    { price_date: "2026-06-17", nav: "1.3184", cumulative_nav: "1.5204", cum_nav_withdrawal: "1.5284", price_change: "" },
    { price_date: "2026-06-18", nav: "1.3111", cumulative_nav: "1462545.11", cum_nav_withdrawal: "1.5211", price_change: "" },
    { price_date: "2026-06-22", nav: "1.2846", cumulative_nav: "1.5127", cum_nav_withdrawal: "1.5095", price_change: "" },
  ]
  const email = [{ price_date: "2026-06-22", nav: "1.2846", cumulative_nav: null }]
  const out = mergeNavSeriesWithEmail(legacy as never, email as never)
  console.log("MERGED OUTPUT:")
  for (const r of out) {
    console.log(`  ${r.price_date}  unit=${r.nav}  cum=${r.cum_nav_withdrawal}  adj=${r.cumulative_nav}  pct=${r.price_change}`)
  }
  const r22 = out.find((r) => r.price_date === "2026-06-22")!
  const r18 = out.find((r) => r.price_date === "2026-06-18")!
  const pct = (parseFloat(r22.cumulative_nav) / parseFloat(r18.cumulative_nav) - 1) * 100
  console.log(`\nadj_0622=${r22.cumulative_nav}  adj_0618=${r18.cumulative_nav}`)
  console.log(`pct (adj 0622 vs 0618) = ${pct.toFixed(4)}%  (test expects ~ -2.02%)`)

  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
