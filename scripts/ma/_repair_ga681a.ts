import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { writeFileSync } from "fs"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { findNavInvariantViolations } = await import("../../lib/server/email-nav-query")
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const {
    invalidateDetailNavCache,
    refreshDetailNavCacheForFund,
  } = await import("../../lib/server/fund-detail-nav-cache-pg")

  const lines: string[] = []
  const push = (s: string) => { lines.push(s); console.log(s) }

  // Ensure adjusted_nav null so isolated path doesn't keep wrong stored adj
  await query(`UPDATE ops_team_nav_manual SET adjusted_nav = NULL WHERE beian_hao='GA681A'`)
  push("reset team adjusted_nav to NULL")

  const beforeTeam = await query(
    `SELECT nav_date::text, unit_nav::text, cumulative_nav::text, adjusted_nav::text
     FROM ops_team_nav_manual WHERE beian_hao='GA681A' ORDER BY nav_date`
  )
  writeFileSync("scripts/ma/_backup_ga681a_team.json", JSON.stringify(beforeTeam, null, 2), "utf8")

  const merged = await loadMergedFundNavRows(
    "GA681A",
    "集微投资2期私募证券投资基金A类份额",
    "集微投资2期A类",
  )
  push(`merged n=${merged.length}`)

  for (const d of ["2026-03-20", "2026-05-29", "2026-06-05", "2026-06-18", "2026-06-26", "2026-09-24"]) {
    const r = (merged as any[]).find((x) => x.price_date === d)
    if (!r) { push(`missing ${d}`); continue }
    const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal), a = parseFloat(r.cumulative_nav)
    push(`${d} u=${u} c=${c} a=${a} a/c=${(a/c).toFixed(6)} ok=${a+1e-6>=c && c+1e-6>=u}`)
  }

  const may29 = (merged as any[]).find((r) => r.price_date === "2026-05-29")
  const jun05 = (merged as any[]).find((r) => r.price_date === "2026-06-05")
  const jun26 = (merged as any[]).find((r) => r.price_date === "2026-06-26")
  const tip = (merged as any[]).at(-1)
  const r0 = parseFloat(may29.cumulative_nav) / parseFloat(may29.cum_nav_withdrawal)
  const r1 = parseFloat(jun05.cumulative_nav) / parseFloat(jun05.cum_nav_withdrawal)
  const r2 = parseFloat(jun26.cumulative_nav) / parseFloat(jun26.cum_nav_withdrawal)
  const rt = parseFloat(tip.cumulative_nav) / parseFloat(tip.cum_nav_withdrawal)
  push(`ratios may29=${r0.toFixed(6)} jun05=${r1.toFixed(6)} jun26=${r2.toFixed(6)} tip=${rt.toFixed(6)}`)
  if (Math.abs(r0 - r1) > 0.01 || Math.abs(r0 - r2) > 0.01 || Math.abs(r0 - rt) > 0.01) {
    push("ERROR: adj/cum ratio not preserved")
    writeFileSync("scripts/ma/_repair_ga681a_out.txt", lines.join("\n"), "utf8")
    process.exit(1)
  }
  push("OK ratio preserved through tip")

  const viol = findNavInvariantViolations(merged as any)
  push(`invariant violations: ${viol.length}`)
  if (viol.length) {
    for (const v of viol.slice(0, 5)) push(JSON.stringify(v))
    process.exit(1)
  }

  // Write correct adjusted_nav
  const byDate = new Map((merged as any[]).map((r) => [r.price_date.slice(0, 10), r]))
  let updated = 0
  for (const t of beforeTeam as any[]) {
    const row = byDate.get(String(t.nav_date).slice(0, 10))
    if (!row?.cumulative_nav) continue
    await query(
      `UPDATE ops_team_nav_manual
       SET adjusted_nav = $3::numeric
       WHERE beian_hao = 'GA681A' AND nav_date = $1::date AND unit_nav = $2::numeric`,
      [t.nav_date, t.unit_nav, row.cumulative_nav],
    )
    updated++
  }
  push(`updated adjusted_nav on ${updated} team rows`)

  const afterTeam = await query(
    `SELECT nav_date::text, unit_nav::text, cumulative_nav::text, adjusted_nav::text
     FROM ops_team_nav_manual WHERE beian_hao='GA681A' ORDER BY nav_date`
  )
  push("sample team after:")
  for (const r of (afterTeam as any[]).filter((x) =>
    ["2026-06-05", "2026-06-26", "2026-09-24"].includes(String(x.nav_date).slice(0, 10))
  )) push(JSON.stringify(r))

  const deleted = await invalidateDetailNavCache(["GA681A"])
  push(`invalidated cache: ${deleted}`)
  const ok = await refreshDetailNavCacheForFund({
    beian_hao: "GA681A",
    product_name: "集微投资2期私募证券投资基金A类份额",
    short_name: "集微投资2期A类",
    nav_data_source: "team",
  })
  push(`refresh cache: ${ok}`)

  const cacheFull = await query(
    `SELECT tip_nav_date::text, tip_unit_nav::text, refreshed_at::text, nav_series
     FROM ops_private_fund_detail_nav_cache WHERE cache_key='GA681A'`
  )
  const series = (cacheFull[0] as any).nav_series as any[]
  push(`cache tip=${(cacheFull[0] as any).tip_nav_date} unit=${(cacheFull[0] as any).tip_unit_nav} n=${series.length} refreshed=${(cacheFull[0] as any).refreshed_at}`)
  for (const d of ["2026-03-20", "2026-05-29", "2026-06-05", "2026-06-26", "2026-09-24"]) {
    const r = series.find((x) => x.price_date === d)
    if (!r) { push(`cache missing ${d}`); continue }
    const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal), a = parseFloat(r.cumulative_nav)
    push(`cache ${d} u=${u} c=${c} a=${a} a/c=${(a/c).toFixed(6)}`)
  }

  // BEFORE/AFTER summary for report
  push("\n=== BEFORE (broken tip) ===")
  push("2026-09-24 unit=1.8601 cum=2.5861 adj=2.6155 (a/c~1.011)")
  push("2026-05-29→06-05 adj cliff 3.3007→~2.52")
  push("\n=== AFTER ===")
  push(`2026-09-24 unit=${tip.nav} cum=${tip.cum_nav_withdrawal} adj=${tip.cumulative_nav} (a/c=${rt.toFixed(6)})`)
  push(`2026-05-29 adj=${may29.cumulative_nav} → 2026-06-05 adj=${jun05.cumulative_nav}`)

  writeFileSync("scripts/ma/_repair_ga681a_out.txt", lines.join("\n"), "utf8")
}
main().catch((e) => { console.error(e); process.exit(1) })
