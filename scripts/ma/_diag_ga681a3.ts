import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { mergeLegacyWithTeamNav, mergeNavSeriesWithEmail } = await import(
    "../../lib/server/email-nav-query"
  )
  const { loadPrivateFundLegacyNavRows } = await import("../../lib/server/email-nav-query")
  const { loadManagedProductEmailPoints, loadManagedProductNavSeries } = await import(
    "../../lib/server/team-nav-manage-pg"
  )

  const legacy = await loadPrivateFundLegacyNavRows(
    "GA681A",
    "集微投资2期私募证券投资基金A类份额",
    "集微投资2期A类",
    { excludeType6: true },
  )
  console.log("legacy n=", legacy.length, "tip", legacy.at(-1))

  const points = await loadManagedProductEmailPoints({
    beian_hao: "GA681A",
    product_name: "集微投资2期私募证券投资基金A类份额",
    short_name: "集微投资2期A类",
  })
  console.log("points:")
  for (const p of points) console.log(JSON.stringify(p))

  const teamSeries = await loadManagedProductNavSeries({
    beian_hao: "GA681A",
    product_name: "集微投资2期私募证券投资基金A类份额",
    short_name: "集微投资2期A类",
  })
  console.log("\nteamSeries (isolated):")
  for (const r of teamSeries) {
    const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal||""), a = parseFloat(r.cumulative_nav||"")
    console.log(`${r.price_date} u=${u} c=${c} a=${a} a/c=${c? (a/c).toFixed(4):"?"}`)
  }

  const merged = mergeLegacyWithTeamNav(legacy, teamSeries, {
    beian_hao: "GA681A",
    product_name: "集微投资2期私募证券投资基金A类份额",
    short_name: "集微投资2期A类",
  })
  console.log("\nmerged around Jun:")
  for (const r of merged) {
    if (r.price_date < "2026-05-20" || r.price_date > "2026-07-15") continue
    const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal||""), a = parseFloat(r.cumulative_nav||"")
    console.log(`${r.price_date} u=${u} c=${c} a=${a} a/c=${c?(a/c).toFixed(6):"?"} pc=${r.price_change}`)
  }

  // Also try merge with RAW team points (not pre-finalized), clearing adj
  const rawTeam = points.map((p) => ({
    price_date: p.price_date,
    nav: String(p.nav),
    cum_nav_withdrawal: String(p.cumulative_nav ?? p.nav),
    cumulative_nav: p.adjusted_nav && parseFloat(p.adjusted_nav) > parseFloat(String(p.cumulative_nav)) + 0.001
      ? String(p.adjusted_nav)
      : "",
    price_change: "",
  }))
  console.log("\nrawTeam prepared:")
  for (const r of rawTeam) console.log(JSON.stringify(r))
  const merged2 = mergeLegacyWithTeamNav(legacy, rawTeam as any, {
    beian_hao: "GA681A",
    product_name: "集微投资2期私募证券投资基金A类份额",
  })
  console.log("\nmerged2 around Jun:")
  for (const r of merged2) {
    if (r.price_date < "2026-05-20" || r.price_date > "2026-07-15") continue
    const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal||""), a = parseFloat(r.cumulative_nav||"")
    console.log(`${r.price_date} u=${u} c=${c} a=${a} a/c=${c?(a/c).toFixed(6):"?"}`)
  }
  console.log("\nmerged2 tip", merged2.at(-1))
}
main().catch((e) => { console.error(e); process.exit(1) })
