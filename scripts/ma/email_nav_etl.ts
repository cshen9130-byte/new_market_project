/**
 * Nightly email NAV ETL — crawl fund mailboxes, parse NAV, upsert ops_email_nav_records.
 *
 * Usage:
 *   npx tsx scripts/ma/email_nav_etl.ts
 *   npx tsx scripts/ma/email_nav_etl.ts --days=31
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --fof-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --managed-only
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only --tracking-only
 *
 * Loads `.env.local` / `.env` from the project root automatically (same as nightly_etl.py).
 * Prints JSON to stdout for nightly_etl.py to consume.
 */

import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

function parseDays(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--days="))
  if (flag) {
    const n = parseInt(flag.slice("--days=".length), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  const env = parseInt(process.env.EMAIL_NAV_ETL_DAYS ?? "31", 10)
  return Number.isFinite(env) && env > 0 ? env : 31
}

async function main() {
  const argv = process.argv.slice(2)
  const refreshOnly = argv.includes("--refresh-only")
  const fofOnly = argv.includes("--fof-only")
  const managedOnly = argv.includes("--managed-only")
  const trackingOnly = argv.includes("--tracking-only")
  const refreshManaged = !fofOnly && !trackingOnly
  const refreshFof = !managedOnly && !trackingOnly
  const refreshTracking = !managedOnly && !fofOnly

  if (refreshOnly) {
    try {
      let listCache = 0
      let fofOverviewListCache = 0
      let trackingFundsListCache = 0

      if (refreshManaged) {
        console.error("[email_nav_etl] refresh-only: rebuilding managed products list cache…")
        const { refreshManagedProductsListCache } = await import("@/lib/server/managed-products-list-cache-pg")
        listCache = await refreshManagedProductsListCache()
        console.error(`[email_nav_etl] managed products cache done (${listCache} rows)`)
      }

      if (refreshFof) {
        console.error("[email_nav_etl] refresh-only: rebuilding FOF overview list cache…")
        const { refreshFofOverviewListCache } = await import("@/lib/server/fof-overview-list-cache-pg")
        fofOverviewListCache = await refreshFofOverviewListCache()
        console.error(`[email_nav_etl] FOF overview cache done (${fofOverviewListCache} rows)`)
      }

      if (refreshTracking) {
        console.error("[email_nav_etl] refresh-only: rebuilding tracking funds list cache…")
        const { refreshTrackingFundsListCache } = await import("@/lib/server/tracking-funds-list-cache-pg")
        trackingFundsListCache = await refreshTrackingFundsListCache()
        console.error(`[email_nav_etl] tracking funds cache done (${trackingFundsListCache} rows)`)
      }

      console.log(JSON.stringify({
        ok: true,
        skipped: false,
        refreshOnly: true,
        listCacheRefreshed: listCache,
        fofOverviewListCacheRefreshed: fofOverviewListCache,
        trackingFundsListCacheRefreshed: trackingFundsListCache,
      }))
      process.exit(0)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[email_nav_etl] refresh-only failed: ${message}`)
      console.log(JSON.stringify({ ok: false, refreshOnly: true, error: message }))
      process.exit(1)
    }
  }

  const days = parseDays(argv)

  try {
    const { fetchEmailParseRecords } = await import("@/lib/server/email-parse-fetch")
    const result = await fetchEmailParseRecords({ days })
    console.log(
      JSON.stringify({
        ok: true,
        skipped: false,
        days,
        ...result,
      }),
    )
    process.exit(0)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const skipped =
      message.includes("抓取邮箱") ||
      message.includes("授权码")

    console.log(
      JSON.stringify({
        ok: false,
        skipped,
        days,
        emailsScanned: 0,
        recordsFound: 0,
        navSaved: 0,
        errors: [message],
        error: message,
      }),
    )
    process.exit(skipped ? 0 : 1)
  }
}

main()
