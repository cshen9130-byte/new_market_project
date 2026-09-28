/**
 * Fill missing GT288A (卓尚天道1号A类) NAVs from the manager xlsx.
 * Inserts only dates absent from the merged series for this 备案号.
 * Does not write SGT288 or any other fund, and does not change the NAV pipeline.
 *
 * Usage: npx tsx scripts/ma/_fill_gt288a_nav.ts [--dry-run] [xlsx-path]
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
const BEIAN = "GT288A"
const PRODUCT_NAME = "卓尚天道1号A类"
const DRY = process.argv.includes("--dry-run")
const XLSX_PATH =
  process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls")) ??
  "d:\\微信\\documents\\xwechat_files\\shencong3036_2378\\msg\\file\\2026-09\\卓尚天道1号A份额净值序列_20250620_20260911(1).xlsx"

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
    const {
      invalidateDetailNavCache,
      refreshDetailNavCacheForFund,
    } = await import("../../lib/server/fund-detail-nav-cache-pg")
    const { invalidateListResponseCache } = await import("../../lib/server/list-response-cache")
    const { invalidateTeamDataListCaches } = await import("../../lib/server/team-data-query-pg")

    const excel = analyzeNavWorkbook(fs.readFileSync(XLSX_PATH), path.basename(XLSX_PATH))
    const trading = excel.rows.filter((r) => r.isChinaTradingDay)
    console.log(
      `excel trading=${trading.length} first=${trading[0]?.date} last=${trading.at(-1)?.date} unit=${trading.at(-1)?.unitNav}`,
    )

    const names = await resolveFundNames(BEIAN, PRODUCT_NAME)
    const productName = names.product_name || PRODUCT_NAME
    const manualRows = await query<{ nav_date: string }>(
      `SELECT nav_date::text AS nav_date FROM ops_team_nav_manual WHERE beian_hao = $1`,
      [BEIAN],
    )
    const manualDates = new Set(manualRows.map((r) => r.nav_date.slice(0, 10)))
    const missing = trading.filter((r) => !manualDates.has(r.date))
    const merged = await loadMergedFundNavRows(BEIAN, productName, names.short_name)
    const mergedDates = new Set(merged.map((r) => r.price_date.slice(0, 10)))
    const mismatches: string[] = []
    const byDate = new Map(merged.map((r) => [r.price_date.slice(0, 10), r]))
    for (const row of trading) {
      const existing = byDate.get(row.date)
      if (!existing) continue
      const unit = parseFloat(existing.nav)
      if (Number.isFinite(unit) && Math.abs(unit - row.unitNav) > 0.00015) {
        mismatches.push(`${row.date} db=${unit} excel=${row.unitNav}`)
      }
    }
    const tail = merged.filter((r) => r.price_date.slice(0, 10) >= "2026-09-01")
    console.log(`merged=${merged.length} missing=${missing.length} mismatches=${mismatches.length}`)
    console.log("tail", tail.map((r) => `${r.price_date.slice(0, 10)} u=${r.nav} cum=${r.cum_nav_withdrawal} adj=${r.cumulative_nav}`))
    console.log("mismatch sample", mismatches.slice(0, 8))
    if (missing.length === 0) {
      console.log("nothing to insert")
      return
    }
    console.log(`missing first=${missing[0].date} last=${missing.at(-1)!.date}`)
    if (DRY) {
      console.log("dry-run, skip writes")
      return
    }

    const existingNav = await query<{ price_date: string; nav: string }>(
      `SELECT price_date::text AS price_date, nav::text
       FROM private_fund_nav WHERE beian_hao = $1 ORDER BY price_date`,
      [BEIAN],
    )
    const navByDate = new Map(existingNav.map((r) => [r.price_date.slice(0, 10), parseFloat(r.nav)]))
    let upserted = 0
    for (const row of missing) {
      const adj = row.adjustedNav ?? row.cumulativeNav
      if (!(adj >= row.cumulativeNav - 0.00005 && row.cumulativeNav >= row.unitNav - 0.00005)) {
        throw new Error(`NAV invariant failed on ${row.date}`)
      }
      const prevDate = [...navByDate.keys()].filter((d) => d < row.date).sort().at(-1)
      const prevUnit = prevDate ? navByDate.get(prevDate) ?? null : null
      const priceChange = prevUnit != null && prevUnit > 0 ? ((row.unitNav / prevUnit - 1) * 100) : null
      await query(
        `INSERT INTO ops_team_nav_manual (beian_hao, nav_date, unit_nav, cumulative_nav, adjusted_nav, nav_type)
         VALUES ($1, $2::date, $3::numeric, $4::numeric, $5::numeric, 'pre_fee')
         ON CONFLICT (beian_hao, nav_date, nav_type) DO NOTHING`,
        [BEIAN, row.date, row.unitNav, row.cumulativeNav, adj],
      )
      await query(
        `INSERT INTO private_fund_nav
           (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7)
         ON CONFLICT (beian_hao, price_date) DO NOTHING`,
        [BEIAN, productName, row.date, row.unitNav, adj, row.cumulativeNav, priceChange],
      )
      if (!navByDate.has(row.date)) navByDate.set(row.date, row.unitNav)
      upserted++
    }
    const invalidated = await invalidateDetailNavCache([BEIAN])
    const ok = await refreshDetailNavCacheForFund({
      beian_hao: BEIAN,
      product_name: productName,
      short_name: names.short_name,
    })
    invalidateListResponseCache()
    invalidateTeamDataListCaches()
    console.log(`upserted=${upserted} cache_invalidated=${invalidated} refreshed=${ok}`)
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
