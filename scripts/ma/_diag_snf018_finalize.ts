import { loadProjectEnvFiles } from "@/lib/server/load-project-env"
loadProjectEnvFiles()

async function main() {
  const { loadPrivateFundLegacyNavRows, loadEmailNavSeries, mergeNavSeriesWithEmail } =
    await import("@/lib/server/email-nav-query")
  const legacy = await loadPrivateFundLegacyNavRows("SNF018", "钜融添宝20号私募证券投资基金")
  const email = await loadEmailNavSeries("SNF018", "钜融添宝20号私募证券投资基金")

  const throughJun1 = email.filter((r) => r.price_date <= "2026-06-01")
  console.log("email rows <= Jun1:", throughJun1.length, "first", throughJun1[0]?.price_date, "last", throughJun1.at(-1)?.price_date)

  const jun1Only = email.filter((r) => r.price_date === "2026-06-01")
  console.log("email rows == Jun1:", jun1Only.length)

  const m1 = mergeNavSeriesWithEmail(legacy, throughJun1)
  const m2 = mergeNavSeriesWithEmail(legacy, jun1Only)
  console.log("<=Jun1 May29", m1.find((r) => r.price_date === "2026-05-29")?.cumulative_nav)
  console.log("==Jun1 May29", m2.find((r) => r.price_date === "2026-05-29")?.cumulative_nav)

  // show email rows that overlap legacy dates in April-May
  const overlap = throughJun1.filter((r) => r.price_date >= "2026-04-01" && r.price_date <= "2026-05-29")
  console.log("\nemail overlapping legacy Apr-May:", overlap.length)
  for (const r of overlap.slice(0, 5)) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cumulative_nav, "adj", r.adjusted_nav)
  }
  for (const r of overlap.slice(-5)) {
    console.log(r.price_date, "unit", r.nav, "cum", r.cumulative_nav, "adj", r.adjusted_nav)
  }
}

main()
