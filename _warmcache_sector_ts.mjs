/**
 * One-shot cache warmer for the three new sector-timeseries endpoints.
 * Run on the server where the app is running:
 *   node _warmcache_sector_ts.mjs
 */
import { createRequire } from "module"
const require = createRequire(import.meta.url)

const BASE = process.env.WARM_CACHE_BASE_URL ?? "http://127.0.0.1:3000"

const ROUTES = [
  "/ma/api/mom-analysis/var-sector-timeseries",
  "/ma/api/mom-analysis/pnl-sector-timeseries",
  "/ma/api/mom-analysis/marginal-vol-timeseries",
]

for (const route of ROUTES) {
  const url = `${BASE}${route}`
  process.stdout.write(`Warming ${route} … `)
  const t0 = Date.now()
  try {
    const res = await fetch(url)
    const json = await res.json()
    const ms = Date.now() - t0
    if (json.ok === false) {
      console.log(`FAIL (${ms}ms): ${json.error ?? "unknown error"}`)
    } else {
      console.log(`OK (${ms}ms, ${json.dates?.length ?? 0} dates)`)
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`)
  }
}
