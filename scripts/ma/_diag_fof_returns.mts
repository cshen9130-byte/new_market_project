import { loadProjectEnvFiles, configureEtlDbTimeout } from "../../lib/server/load-project-env.ts"

loadProjectEnvFiles()
configureEtlDbTimeout()

const samples = [
  { name: "金和和善对冲1号", beian: "STA933" },
  { name: "乾上泉对冲一号B类", beian: "ALF51B" },
  { name: "奇盾抱朴专享1号", beian: "SSGD35" },
  { name: "木莲安澜1号A类", beian: "ATL22A" },
]

async function main() {
  const { query } = await import("../../lib/db.ts")
  const { addDays, BatchNavResolver } = await import("../../lib/server/list-cache-nav-batch.ts")
  const { loadManagedUnderlyingNavHistory } = await import("../../lib/server/managed-fof-underlying-pg.ts")
  const { fofUnderlyingNavLookupKeys } = await import("../../lib/server/fund-holding-code.ts")

  const asOf = new Date().toISOString().slice(0, 10)
  const since = addDays(asOf, -400)

  console.log("=== valuation holdings sample ===")
  for (const s of samples) {
    const rows = await query(
      `SELECT h.valuation_date::text, h.symbol, h.subject_code, h.price, h.quantity, h.market_value
       FROM ops_email_valuation_holdings h
       WHERE h.valuation_date >= $1::date
         AND (UPPER(h.symbol) = $2 OR h.subject_name ILIKE $3)
       ORDER BY h.valuation_date DESC
       LIMIT 8`,
      [since, s.beian, `%${s.name.slice(0, 4)}%`],
    )
    console.log(`\n${s.name} (${s.beian}): ${rows.length} holding rows`)
    for (const r of rows.slice(0, 5)) console.log(" ", r)
  }

  const history = await loadManagedUnderlyingNavHistory(since)
  console.log("\n=== history map keys / point counts ===")
  for (const s of samples) {
    const keys = fofUnderlyingNavLookupKeys(s.name, s.beian, null)
    const points = new Map<string, number>()
    for (const k of keys) {
      const codePts = history.byCode.get(k.toUpperCase()) ?? []
      const namePts = history.byName.get(k) ?? []
      if (codePts.length) points.set(`code:${k}`, codePts.length)
      if (namePts.length) points.set(`name:${k}`, namePts.length)
    }
    console.log(s.name, Object.fromEntries(points))
  }

  const resolver = await BatchNavResolver.create(
    samples.map((s) => ({ beian_hao: s.beian, product_name: s.name, short_name: null })),
    asOf,
  )
  resolver.setValuationNavHistory(history.byCode, history.byName)

  console.log("\n=== resolver returns ===")
  for (const s of samples) {
    const id = { beian_hao: s.beian, product_name: s.name, short_name: null }
    const latest = resolver.resolveAt(id, asOf)
    const navDate = latest?.nav_date ?? asOf
    const nav = latest?.nav ?? null
    const daily = nav != null ? resolver.calcDailyReturnPct(id, nav, navDate, null) : null
    const periods = nav != null ? resolver.calcPeriodReturns(id, nav, navDate) : null
    const cache = await query(
      `SELECT return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text
       FROM ops_fof_overview_list_cache c
       JOIN fof_underlying_summary f ON f.id = c.fof_underlying_id
       WHERE f.product_name = $1`,
      [s.name],
    )
    console.log(s.name, {
      latest,
      daily,
      periods,
      cache: cache[0] ?? null,
    })
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
