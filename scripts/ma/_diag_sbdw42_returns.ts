import { loadProjectEnvFiles } from "../../lib/server/load-project-env"
import { query } from "../../lib/db"
import {
  loadEmailNavSeries,
  loadPrivateFundLegacyNavRows,
  mergeNavSeriesWithEmail,
} from "../../lib/server/email-nav-query"

import { BatchNavResolver } from "../../lib/server/list-cache-nav-batch"

loadProjectEnvFiles()

const BEIAN = "SBDW42"
const PRODUCT = "青钱基石1号私募证券投资基金"
const SHORT = "青钱基石1号"

async function main() {
  const cache = await query(
    `SELECT unit_nav::text, nav_date::text, return_pct::text, ret_1w::text, ret_1m::text, ret_3m::text
     FROM ops_tracking_funds_list_cache WHERE beian_hao = $1`,
    [BEIAN],
  )
  console.log("cache:", cache[0])

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, PRODUCT, SHORT)
  console.log("legacy count", legacy.length, "tail", legacy.slice(-5).map(r => [r.price_date, r.nav]))
  const email = await loadEmailNavSeries(BEIAN, PRODUCT, SHORT)
  console.log("email count", email.length, "tail", email.slice(-8).map(r => [r.price_date, r.nav]))
  const merged = mergeNavSeriesWithEmail(legacy, email)
  const latest = merged.at(-1)!
  console.log("\nlatest:", latest.price_date, latest.nav)

  const windows = [7, 30, 90, 180, 365]
  for (const days of windows) {
    const d = new Date(latest.price_date)
    d.setDate(d.getDate() - days)
    const iso = d.toISOString().slice(0, 10)
    const hit = [...merged].reverse().find((r) => r.price_date <= iso)
    const ret = hit ? (parseFloat(latest.nav) / parseFloat(hit.nav) - 1) * 100 : null
    console.log(`-${days}d (${iso}):`, hit?.price_date, hit?.nav, "=>", ret?.toFixed(2) + "%")
  }

  console.log("\nmerged Jun-Jul:")
  for (const r of merged.filter((x) => x.price_date >= "2026-06-20")) {
    console.log(r.price_date, r.nav)
  }

  const identity = { beian_hao: BEIAN, product_name: PRODUCT, short_name: SHORT }
  const resolver = await BatchNavResolver.create([identity], latest.price_date)
  const returns = resolver.calcPeriodReturns(identity, parseFloat(latest.nav), latest.price_date)
  console.log("\nBatchNavResolver returns:", returns)
}

main()
