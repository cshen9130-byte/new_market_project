import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  await query(`UPDATE ops_team_nav_manual SET adjusted_nav = NULL WHERE beian_hao='GA681A'`)
  console.log("cleared adjusted_nav")

  const { mergeLegacyWithTeamNav } = await import("../../lib/server/email-nav-query")
  const { loadPrivateFundLegacyNavRows } = await import("../../lib/server/email-nav-query")

  const manual = await query(
    `SELECT nav_date::text, unit_nav::text, cumulative_nav::text
     FROM ops_team_nav_manual WHERE beian_hao='GA681A' AND nav_type='pre_fee' ORDER BY nav_date`
  )
  const rawTeam = (manual as any[]).map((row) => ({
    price_date: row.nav_date.slice(0, 10),
    nav: row.unit_nav,
    cum_nav_withdrawal: row.cumulative_nav ?? row.unit_nav,
    cumulative_nav: "",
    price_change: "",
  }))

  const legacy = await loadPrivateFundLegacyNavRows(
    "GA681A",
    "集微投资2期私募证券投资基金A类份额",
    "集微投资2期A类",
    { excludeType6: true },
  )

  const merged = mergeLegacyWithTeamNav(legacy, rawTeam as any, {
    beian_hao: "GA681A",
    product_name: "集微投资2期私募证券投资基金A类份额",
  })
  console.log("merged May-Jul:")
  for (const r of merged) {
    if (r.price_date < "2026-05-20" || r.price_date > "2026-07-15") continue
    const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal||""), a = parseFloat(r.cumulative_nav||"")
    console.log(`${r.price_date} u=${u} c=${c} a=${a} a/c=${(a/c).toFixed(6)}`)
  }
  const tip = merged.at(-1)!
  console.log("tip", tip.price_date, "u="+tip.nav, "c="+tip.cum_nav_withdrawal, "a="+tip.cumulative_nav)
}
main().catch((e) => { console.error(e); process.exit(1) })
