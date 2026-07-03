import { loadProjectEnvFiles, configureEtlDbTimeout } from "../../lib/server/load-project-env.ts"
import {
  buildFofUnderlyingSummaryFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
} from "../../lib/server/fof-underlying-query.ts"
import { valuationHoldingMatchSql } from "../../lib/server/managed-fof-underlying-pg.ts"

loadProjectEnvFiles()
configureEtlDbTimeout()

const samples = [
  { name: "金和和善对冲1号", beian: "STA933" },
  { name: "乾上泉对冲一号B类", beian: "ALF51B" },
  { name: "奇盾抱朴专享1号", beian: "SBGD35" },
  { name: "木莲安澜1号A类", beian: "ATL22A" },
]

async function main() {
  const { query } = await import("../../lib/db.ts")
  const { addDays, BatchNavResolver } = await import("../../lib/server/list-cache-nav-batch.ts")
  const { loadManagedUnderlyingNavHistory } = await import("../../lib/server/managed-fof-underlying-pg.ts")
  const { fofUnderlyingNavLookupKeys } = await import("../../lib/server/fund-holding-code.ts")

  const asOf = new Date().toISOString().slice(0, 10)
  const since = addDays(asOf, -400)

  const [holdingsCount, jsonbCount, managedRows] = await Promise.all([
    query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ops_email_valuation_holdings`),
    query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ops_email_valuation_records WHERE jsonb_array_length(holdings) > 0`,
    ),
    query<{ underlying_name: string; underlying_product_code: string | null; valuation_date: string; price: string | null }>(
      `SELECT underlying_name, underlying_product_code, valuation_date::text, price::text
       FROM ops_managed_fof_underlying
       WHERE underlying_name ILIKE ANY($1::text[])
          OR UPPER(underlying_product_code) = ANY($2::text[])
       ORDER BY valuation_date DESC`,
      [
        samples.map((s) => `%${s.name.slice(0, 4)}%`),
        samples.map((s) => s.beian),
      ],
    ),
  ])
  console.log("table counts:", {
    ops_email_valuation_holdings: holdingsCount[0]?.n,
    ops_email_valuation_records_with_jsonb: jsonbCount[0]?.n,
  })
  console.log("\n=== ops_managed_fof_underlying (latest snapshot) ===")
  for (const row of managedRows) console.log(" ", row)

  console.log("\n=== valuation holdings matched to fof_underlying_summary ===")
  const beianExpr = FOF_UNDERLYING_BEIAN_EXPR
  const holdingMatch = valuationHoldingMatchSql(beianExpr, "f.product_name", "h")
  for (const s of samples) {
    const rows = await query(
      `SELECT h.valuation_date::text, h.symbol, h.subject_name, h.price, h.market_value
       ${buildFofUnderlyingSummaryFrom("f.product_name")}
       INNER JOIN ops_email_valuation_holdings h ON (${holdingMatch})
       WHERE f.product_name = $1
         AND h.valuation_date >= $2::date
       ORDER BY h.valuation_date DESC
       LIMIT 8`,
      [s.name, since],
    )
    console.log(`\n${s.name}: ${rows.length} matched holding rows`)
    for (const r of rows) console.log(" ", r)
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
    const samplePts = (() => {
      for (const k of keys) {
        const arr = history.byCode.get(k.toUpperCase()) ?? history.byName.get(k)
        if (arr?.length) return arr.slice(0, 3)
      }
      return []
    })()
    console.log(s.name, { keys: Object.fromEntries(points), samplePts })
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
    console.log(s.name, { latest, daily, periods, cache: cache[0] ?? null })
  }

  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
