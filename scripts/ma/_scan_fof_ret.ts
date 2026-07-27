/**
 * Scan FOF overview cache vs detail-style (selectEmailNavSeriesRows + 复权) daily return.
 * Flag products where list return_pct / unit_nav diverge from the continuity+rechain series.
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { writeFileSync } from "fs"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { selectEmailNavSeriesRows, mergeNavSeriesWithEmail } = await import(
    "../../lib/server/email-nav-query"
  )
  const { BatchNavResolver, calcReturn, enrichReturnNavSeries } = await import(
    "../../lib/server/list-cache-nav-batch"
  )

  const cache = await query<{
    beian_hao: string | null
    product_name: string
    nav_date: string
    unit_nav: string
    return_pct: string | null
  }>(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text
     FROM ops_fof_overview_list_cache
     ORDER BY product_name`,
  )

  const identities = cache.map((r) => ({
    beian_hao: (r.beian_hao ?? "").trim(),
    product_name: r.product_name,
    short_name: null as string | null,
  }))
  const asOf = "2026-07-27"
  const resolver = await BatchNavResolver.create(identities, asOf)

  const lines: string[] = []
  const bad: Array<Record<string, unknown>> = []

  for (const row of cache) {
    const beian = (row.beian_hao ?? "").trim()
    const id = {
      beian_hao: beian,
      product_name: row.product_name,
      short_name: null as string | null,
    }
    const latest = resolver.resolveAt(id, asOf)
    const ret = latest
      ? resolver.calcDailyReturnPct(id, latest.nav, latest.nav_date, null)
      : null
    const cacheNav = parseFloat(row.unit_nav)
    const cacheRet = row.return_pct != null ? parseFloat(row.return_pct) : null

    const navMismatch =
      latest != null && Number.isFinite(cacheNav) && Math.abs(latest.nav - cacheNav) > 0.00005
    const retMismatch =
      ret != null
      && cacheRet != null
      && Number.isFinite(cacheRet)
      && Math.abs(ret - cacheRet) > 0.0005

    // Also check multi-investor estimate emails still diverge on latest date
    let multiInvestor = false
    let emailDistinct = 0
    if (beian) {
      const email = await query<{ nav: string; cum: string | null }>(
        `SELECT nav::text, cumulative_nav::text AS cum
         FROM ops_email_nav_records
         WHERE BTRIM(product_code) = $1
           AND nav_date = $2::date
           AND subject ILIKE '%【基金虚拟净值表现估算】%'`,
        [beian, row.nav_date],
      )
      const navs = new Set(email.map((e) => Number(e.nav).toFixed(6)))
      emailDistinct = navs.size
      multiInvestor = navs.size > 1
    }

    if (navMismatch || retMismatch || multiInvestor) {
      bad.push({
        beian,
        name: row.product_name,
        cacheNav,
        cacheRet,
        resolveNav: latest?.nav ?? null,
        resolveRet: ret,
        navMismatch,
        retMismatch,
        multiInvestor,
        emailDistinct,
        navDate: row.nav_date,
      })
    }
  }

  lines.push(`cache rows=${cache.length} flagged=${bad.length}`)
  for (const b of bad) {
    lines.push(JSON.stringify(b))
  }

  // Focus probe: BVE414 / 泰来 / 景丰
  const probe = await query(
    `SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text
     FROM ops_fof_overview_list_cache
     WHERE beian_hao IN ('BVE414','AVF35A','ACT37A','SBVE41','SAVF35','SACT37')
        OR product_name ILIKE '%景丰%'
        OR product_name ILIKE '%泰来%'
        OR product_name ILIKE '%棕榈%'`,
  )
  lines.push("\nPROBE CACHE:")
  for (const r of probe) lines.push(JSON.stringify(r))

  for (const code of ["BVE414", "AVF35A", "ACT37A"]) {
    const email = await query(
      `SELECT nav_date::text, nav::text, cumulative_nav::text, left(subject,100) AS subject
       FROM ops_email_nav_records
       WHERE product_code = $1 AND nav_date >= '2026-07-20'
       ORDER BY nav_date DESC, id DESC`,
      [code],
    )
    lines.push(`\nEMAIL ${code}:`)
    for (const r of email) lines.push(JSON.stringify(r))
  }

  writeFileSync("scripts/ma/_scan_fof_ret_out.txt", lines.join("\n"), "utf8")
  console.log("wrote", lines.length, "lines, flagged", bad.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
