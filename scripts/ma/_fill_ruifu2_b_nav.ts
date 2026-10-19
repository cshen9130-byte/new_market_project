/**
 * Fill missing 睿富2号 B-class NAVs from the manager xlsx.
 * Diagnoses SAGFS9 and the B-class code, then inserts only dates absent
 * from the merged product-page series. Existing dates are left unchanged.
 *
 * Usage: npx tsx scripts/ma/_fill_ruifu2_b_nav.ts [--apply] [xlsx-path]
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`
const APPLY = process.argv.includes("--apply")
const XLSX_PATH =
  process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls")) ??
  "d:\\微信\\documents\\xwechat_files\\shencong3036_2378\\msg\\file\\2026-10\\睿富2号B类净值20261012.xlsx"

async function waitForPort(port: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1")
        socket.once("connect", () => {
          socket.destroy()
          resolve()
        })
        socket.once("error", reject)
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

async function ensureTunnel(): Promise<ChildProcess | null> {
  if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
    process.env.DATABASE_URL = DEFAULT_DB_URL
  }
  if (await waitForPort(LOCAL_PORT, 800)) {
    console.log("Using existing listener on localhost:5433")
    return null
  }
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  const child = spawn(
    "ssh",
    [
      "-i", keyPath, "-L", `${LOCAL_PORT}:127.0.0.1:5432`, "-N",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ExitOnForwardFailure=yes",
      "root@8.154.33.143",
    ],
    { stdio: "ignore", windowsHide: true },
  )
  if (!(await waitForPort(LOCAL_PORT, 20_000))) {
    child.kill()
    throw new Error("SSH tunnel did not open localhost:5433")
  }
  console.log("SSH tunnel ready on localhost:5433")
  return child
}

async function main() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`xlsx not found: ${XLSX_PATH}`)
  const tunnel = await ensureTunnel()
  try {
    const { analyzeNavWorkbook } = await import("../../lib/server/nav-cleaner")
    const { query } = await import("../../lib/db")
    const { loadMergedFundNavRows, resolveFundNames } = await import("../../lib/server/fund-nav-series")
    const { shareClassFamilyBeianCodes, buildTieredBeianCode } = await import(
      "../../lib/server/share-class-product"
    )

    const excel = analyzeNavWorkbook(fs.readFileSync(XLSX_PATH), path.basename(XLSX_PATH))
    const trading = excel.rows.filter((r) => r.isChinaTradingDay)
    console.log(
      `excel trading=${trading.length} first=${trading[0]?.date} last=${trading.at(-1)?.date} unit=${trading.at(-1)?.unitNav} cum=${trading.at(-1)?.cumulativeNav} adj=${trading.at(-1)?.adjustedNav}`,
    )
    console.log(`warnings=${JSON.stringify(excel.warnings)}`)

    const family = [...new Set([
      ...shareClassFamilyBeianCodes("SAGFS9"),
      buildTieredBeianCode("SAGFS9", "B"),
      buildTieredBeianCode("SAGFS9", "A"),
    ])]
    console.log("family", family)

    const info = await query<{ beian_hao: string; product_name: string; src: string }>(
      `SELECT beian_hao, product_name, src FROM (
         SELECT beian_hao, product_name, 'info' AS src FROM private_fund_info
         WHERE beian_hao = ANY($1::text[]) OR product_name ILIKE '%睿富2号%'
         UNION ALL
         SELECT beian_hao, product_name, 'bfl' AS src FROM private_fund_info_bfl
         WHERE beian_hao = ANY($1::text[]) OR product_name ILIKE '%睿富2号%'
       ) s
       ORDER BY beian_hao, src`,
      [family],
    )
    console.log("products", info)

    const codes = [...new Set(info.map((r) => r.beian_hao))]
    if (!codes.includes("SAGFS9")) codes.unshift("SAGFS9")

    for (const beian of codes) {
      const sources = await query<{
        src: string
        n: string
        first_d: string | null
        last_d: string | null
        last_nav: string | null
        last_cum: string | null
        last_adj: string | null
      }>(
        `SELECT src, n::text, first_d::text, last_d::text, last_nav::text, last_cum::text, last_adj::text FROM (
           SELECT 'private_fund_nav' AS src, count(*) AS n, min(price_date) AS first_d, max(price_date) AS last_d,
                  (ARRAY_AGG(nav ORDER BY price_date DESC))[1] AS last_nav,
                  (ARRAY_AGG(cum_nav_withdrawal ORDER BY price_date DESC))[1] AS last_cum,
                  (ARRAY_AGG(cumulative_nav ORDER BY price_date DESC))[1] AS last_adj
           FROM private_fund_nav WHERE beian_hao = $1
           UNION ALL
           SELECT 'ops_team_nav_manual', count(*), min(nav_date), max(nav_date),
                  (ARRAY_AGG(unit_nav ORDER BY nav_date DESC))[1],
                  (ARRAY_AGG(cumulative_nav ORDER BY nav_date DESC))[1],
                  (ARRAY_AGG(adjusted_nav ORDER BY nav_date DESC))[1]
           FROM ops_team_nav_manual WHERE UPPER(BTRIM(beian_hao)) = $1
           UNION ALL
           SELECT 'ops_email_nav_records', count(*), min(nav_date), max(nav_date),
                  (ARRAY_AGG(nav ORDER BY nav_date DESC))[1],
                  (ARRAY_AGG(cumulative_nav ORDER BY nav_date DESC))[1],
                  (ARRAY_AGG(adjusted_nav ORDER BY nav_date DESC))[1]
           FROM ops_email_nav_records WHERE UPPER(BTRIM(product_code)) = $1
         ) s`,
        [beian],
      )
      console.log(`sources ${beian}`, sources)
    }

    const targetCandidates = codes.length > 0 ? codes : ["SAGFS9"]
    const excelByDate = new Map(trading.map((r) => [r.date, r]))

    type Candidate = {
      beian: string
      productName: string
      shortName: string
      merged: Awaited<ReturnType<typeof loadMergedFundNavRows>>
      missing: typeof trading
      mismatches: number
    }
    const scored: Candidate[] = []

    for (const beian of targetCandidates) {
      const hint = info.find((r) => r.beian_hao === beian)?.product_name ?? "睿富2号"
      const names = await resolveFundNames(beian, hint)
      const productName = names.product_name || hint
      const merged = await loadMergedFundNavRows(beian, productName, names.short_name)
      const dates = new Set(merged.map((r) => r.price_date.slice(0, 10)))
      const byDate = new Map(merged.map((r) => [r.price_date.slice(0, 10), r]))
      let mismatches = 0
      let compared = 0
      for (const row of trading) {
        const existing = byDate.get(row.date)
        if (!existing) continue
        compared++
        const unit = parseFloat(existing.nav)
        if (Number.isFinite(unit) && Math.abs(unit - row.unitNav) > 0.00015) mismatches++
      }
      const missing = trading.filter((r) => !dates.has(r.date))
      const last = merged.at(-1)
      console.log(
        `${beian} name=${productName} merged=${merged.length} compared=${compared} mismatches=${mismatches} missing=${missing.length} last=${last ? `${last.price_date.slice(0, 10)} u=${last.nav} cum=${last.cum_nav_withdrawal} adj=${last.cumulative_nav}` : "none"}`,
      )
      if (missing.length > 0 && missing.length <= 40) {
        console.log("  missing", missing.map((r) => r.date).join(", "))
      } else if (missing.length > 40) {
        console.log(
          `  missing sample ${missing.slice(0, 8).map((r) => r.date).join(", ")} ... ${missing.slice(-4).map((r) => r.date).join(", ")}`,
        )
      }
      scored.push({
        beian,
        productName,
        shortName: names.short_name,
        merged,
        missing,
        mismatches,
      })
    }

    const viable = scored
      .filter((c) => c.merged.length > 0 && c.mismatches <= Math.max(3, c.merged.length * 0.02))
      .sort((a, b) => a.mismatches - b.mismatches || b.merged.length - a.merged.length)

    if (viable.length === 0) {
      console.log("no candidate overlaps the excel unit NAV; refusing to write")
      return
    }

    const target = viable[0]
    console.log(`target=${target.beian} missing=${target.missing.length} mismatches=${target.mismatches}`)
    if (target.missing.length === 0) {
      console.log("nothing to insert")
      return
    }
    if (!APPLY) {
      console.log("dry-run (pass --apply to write)")
      return
    }

    const {
      invalidateDetailNavCache,
      refreshDetailNavCacheForFund,
    } = await import("../../lib/server/fund-detail-nav-cache-pg")
    const { invalidateListResponseCache } = await import("../../lib/server/list-response-cache")
    const { invalidateTeamDataListCaches } = await import("../../lib/server/team-data-query-pg")

    const existingNav = await query<{ price_date: string; nav: string }>(
      `SELECT price_date::text AS price_date, nav::text
       FROM private_fund_nav WHERE beian_hao = $1`,
      [target.beian],
    )
    const navByDate = new Map(existingNav.map((r) => [r.price_date.slice(0, 10), parseFloat(r.nav)]))
    for (const row of target.merged) {
      const d = row.price_date.slice(0, 10)
      if (!navByDate.has(d)) navByDate.set(d, parseFloat(row.nav))
    }

    let manualInserted = 0
    let platformInserted = 0
    for (const row of target.missing) {
      const adj = row.adjustedNav ?? row.cumulativeNav
      if (!(row.unitNav > 0 && row.cumulativeNav > 0 && adj > 0)) {
        throw new Error(`invalid NAV on ${row.date}`)
      }
      const prevDate = [...navByDate.keys(), ...excelByDate.keys()]
        .filter((d) => d < row.date)
        .sort()
        .at(-1)
      const prevUnit = prevDate ? (navByDate.get(prevDate) ?? excelByDate.get(prevDate)?.unitNav ?? null) : null
      const priceChange = prevUnit != null && prevUnit > 0 ? ((row.unitNav / prevUnit - 1) * 100) : null

      const manual = await query<{ inserted: boolean }>(
        `INSERT INTO ops_team_nav_manual (beian_hao, nav_date, unit_nav, cumulative_nav, adjusted_nav, nav_type)
         VALUES ($1, $2::date, $3::numeric, $4::numeric, $5::numeric, 'pre_fee')
         ON CONFLICT (beian_hao, nav_date, nav_type) DO NOTHING
         RETURNING true AS inserted`,
        [target.beian, row.date, row.unitNav, row.cumulativeNav, adj],
      )
      if (manual.length > 0) manualInserted++

      const platform = await query<{ inserted: boolean }>(
        `INSERT INTO private_fund_nav
           (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7)
         ON CONFLICT (beian_hao, price_date) DO NOTHING
         RETURNING true AS inserted`,
        [target.beian, target.productName, row.date, row.unitNav, adj, row.cumulativeNav, priceChange],
      )
      if (platform.length > 0) platformInserted++
      navByDate.set(row.date, row.unitNav)
    }

    const invalidated = await invalidateDetailNavCache([target.beian])
    const ok = await refreshDetailNavCacheForFund({
      beian_hao: target.beian,
      product_name: target.productName,
      short_name: target.shortName,
      nav_data_source: "team",
    })
    invalidateListResponseCache()
    invalidateTeamDataListCaches()
    console.log(
      `manualInserted=${manualInserted} platformInserted=${platformInserted} cache_invalidated=${invalidated} refreshed=${ok}`,
    )

    const after = await loadMergedFundNavRows(target.beian, target.productName, target.shortName)
    const afterDates = new Set(after.map((r) => r.price_date.slice(0, 10)))
    const still = target.missing.filter((r) => !afterDates.has(r.date))
    const last = after.at(-1)
    console.log("after", {
      n: after.length,
      stillMissing: still.map((r) => r.date),
      last: last ? `${last.price_date.slice(0, 10)} unit=${last.nav} cum=${last.cum_nav_withdrawal} adj=${last.cumulative_nav}` : null,
    })
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
