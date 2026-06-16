/**
 * Nightly email NAV ETL — crawl fund mailboxes, parse NAV, upsert ops_email_nav_records.
 *
 * Usage:
 *   npx tsx scripts/ma/email_nav_etl.ts
 *   npx tsx scripts/ma/email_nav_etl.ts --days=31
 *   npx tsx scripts/ma/email_nav_etl.ts --refresh-only
 *
 * Prints JSON to stdout for nightly_etl.py to consume.
 */

import { fetchEmailParseRecords } from "@/lib/server/email-parse-fetch"
import { refreshManagedProductsEmailNavLatest } from "@/lib/server/email-nav-latest-pg"

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

  if (refreshOnly) {
    try {
      const navLatestRefreshed = await refreshManagedProductsEmailNavLatest()
      console.log(JSON.stringify({ ok: true, skipped: false, refreshOnly: true, navLatestRefreshed }))
      process.exit(0)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.log(JSON.stringify({ ok: false, refreshOnly: true, error: message }))
      process.exit(1)
    }
  }

  const days = parseDays(argv)

  try {
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
