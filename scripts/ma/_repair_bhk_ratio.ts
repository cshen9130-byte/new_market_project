import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { BatchNavResolver } = await import("../../lib/server/list-cache-nav-batch")
  const { refreshFofOverviewListCache } = await import(
    "../../lib/server/fof-overview-list-cache-pg"
  )

  // Anchor: Jul-24 实际净值 1.0548 / 实际累计 1.6750 from TA body.
  // cumulative_nav on estimate rows is still 实际累计; scale nav back to 实际净值.
  const anchorNav = 1.0548
  const anchorCum = 1.675
  const ratio = anchorNav / anchorCum

  const rows = await query<{ id: string; nav_date: string; nav: string; cumulative_nav: string }>(
    `SELECT id::text, nav_date::text, nav::text, cumulative_nav::text
     FROM ops_email_nav_records
     WHERE product_code = 'BHK26A'
       AND subject ILIKE '%虚拟净值表现估算%'
       AND cumulative_nav IS NOT NULL
       AND cumulative_nav > 0
     ORDER BY nav_date, id`,
  )

  let updated = 0
  for (const r of rows) {
    const cum = parseFloat(r.cumulative_nav)
    const next = Number((cum * ratio).toFixed(6))
    if (!Number.isFinite(next) || next <= 0) continue
    if (Math.abs(parseFloat(r.nav) - next) < 1e-9) continue
    await query(`UPDATE ops_email_nav_records SET nav = $1 WHERE id = $2::bigint`, [next, r.id])
    updated++
  }
  console.log("scaled BHK26A estimate rows to 实际净值 via cum ratio:", updated)

  const id = { beian_hao: "BHK26A", product_name: "六妙星豪鑫6号A类", short_name: null as string | null }
  const resolver = await BatchNavResolver.create([id], "2026-07-27")
  const latest = resolver.resolveAt(id, "2026-07-27")
  const daily = resolver.calcDailyReturnPct(id, latest!.nav, latest!.nav_date, null)
  console.log("resolve", latest, "daily", daily, `(${((daily ?? 0) * 100).toFixed(2)}%)`)

  await refreshFofOverviewListCache({ reuseResolvedIdentities: true })
  const probe = await query(
    `SELECT beian_hao, nav_date::text, unit_nav::text, return_pct::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao IN ('BVC41A','AVF39A','AGT37A','BHK26A')
     ORDER BY beian_hao`,
  )
  for (const r of probe) {
    const ret = r.return_pct != null ? (parseFloat(r.return_pct) * 100).toFixed(2) + "%" : "null"
    console.log(`${r.beian_hao} ${r.nav_date} nav=${r.unit_nav} ret=${ret}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
