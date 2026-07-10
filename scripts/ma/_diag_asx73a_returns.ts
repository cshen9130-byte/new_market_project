import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  BatchNavResolver,
  RETURN_OFFSETS,
  calendarDaysBetween,
  calcReturn,
  isSameShareClassNavLevel,
} from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

const BEIAN = "ASX73A"
const NAME = "六妙星豪鑫3号A类"

function navForReturn(p: { nav: number; return_nav?: number } | null, fallback?: number): number | null {
  if (!p) return fallback ?? null
  const v = p.return_nav ?? p.nav
  return Number.isFinite(v) && v > 0 ? v : (fallback ?? null)
}

async function main() {
  const cache = await query(
    `SELECT unit_nav::text, nav_date::text, ret_1m::text, ret_3m::text, ret_1y::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [BEIAN],
  )
  console.log("cache:", cache[0])

  const identity = { beian_hao: BEIAN, product_name: NAME, short_name: null }
  const asOf = process.argv[2] ?? "2026-07-10"
  const resolver = await BatchNavResolver.create([identity], asOf)
  const latest = resolver.resolveAt(identity, asOf)
  console.log("\nlatest resolveAt:", latest)

  if (!latest) return

  const returns = resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
  console.log("\ncalcPeriodReturns:", returns)

  for (const { key, days } of RETURN_OFFSETS) {
    const base = (resolver as unknown as { resolvePeriodBase: Function }).resolvePeriodBase(
      identity,
      latest.nav_date,
      days,
      navForReturn(latest, latest.nav) ?? latest.nav,
    )
    const latestR = navForReturn(latest, latest.nav)
    const baseR = navForReturn(base)
    console.log(`\n${key} (${days}d):`, {
      latestR,
      baseDate: base?.nav_date,
      baseNav: base?.nav,
      baseReturnNav: base?.return_nav,
      baseR,
      sameClass: latestR != null && baseR != null ? isSameShareClassNavLevel(latestR, baseR) : null,
      ret: calcReturn(latestR, baseR),
      gap: base ? calendarDaysBetween(latest.nav_date, base.nav_date) : null,
    })
  }

  const history = resolver.mergedHistory(identity, "2025-06-01")
  console.log("\nmergedHistory sample (every 10th):", history.filter((_, i) => i % 10 === 0).slice(0, 15))

  const riskHistory = resolver.mergedHistoryForRiskMetrics(identity, "2025-06-01")
  console.log("\nriskHistory tail:", riskHistory.slice(-8).map((p) => ({
    d: p.nav_date,
    nav: p.nav,
    return_nav: p.return_nav,
  })))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
