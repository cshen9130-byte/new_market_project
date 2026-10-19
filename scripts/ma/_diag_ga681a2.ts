import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { writeFileSync } from "fs"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const lines: string[] = []
  const push = (s: string) => { lines.push(s); console.log(s) }

  // Full team manual
  const team = await query(
    `SELECT nav_date::text, unit_nav::text, cumulative_nav::text, adjusted_nav::text, nav_type
     FROM ops_team_nav_manual WHERE beian_hao='GA681A' ORDER BY nav_date`
  )
  push(`team count=${(team as any[]).length}`)
  push("team first 5:")
  for (const r of (team as any[]).slice(0, 5)) push(JSON.stringify(r))
  push("team around 2026-03:")
  for (const r of team as any[]) {
    if (r.nav_date >= "2026-03-01" && r.nav_date <= "2026-04-15") push(JSON.stringify(r))
  }
  push("team last 10:")
  for (const r of (team as any[]).slice(-10)) push(JSON.stringify(r))

  // group full range summary + samples
  const grp = await query(
    `SELECT count(*)::text c, min(price_date)::text mn, max(price_date)::text mx FROM private_fund_nav_group WHERE beian_hao='GA681A'`
  )
  push(`\ngroup summary: ${JSON.stringify(grp[0])}`)
  const grpTail = await query(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
     FROM private_fund_nav_group WHERE beian_hao='GA681A' ORDER BY price_date DESC LIMIT 5`
  )
  push("group tail:")
  for (const r of grpTail as any[]) push(JSON.stringify(r))
  const grpMar = await query(
    `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
     FROM private_fund_nav_group WHERE beian_hao='GA681A' AND price_date BETWEEN '2026-03-01' AND '2026-04-05' ORDER BY price_date`
  )
  push("group Mar:")
  for (const r of grpMar as any[]) push(JSON.stringify(r))

  // Compare gaps
  push("\n=== gap analysis team ===")
  for (const r of (team as any[]).slice(-5)) {
    const u = parseFloat(r.unit_nav), c = parseFloat(r.cumulative_nav)
    push(`${r.nav_date} unit=${u} cum=${c} gap=${(c-u).toFixed(6)}`)
  }
  push("=== gap analysis group ===")
  for (const r of grpTail as any[]) {
    const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal), a = parseFloat(r.cumulative_nav)
    push(`${r.price_date} unit=${u} cum=${c} adj=${a} gap=${(c-u).toFixed(6)} adj/cum=${(a/c).toFixed(6)}`)
  }

  // Cache tip + last few series points + find 1.7625
  const cache = await query(
    `SELECT tip_nav_date::text, tip_unit_nav::text, nav_data_source, refreshed_at::text,
            nav_series
     FROM ops_private_fund_detail_nav_cache WHERE cache_key='GA681A'`
  )
  const series = (cache[0] as any).nav_series as any[]
  push(`\ncache tip=${(cache[0] as any).tip_nav_date} unit=${(cache[0] as any).tip_unit_nav} src=${(cache[0] as any).nav_data_source} n=${series.length}`)
  push("cache last 8:")
  for (const r of series.slice(-8)) {
    push(`${r.price_date} nav=${r.nav} cum_w=${r.cum_nav_withdrawal} adj=${r.cumulative_nav}`)
  }
  push("cache looking for 1.7625 / 2026-03-20:")
  for (const r of series) {
    if (r.price_date === "2026-03-20" || String(r.nav).startsWith("1.7625") || String(r.nav).startsWith("1.762")) {
      push(`${r.price_date} nav=${r.nav} cum_w=${r.cum_nav_withdrawal} adj=${r.cumulative_nav}`)
    }
  }
  // also check around dividend jumps in cache
  push("\ncache adj/cum samples (every ~50 rows near end + early):")
  const idxs = [0, 50, 100, 150, 200, 250, 300, 350, series.length - 1]
  for (const i of idxs) {
    if (i < 0 || i >= series.length) continue
    const r = series[i]
    const u = parseFloat(r.nav), c = parseFloat(r.cum_nav_withdrawal || r.nav), a = parseFloat(r.cumulative_nav || r.nav)
    push(`[${i}] ${r.price_date} u=${u} c=${c} a=${a} a>=c>=u=${a>=c && c>=u}`)
  }

  // Find where adj ratio collapses
  push("\n=== adj/cum ratio changes ===")
  let prevRatio = 0
  for (let i = 1; i < series.length; i++) {
    const r = series[i]
    const prev = series[i - 1]
    const c = parseFloat(r.cum_nav_withdrawal || r.nav)
    const a = parseFloat(r.cumulative_nav || r.nav)
    const pc = parseFloat(prev.cum_nav_withdrawal || prev.nav)
    const pa = parseFloat(prev.cumulative_nav || prev.nav)
    if (c <= 0 || pc <= 0) continue
    const ratio = a / c
    const pr = pa / pc
    if (Math.abs(ratio - pr) > 0.02 || (a < c - 0.0001)) {
      push(`SHIFT ${prev.price_date}->${r.price_date}: prev a/c=${pr.toFixed(4)} (${pa}/${pc}) new a/c=${ratio.toFixed(4)} (${a}/${c}) u=${r.nav}`)
    }
  }

  // Live merge
  push("\n=== live loadMergedFundNavRows ===")
  try {
    const merged = await loadMergedFundNavRows({ beianHao: "GA681A", productName: "集微投资2期A类" })
    push(`merged n=${merged.length}`)
    for (const r of merged.slice(-8) as any[]) {
      push(`${r.price_date} nav=${r.nav} cum_w=${r.cum_nav_withdrawal} adj=${r.cumulative_nav}`)
    }
  } catch (e: any) {
    push("merge err: " + e.message + "\n" + e.stack)
  }

  writeFileSync("scripts/ma/_diag_ga681a_merge.txt", lines.join("\n"), "utf8")
}
main().catch((e) => { console.error(e); process.exit(1) })
