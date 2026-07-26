/**
 * Diagnose 金舆基石一号 (SAVW72) period returns on FOF底层.
 *
 *   npx tsx scripts/ma/_diag_savw72_returns.ts [asOf=2026-07-26]
 */
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

const BEIAN = "SAVW72"
const NAME = "金舆基石一号"

function navForReturn(
  p: { nav: number; return_nav?: number } | null,
  fallback?: number,
): number | null {
  if (!p) return fallback ?? null
  const v = p.return_nav ?? p.nav
  return Number.isFinite(v) && v > 0 ? v : (fallback ?? null)
}

async function main() {
  const asOf = process.argv[2] ?? "2026-07-26"

  const cache = await query(
    `SELECT beian_hao, product_name, unit_nav::text, nav_date::text,
            return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao = $1 OR product_name ILIKE '%金舆基石%'`,
    [BEIAN],
  )
  console.log("fof cache:", cache)

  const email = await query(
    `SELECT nav_date::text, nav::text, cumulative_nav::text, product_code, fund_name,
            left(subject, 100) AS subject, source
     FROM ops_email_nav_records
     WHERE product_code = $1
        OR fund_name ILIKE '%金舆基石%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 25`,
    [BEIAN],
  )
  console.log("\nemail nav rows:", email)

  const identity = { beian_hao: BEIAN, product_name: NAME, short_name: null as string | null }
  const resolver = await BatchNavResolver.create([identity], asOf)
  const latest = resolver.resolveAt(identity, asOf)
  console.log("\nlatest resolveAt:", latest)
  if (!latest) return

  const returns = resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
  console.log("\ncalcPeriodReturns:", returns)

  const riskHistory = resolver.mergedHistoryForRiskMetrics(identity, "2026-05-01")
  console.log(
    "\nriskHistory tail:",
    riskHistory.slice(-20).map((p) => ({
      d: p.nav_date,
      nav: p.nav,
      return_nav: p.return_nav,
      source: p.source,
    })),
  )

  for (const { key, days } of RETURN_OFFSETS) {
    const base = resolver.resolvePeriodBase(
      identity,
      latest.nav_date,
      days,
      navForReturn(latest, latest.nav) ?? latest.nav,
    )
    const latestR = navForReturn(
      riskHistory.filter((p) => p.nav_date <= latest.nav_date).at(-1) ?? latest,
      latest.nav,
    )
    const baseR = navForReturn(base)
    console.log(`\n${key} (${days}d):`, {
      latestR,
      baseDate: base?.nav_date,
      baseNav: base?.nav,
      baseReturnNav: base?.return_nav,
      baseR,
      sameClassLoose: latestR != null && baseR != null ? isSameShareClassNavLevel(latestR, baseR) : null,
      sameClassWindow:
        latestR != null && baseR != null ? isSameShareClassNavLevel(latestR, baseR, days) : null,
      ret: calcReturn(latestR, baseR),
      gap: base ? calendarDaysBetween(latest.nav_date, base.nav_date) : null,
    })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
