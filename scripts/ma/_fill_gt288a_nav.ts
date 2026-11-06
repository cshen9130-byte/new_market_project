/**
 * Load the manager workbook for GT288A (卓尚天道1号A类) as the verified NAV history.
 * Upserts 单位 / 累计 / 复权 through the file's last date, writes the managed-product
 * seed, and lets custodian email extend after that date.
 * Does not write SGT288 or any other fund.
 *
 * Usage: npx tsx scripts/ma/_fill_gt288a_nav.ts [--dry-run] [xlsx-path]
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, spawnSync, type ChildProcess } from "child_process"
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
  "c:\\Users\\Administrator\\Downloads\\卓尚天道1号A类净值20261106.xlsx"
const SEED_PATH = path.join(process.cwd(), "data", "managed-product-nav", "GT288A.json")

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
    const firstDate = trading[0]?.date ?? ""
    const lastDate = trading.at(-1)?.date ?? ""
    console.log(
      `excel trading=${trading.length} first=${firstDate} last=${lastDate} unit=${trading.at(-1)?.unitNav} adj=${trading.at(-1)?.adjustedNav}`,
    )
    console.log("warnings", excel.warnings)
    for (const row of trading) {
      const adj = row.adjustedNav ?? row.cumulativeNav
      if (!(adj >= row.cumulativeNav - 0.00005 && row.cumulativeNav >= row.unitNav - 0.00005)) {
        throw new Error(`NAV invariant failed on ${row.date}`)
      }
    }

    const names = await resolveFundNames(BEIAN, PRODUCT_NAME)
    const productName = names.product_name || PRODUCT_NAME
    const manualRows = await query<{ nav_date: string; unit_nav: string; cumulative_nav: string | null; adjusted_nav: string | null }>(
      `SELECT nav_date::text AS nav_date, unit_nav::text, cumulative_nav::text, adjusted_nav::text
       FROM ops_team_nav_manual WHERE beian_hao = $1 AND nav_type = 'pre_fee' ORDER BY nav_date`,
      [BEIAN],
    )
    const emailAfter = await query<{ nav_date: string; nav: string; cumulative_nav: string | null; adjusted_nav: string | null }>(
      `SELECT nav_date::text AS nav_date, nav::text, cumulative_nav::text, adjusted_nav::text
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = $1 AND nav_date > $2::date
       ORDER BY nav_date`,
      [BEIAN, lastDate],
    )
    console.log(
      `manual=${manualRows.length} first=${manualRows[0]?.nav_date?.slice(0, 10)} last=${manualRows.at(-1)?.nav_date?.slice(0, 10)} email_after=${emailAfter.length}`,
    )
    const seedRows = trading.map((row) => ({
      price_date: row.date,
      nav: String(row.unitNav),
      cumulative_nav: String(row.adjustedNav ?? row.cumulativeNav),
      cum_nav_withdrawal: String(row.cumulativeNav),
      price_change: "",
    }))
    const seed = {
      beian_hao: BEIAN,
      before_date: null,
      source_file: path.basename(XLSX_PATH),
      row_count: seedRows.length,
      rows: seedRows,
    }
    if (DRY) {
      console.log("dry-run, skip writes")
      return
    }

    fs.mkdirSync(path.dirname(SEED_PATH), { recursive: true })
    fs.writeFileSync(SEED_PATH, JSON.stringify(seed))
    console.log(`seed ${SEED_PATH} rows=${seedRows.length}`)
    const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
    const copied = spawnSync("scp", [
      "-i", keyPath,
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      SEED_PATH,
      "root@8.154.33.143:/root/new_market_project/data/managed-product-nav/GT288A.json",
    ], { stdio: "inherit", windowsHide: true })
    if (copied.status !== 0) throw new Error(`scp seed failed: ${copied.status}`)
    console.log("seed copied to production")

    const dates = trading.map((row) => row.date)
    const units = trading.map((row) => String(row.unitNav))
    const cums = trading.map((row) => String(row.cumulativeNav))
    const adjs = trading.map((row) => String(row.adjustedNav ?? row.cumulativeNav))
    await query(
      `INSERT INTO ops_team_nav_manual
         (beian_hao, nav_date, unit_nav, cumulative_nav, adjusted_nav, nav_type, is_protected)
       SELECT $1, d::date, u::numeric, c::numeric, a::numeric, 'pre_fee', TRUE
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS t(d, u, c, a)
       ON CONFLICT (beian_hao, nav_date, nav_type) DO UPDATE SET
         unit_nav = EXCLUDED.unit_nav,
         cumulative_nav = EXCLUDED.cumulative_nav,
         adjusted_nav = EXCLUDED.adjusted_nav,
         is_protected = TRUE`,
      [BEIAN, dates, units, cums, adjs],
    )
    const fileDates = new Set(dates)
    const strayInside = manualRows
      .map((row) => row.nav_date.slice(0, 10))
      .filter((date) => date >= firstDate && date <= lastDate && !fileDates.has(date))
    if (strayInside.length > 0) {
      await query(
        `DELETE FROM ops_team_nav_manual
         WHERE beian_hao = $1 AND nav_type = 'pre_fee' AND nav_date = ANY($2::date[])`,
        [BEIAN, strayInside],
      )
    }
    const manualAfter = manualRows
      .map((row) => row.nav_date.slice(0, 10))
      .filter((date) => date > lastDate)
    if (manualAfter.length > 0) {
      await query(
        `DELETE FROM ops_team_nav_manual
         WHERE beian_hao = $1 AND nav_type = 'pre_fee' AND nav_date > $2::date`,
        [BEIAN, lastDate],
      )
    }
    await query(
      `INSERT INTO private_fund_nav
         (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
       SELECT $1, $2, d::date, u::numeric, a::numeric, c::numeric, NULL
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[]) AS t(d, u, c, a)
       ON CONFLICT (beian_hao, price_date) DO UPDATE SET
         product_name = EXCLUDED.product_name,
         nav = EXCLUDED.nav,
         cumulative_nav = EXCLUDED.cumulative_nav,
         cum_nav_withdrawal = EXCLUDED.cum_nav_withdrawal`,
      [BEIAN, productName, dates, units, cums, adjs],
    )

    const invalidated = await invalidateDetailNavCache([BEIAN])
    const ok = await refreshDetailNavCacheForFund({
      beian_hao: BEIAN,
      product_name: productName,
      short_name: names.short_name,
    })
    invalidateListResponseCache()
    invalidateTeamDataListCaches()
    const merged = await loadMergedFundNavRows(BEIAN, productName, names.short_name)
    const head = merged[0]
    const tail = merged.at(-1)
    const peak = merged.reduce((best, row) => {
      const adj = parseFloat(row.cumulative_nav)
      return Number.isFinite(adj) && adj > best.adj ? { adj, date: row.price_date.slice(0, 10) } : best
    }, { adj: 0, date: "" })
    let maxDd = 0
    let runPeak = 0
    for (const row of merged) {
      const adj = parseFloat(row.cumulative_nav)
      if (!Number.isFinite(adj) || adj <= 0) continue
      if (adj > runPeak) runPeak = adj
      maxDd = Math.min(maxDd, adj / runPeak - 1)
    }
    const since = head && tail ? parseFloat(tail.cumulative_nav) / parseFloat(head.cumulative_nav) - 1 : NaN
    console.log(
      `upserted=${trading.length} stray_deleted=${strayInside.length} manual_after_deleted=${manualAfter.length} cache_invalidated=${invalidated} refreshed=${ok}`,
    )
    console.log(
      `series n=${merged.length} ${head?.price_date?.slice(0, 10)} → ${tail?.price_date?.slice(0, 10)} unit=${tail?.nav} cum=${tail?.cum_nav_withdrawal} adj=${tail?.cumulative_nav} since=${(since * 100).toFixed(2)}% maxDd=${(maxDd * 100).toFixed(2)}% peak=${peak.date}`,
    )
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
