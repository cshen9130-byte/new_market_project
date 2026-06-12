/**
 * Nightly email NAV ETL — crawl fund mailboxes, parse NAV, upsert ops_email_nav_records.
 *
 * Usage:
 *   npx tsx scripts/ma/email_nav_etl.ts
 *   npx tsx scripts/ma/email_nav_etl.ts --days=31
 *
 * Prints JSON to stdout for nightly_etl.py to consume.
 */

import { fetchEmailParseRecords } from "@/lib/server/email-parse-fetch"

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
  const days = parseDays(process.argv.slice(2))

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
