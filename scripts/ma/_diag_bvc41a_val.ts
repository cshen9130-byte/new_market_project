import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { writeFileSync } from "fs"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { BatchNavResolver, enrichReturnNavSeries } = await import(
    "../../lib/server/list-cache-nav-batch"
  )
  const { loadManagedUnderlyingNavHistoryIncremental, resolveManagedUnderlyingValuationNav, loadManagedUnderlyingValuationNavLookup } = await import(
    "../../lib/server/managed-fof-underlying-pg"
  )
  const lines: string[] = []

  const vh = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text
     FROM ops_fof_underlying_valuation_nav_history
     WHERE beian_hao IN ('BVC41A','BVC41','AVF39A','AGT37A')
        OR product_name ILIKE '%泰来%'
     ORDER BY product_name, nav_date DESC`,
  )
  lines.push(`valuation_nav_history: ${vh.length}`)
  for (const r of vh.slice(0, 40)) lines.push(JSON.stringify(r))

  const managed = await query(
    `SELECT fof_product_code, fof_product_name, underlying_product_code, underlying_name,
            valuation_date::text, price::text, unit_nav::text, nav_date::text, price_change::text
     FROM ops_managed_fof_underlying
     WHERE underlying_product_code IN ('BVC41A','BVC41')
        OR underlying_name ILIKE '%泰来三号%'
        OR subject_code ILIKE '%BVC41%'
     ORDER BY valuation_date DESC NULLS LAST
     LIMIT 30`,
  )
  lines.push(`\nmanaged_fof_underlying: ${managed.length}`)
  for (const r of managed) lines.push(JSON.stringify(r))

  const id = {
    beian_hao: "BVC41A",
    product_name: "棕榈滩泰来三号A类",
    short_name: null as string | null,
  }
  const resolver = await BatchNavResolver.create([id], "2026-07-27")
  const histBefore = await loadManagedUnderlyingNavHistoryIncremental("2025-06-22", [
    "BVC41A",
    "棕榈滩泰来三号A类",
    "棕榈滩泰来三号",
  ])
  resolver.setValuationNavHistory(histBefore.byCode, histBefore.byName)

  const latest = resolver.resolveAt(id, "2026-07-27")
  const daily = resolver.calcDailyReturnPct(id, latest!.nav, latest!.nav_date, null)
  lines.push(`\nresolveAfterVal ${JSON.stringify(latest)}`)
  lines.push(`daily ${daily} (${daily != null ? (daily * 100).toFixed(2) + "%" : null})`)

  const hist = enrichReturnNavSeries(resolver.mergedHistory(id, "2026-07-01"))
  lines.push("mergedHistory display:")
  for (const p of hist.filter((x) => x.nav_date >= "2026-07-15")) {
    lines.push(`${p.nav_date} nav=${p.nav} rn=${p.return_nav} src=${p.source}`)
  }

  const lookup = await loadManagedUnderlyingValuationNavLookup()
  const valNav = resolveManagedUnderlyingValuationNav("棕榈滩泰来三号A类", "BVC41A", lookup)
  lines.push(`\nvalNavLookup ${JSON.stringify(valNav)}`)

  writeFileSync("scripts/ma/_diag_bvc41a_val.txt", lines.join("\n"), "utf8")
  console.log("ok")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
