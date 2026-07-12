/**
 * Diagnose 钜融添宝20号 市值 vs shares * NAV.
 * Usage: DATABASE_URL=... npx tsx scripts/ma/_diag_snr014_mv.mts
 */
import pg from "pg"

const url =
  process.env.DATABASE_URL
  ?? "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const pool = new pg.Pool({ connectionString: url })
const codes = ["SNR014", "SNF018"]
const namePat = "%钜融添宝%"

const holdings = await pool.query(
  `SELECT underlying_product_code, underlying_name, fof_product_name,
          valuation_date::text AS valuation_date,
          quantity::float8 AS quantity,
          market_value::float8 AS market_value,
          price::float8 AS price,
          market_weight::float8 AS market_weight
   FROM ops_managed_fof_underlying
   WHERE COALESCE(market_value, 0) > 0
     AND (
       UPPER(TRIM(COALESCE(underlying_product_code, ''))) = ANY($1::text[])
       OR underlying_name ILIKE $2
     )
   ORDER BY valuation_date DESC, fof_product_name`,
  [codes, namePat],
)

const cache = await pool.query(
  `SELECT beian_hao, product_name, nav_date::text, unit_nav::float8 AS unit_nav,
          market_value::float8 AS market_value, refreshed_at::text
   FROM ops_fof_overview_list_cache
   WHERE UPPER(TRIM(COALESCE(beian_hao, ''))) = ANY($1::text[])
      OR product_name ILIKE $2`,
  [codes, namePat],
)

const nav = await pool.query(
  `SELECT product_code, fund_name, nav_date::text, nav::float8 AS nav, source
   FROM ops_email_nav_records
   WHERE UPPER(TRIM(COALESCE(product_code, ''))) = ANY($1::text[])
      OR fund_name ILIKE $2
   ORDER BY nav_date DESC
   LIMIT 12`,
  [codes, namePat],
)

console.log("=== fof cache ===")
console.log(cache.rows)
console.log("=== email nav (latest) ===")
console.log(nav.rows)
console.log("=== holdings ===")
for (const r of holdings.rows) {
  const implied = r.quantity > 0 ? r.market_value / r.quantity : null
  const expectedAt13291 = r.quantity * 1.3291
  console.log({
    fof: r.fof_product_name,
    date: r.valuation_date?.slice(0, 10),
    code: r.underlying_product_code,
    qty: r.quantity,
    mv: r.market_value,
    price: r.price,
    impliedNav: implied,
    gapVs13291: expectedAt13291 - r.market_value,
  })
}

const latestByFof = new Map<string, (typeof holdings.rows)[0]>()
for (const r of holdings.rows) {
  const key = r.fof_product_name
  const prev = latestByFof.get(key)
  if (!prev || String(r.valuation_date) > String(prev.valuation_date)) latestByFof.set(key, r)
}
const latest = [...latestByFof.values()]
const sumMv = latest.reduce((s, r) => s + r.market_value, 0)
const sumQty = latest.reduce((s, r) => s + r.quantity, 0)
console.log("=== latest-per-FOF sum ===", {
  rows: latest.map((r) => ({
    fof: r.fof_product_name,
    date: String(r.valuation_date).slice(0, 10),
    mv: r.market_value,
  })),
  sumMv,
  sumQty,
  sharesTimes13291: sumQty * 1.3291,
  gap: sumQty * 1.3291 - sumMv,
})

await pool.end()
