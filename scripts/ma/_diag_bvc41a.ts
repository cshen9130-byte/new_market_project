import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"
import { writeFileSync } from "fs"
ensureScriptDatabaseEnv()
configureEtlDbTimeout()

async function main() {
  const { query } = await import("../../lib/db")
  const { selectEmailNavSeriesRows, mergeNavSeriesWithEmail } = await import(
    "../../lib/server/email-nav-query"
  )
  const { BatchNavResolver, enrichReturnNavSeries } = await import(
    "../../lib/server/list-cache-nav-batch"
  )
  const { loadMergedFundNavRows } = await import("../../lib/server/fund-nav-series")
  const lines: string[] = []

  for (const code of ["BVC41A", "BVE414", "AVF39A", "AVF35A", "AGT37A", "ACT37A"]) {
    const email = await query(
      `SELECT id, nav_date::text, nav::text, cumulative_nav::text, product_code,
              fund_name, left(subject, 110) AS subject, source
       FROM ops_email_nav_records
       WHERE product_code = $1 OR fund_name ILIKE '%' || $1 || '%'
       ORDER BY nav_date DESC, id DESC
       LIMIT 40`,
      [code],
    )
    lines.push(`\n==== ${code} email (${email.length}) ====`)
    for (const r of email) {
      if (String(r.nav_date) >= "2026-07-15") lines.push(JSON.stringify(r))
    }
  }

  // Name search
  const byName = await query(
    `SELECT DISTINCT product_code, fund_name
     FROM ops_email_nav_records
     WHERE fund_name ILIKE '%泰来%' OR fund_name ILIKE '%景丰%' OR fund_name ILIKE '%棕榈%'
     ORDER BY product_code`,
  )
  lines.push("\nCODES BY NAME:")
  for (const r of byName) lines.push(JSON.stringify(r))

  for (const [beian, name] of [
    ["BVC41A", "棕榈滩泰来三号A类"],
    ["AVF39A", "棕榈滩泰来A类"],
    ["AGT37A", "棕榈滩泰来四号私募证券投资基金A类"],
  ] as const) {
    const rows = await query(
      `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
              product_code, fund_name, attachment_filename, subject, source, id
       FROM ops_email_nav_records
       WHERE product_code = $1 OR fund_name ILIKE $2
       ORDER BY nav_date ASC, id ASC`,
      [beian, `%${name.replace(/A类$/, "")}%`],
    )
    const selected = selectEmailNavSeriesRows(rows as never, beian, [name])
    lines.push(`\nSELECTED ${beian}:`)
    for (const r of selected.filter((x) => x.nav_date >= "2026-07-15")) {
      lines.push(`${r.nav_date} nav=${r.nav} cum=${r.cumulative_nav} ${(r.subject || "").slice(40, 90)}`)
    }
    const merged = mergeNavSeriesWithEmail(
      [],
      selected.map((r) => ({
        price_date: r.nav_date,
        nav: r.nav,
        cumulative_nav: r.cumulative_nav,
        adjusted_nav: r.adjusted_nav,
      })),
      { beian_hao: beian, product_name: name },
    )
    lines.push(`RECHAIN ${beian} tail:`)
    const tail = merged.filter((r) => r.price_date >= "2026-07-20")
    for (let i = 0; i < tail.length; i++) {
      const r = tail[i]
      let adjRet = ""
      if (i > 0) {
        const prev = tail[i - 1]
        const ar = parseFloat(r.cumulative_nav) / parseFloat(prev.cumulative_nav) - 1
        const ur = parseFloat(r.nav) / parseFloat(prev.nav) - 1
        adjRet = ` unitRet=${(ur * 100).toFixed(2)}% adjRet=${(ar * 100).toFixed(2)}%`
      }
      lines.push(
        `${r.price_date} unit=${r.nav} cumW=${r.cum_nav_withdrawal} adj=${r.cumulative_nav}${adjRet}`,
      )
    }

    const detail = await loadMergedFundNavRows(beian, name, "")
    lines.push(`DETAIL ${beian} tail:`)
    const dTail = detail.filter((r) => r.price_date >= "2026-07-20")
    for (let i = 0; i < dTail.length; i++) {
      const r = dTail[i]
      let adjRet = ""
      if (i > 0) {
        const prev = dTail[i - 1]
        const ar = parseFloat(r.cumulative_nav) / parseFloat(prev.cumulative_nav) - 1
        adjRet = ` adjRet=${(ar * 100).toFixed(2)}%`
      }
      lines.push(`${r.price_date} unit=${r.nav} adj=${r.cumulative_nav}${adjRet}`)
    }

    const id = { beian_hao: beian, product_name: name, short_name: null as string | null }
    const resolver = await BatchNavResolver.create([id], "2026-07-27")
    const latest = resolver.resolveAt(id, "2026-07-27")
    const hist = enrichReturnNavSeries(resolver.mergedHistory(id, "2026-07-01"))
    lines.push(`RESOLVE ${beian}: ${JSON.stringify(latest)}`)
    lines.push(
      `DAILY ${beian}: ${resolver.calcDailyReturnPct(id, latest!.nav, latest!.nav_date, null)}`,
    )
    for (const p of hist.filter((x) => x.nav_date >= "2026-07-20")) {
      lines.push(`hist ${p.nav_date} nav=${p.nav} rn=${p.return_nav}`)
    }
  }

  writeFileSync("scripts/ma/_diag_bvc41a_out.txt", lines.join("\n"), "utf8")
  console.log("ok", lines.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
