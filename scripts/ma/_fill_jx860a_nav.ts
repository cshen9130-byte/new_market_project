/**
 * Fill missing 交睿宏观配置1号A类 (JX860A) NAVs from the manager workbook.
 * The chart was extended with B-class holding prices after 2026-07-10.
 * Overlap with the A-class series must match. Existing dates are not updated.
 *
 * Usage: npx tsx scripts/ma/_fill_jx860a_nav.ts [--apply] [xlsx-path]
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
const BEIAN = "JX860A"
const APPLY = process.argv.includes("--apply")
const XLSX_PATH =
  process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls")) ??
  String.raw`c:\Users\Administrator\Downloads\交睿宏观配置1号A类净值20261021.xlsx`

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
    const { loadDetailNavSeriesFast } = await import("../../lib/server/fund-detail-fast-path")
    const { uploadTeamNavRows } = await import("../../lib/server/team-nav-manage-pg")
    const {
      invalidateDetailNavCache,
      refreshDetailNavCacheForFund,
    } = await import("../../lib/server/fund-detail-nav-cache-pg")
    const { invalidateListResponseCache } = await import("../../lib/server/list-response-cache")
    const { invalidateTeamDataListCaches } = await import("../../lib/server/team-data-query-pg")
    const { upsertTrackingFundListCacheEntry } = await import(
      "../../lib/server/tracking-funds-list-cache-pg"
    )

    const excel = analyzeNavWorkbook(fs.readFileSync(XLSX_PATH), path.basename(XLSX_PATH))
    const trading = excel.rows.filter((r) => r.isChinaTradingDay)
    const skipped = excel.rows.filter((r) => !r.isChinaTradingDay)
    console.log(
      `excel trading=${trading.length} skippedNonTrading=${skipped.map((r) => r.date).join(",") || "none"} last=${trading.at(-1)?.date} unit=${trading.at(-1)?.unitNav}`,
    )

    const names = await resolveFundNames(BEIAN, "交睿宏观配置1号A类")
    const productName = names.product_name || "交睿宏观配置1号A类"
    const merged = await loadMergedFundNavRows(BEIAN, productName, names.short_name)
    const byDate = new Map(merged.map((r) => [r.price_date.slice(0, 10), r]))

    let mismatches = 0
    for (const row of trading) {
      const existing = byDate.get(row.date)
      if (!existing) continue
      const unit = parseFloat(existing.nav)
      if (Number.isFinite(unit) && Math.abs(unit - row.unitNav) > 0.00015) mismatches++
    }
    const missing = trading.filter((r) => !byDate.has(r.date))
    const last = merged.at(-1)
    console.log(
      `merged=${merged.length} last=${last ? `${last.price_date.slice(0, 10)} u=${last.nav}` : "none"} mismatches=${mismatches} missing=${missing.length} product=${productName}`,
    )
    for (const row of missing) {
      console.log(`  ${row.date} unit=${row.unitNav} cum=${row.cumulativeNav} adj=${row.adjustedNav}`)
    }
    if (mismatches > 0) throw new Error(`unit NAV overlap mismatches=${mismatches}; refusing to write`)
    if (missing.length === 0) {
      console.log("nothing to insert")
      return
    }

    const types = await query<{ nav_type: string; n: string }>(
      `SELECT nav_type, COUNT(*)::text AS n
       FROM ops_team_nav_manual
       WHERE UPPER(BTRIM(beian_hao)) = $1
       GROUP BY nav_type`,
      [BEIAN],
    )
    console.log("manual nav types", types)
    if (types.length !== 1 || types[0].nav_type !== "pre_fee") {
      throw new Error(`unexpected nav_type mix: ${JSON.stringify(types)}`)
    }

    const pfnav = await query<{ price_date: string; nav: string }>(
      `SELECT price_date::text AS price_date, nav::text AS nav
       FROM private_fund_nav
       WHERE UPPER(BTRIM(beian_hao)) = $1
         AND price_date = ANY($2::date[])
       ORDER BY price_date`,
      [BEIAN, missing.map((r) => r.date)],
    )
    const pfnavByDate = new Map(pfnav.map((row) => [row.price_date.slice(0, 10), row.nav]))
    for (const row of missing) {
      const stored = pfnavByDate.get(row.date)
      if (!stored) {
        console.log(`  pfnav ${row.date} absent`)
        continue
      }
      const delta = Math.abs(parseFloat(stored) - row.unitNav)
      console.log(`  pfnav ${row.date} stored=${stored} xlsx=${row.unitNav} delta=${delta.toFixed(6)}`)
    }

    if (!APPLY) {
      console.log("dry-run (pass --apply to write)")
      return
    }

    const uploaded = await uploadTeamNavRows({
      beian_hao: BEIAN,
      nav_type: "pre_fee",
      rows: missing.map((row) => ({
        nav_date: row.date,
        unit_nav: String(row.unitNav),
        cumulative_nav: String(row.cumulativeNav),
        adjusted_nav: String(row.adjustedNav ?? row.cumulativeNav),
      })),
    })
    if ("error" in uploaded) throw new Error(`upload failed: ${uploaded.error}`)

    const invalidated = await invalidateDetailNavCache([BEIAN])
    const ok = await refreshDetailNavCacheForFund({
      beian_hao: BEIAN,
      product_name: productName,
      short_name: names.short_name,
      nav_data_source: "team",
      // The list header is the B-class mark (1.159 on 2026-10-19). Do not stitch it
      // back onto the A-class series while this refresh replaces that header.
      listHeader: null,
    })
    await upsertTrackingFundListCacheEntry(BEIAN, productName)
    invalidateListResponseCache()
    invalidateTeamDataListCaches()

    const after = await loadMergedFundNavRows(BEIAN, productName, names.short_name)
    const afterDates = new Set(after.map((r) => r.price_date.slice(0, 10)))
    const still = missing.filter((r) => !afterDates.has(r.date)).map((r) => r.date)
    const tip = after.at(-1)
    console.log(`inserted=${uploaded.count} cache_invalidated=${invalidated} refreshed=${ok}`)
    console.log("after", {
      n: after.length,
      still,
      last: tip
        ? `${tip.price_date.slice(0, 10)} u=${tip.nav} cum=${tip.cum_nav_withdrawal} adj=${tip.cumulative_nav}`
        : null,
    })
    for (const row of missing) {
      const got = after.find((r) => r.price_date.slice(0, 10) === row.date)
      const unit = got ? parseFloat(got.nav) : NaN
      const okRow = got && Math.abs(unit - row.unitNav) <= 0.00015
      console.log(`  check ${row.date} ${okRow ? `u=${got!.nav}` : "MISSING"}`)
    }
    if (still.length > 0) throw new Error(`still missing after write: ${still.join(",")}`)

    const cache = await query(
      `SELECT tip_nav_date::text, tip_unit_nav::text, jsonb_array_length(nav_series) AS n
       FROM ops_private_fund_detail_nav_cache WHERE cache_key = $1`,
      [BEIAN],
    )
    console.log("cache", cache[0])

    const pageSeries = await loadDetailNavSeriesFast({
      beian_hao: BEIAN,
      product_name: productName,
      short_name: names.short_name ?? "",
    })
    const pageTip = pageSeries.at(-1)
    const bad = pageSeries.filter((row) => {
      const date = row.price_date.slice(0, 10)
      return date > "2026-07-10" && parseFloat(row.nav) < 1.4
    })
    console.log(
      "page series",
      pageSeries.length,
      pageTip ? `${pageTip.price_date.slice(0, 10)} u=${pageTip.nav}` : "none",
      `bad=${bad.length}`,
    )
    if (bad.length > 0 || !pageTip || parseFloat(pageTip.nav) < 1.4) {
      throw new Error("detail series still has the B-class unit after 2026-07-10")
    }
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
