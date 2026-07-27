import { writeFileSync } from "fs"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { BatchNavResolver, enrichReturnNavSeries } = await import(
    "../../lib/server/list-cache-nav-batch"
  )
  const { loadManagedUnderlyingNavHistory } = await import(
    "../../lib/server/managed-fof-underlying-pg"
  )
  const lines: string[] = []

  const holdings = await query(
    `SELECT valuation_date::text, underlying_product_code, underlying_name,
            unit_nav::text, price::text, fof_product_code, fof_product_name
     FROM ops_managed_fof_underlying
     WHERE (underlying_name ILIKE '%泰来三号%' OR underlying_product_code ILIKE '%BVC41%')
       AND valuation_date >= '2026-07-15'
     ORDER BY valuation_date DESC, fof_product_code
     LIMIT 50`,
  )
  lines.push(`holdings=${holdings.length}`)
  for (const r of holdings) lines.push(JSON.stringify(r))

  const vh = await query(
    `SELECT nav_date::text, unit_nav::text, product_name, beian_hao
     FROM ops_fof_underlying_valuation_nav_history
     WHERE beian_hao ILIKE '%BVC41%' OR product_name ILIKE '%泰来三号%'
     ORDER BY nav_date DESC
     LIMIT 20`,
  ).catch((e) => [{ err: String(e) }])
  lines.push(`\nvh=${vh.length}`)
  for (const r of vh) lines.push(JSON.stringify(r))

  // Direct price from valuation holdings for 泰来三号
  const vhCols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'ops_email_valuation_records' ORDER BY ordinal_position`,
  )
  lines.push(`\nval records cols: ${vhCols.map((c: { column_name: string }) => c.column_name).join(",")}`)

  const prices = await query(
    `SELECT r.valuation_date::text, h.price::text, h.subject_name, h.subject_code, h.symbol,
            r.product_code AS fof_code
     FROM ops_email_valuation_holdings h
     JOIN ops_email_valuation_records r ON r.id = h.valuation_record_id
     WHERE (h.subject_name ILIKE '%泰来三号%' OR h.subject_code ILIKE '%BVC41%' OR h.symbol ILIKE '%BVC41%')
       AND r.valuation_date >= '2026-07-15'
     ORDER BY r.valuation_date DESC
     LIMIT 40`,
  )
  lines.push(`\nval prices=${prices.length}`)
  for (const r of prices) lines.push(JSON.stringify(r))

  const targets = [
    { product_name: "棕榈滩泰来三号A类", beian_hao: "BVC41A" },
    { product_name: "棕榈滩泰来A类", beian_hao: "AVF39A" },
    { product_name: "棕榈滩泰来四号私募证券投资基金A类", beian_hao: "AGT37A" },
  ]
  const hist = await loadManagedUnderlyingNavHistory("2026-07-01", {
    targets,
    skipSymbolBackfill: true,
  })

  const id = {
    beian_hao: "BVC41A",
    product_name: "棕榈滩泰来三号A类",
    short_name: null as string | null,
  }
  const resolver = await BatchNavResolver.create(
    targets.map((t) => ({ ...t, short_name: null })),
    "2026-07-27",
  )
  resolver.setValuationNavHistory(hist.byCode, hist.byName)

  for (const k of ["BVC41A", "BVC41", "BVE414"]) {
    const pts = hist.byCode.get(k) ?? []
    lines.push(`\nval byCode ${k}: ${pts.length}`)
    for (const p of pts.filter((x) => x.nav_date >= "2026-07-15")) {
      lines.push(`${p.nav_date} nav=${p.nav}`)
    }
  }
  for (const name of ["棕榈滩泰来三号A类", "棕榈滩泰来三号"]) {
    const pts = hist.byName.get(name) ?? []
    lines.push(`\nval byName ${name}: ${pts.length}`)
    for (const p of pts.filter((x) => x.nav_date >= "2026-07-15")) {
      lines.push(`${p.nav_date} nav=${p.nav}`)
    }
  }

  const merged = enrichReturnNavSeries(resolver.mergedHistory(id, "2026-07-01"))
  lines.push("\nMERGED with valuation:")
  for (const p of merged.filter((x) => x.nav_date >= "2026-07-15")) {
    lines.push(`${p.nav_date} nav=${p.nav} rn=${p.return_nav}`)
  }
  const latest = resolver.resolveAt(id, "2026-07-27")
  lines.push(`latest=${JSON.stringify(latest)}`)
  lines.push(
    `daily=${resolver.calcDailyReturnPct(id, latest!.nav, latest!.nav_date, null)}`,
  )

  writeFileSync("scripts/ma/_diag_bvc41a_val2.txt", lines.join("\n"), "utf8")
  console.log("wrote", lines.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
