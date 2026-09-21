/**
 * Fill missing SB0838 (博孚利西海机智对冲一号) NAVs from the manager xlsx.
 * Only inserts dates absent from the merged 平台数据 series.
 *
 * Usage: npx tsx scripts/ma/_fill_sb0838_nav.ts [--dry-run] [xlsx-path]
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
const BEIAN = "SB0838"
const FUND_NAME = "博孚利西海机智对冲一号"
const DRY = process.argv.includes("--dry-run")
const XLSX_PATH =
  process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls")) ??
  "C:\\Users\\13904\\Desktop\\博孚利西海机智对冲一号净值20260921 的副本.xlsx"

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
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  if (!fs.existsSync(keyPath)) {
    throw new Error(`SSH key not found: ${keyPath}`)
  }
  if (await waitForPort(LOCAL_PORT, 1200)) {
    console.log("Using existing listener on localhost:5433")
    return null
  }
  console.log(`Opening SSH tunnel via ${keyPath}`)
  const child = spawn(
    "ssh",
    [
      "-i", keyPath, "-L", `${LOCAL_PORT}:127.0.0.1:5432`, "-N",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ConnectTimeout=15",
      "-o", "ServerAliveInterval=30",
      "root@8.154.33.143",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  )
  child.stderr?.on("data", (buf) => process.stderr.write(buf))
  child.stdout?.on("data", (buf) => process.stdout.write(buf))
  child.on("exit", (code, signal) => {
    console.error(`ssh exited code=${code} signal=${signal}`)
  })
  if (!(await waitForPort(LOCAL_PORT, 25_000))) {
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
    console.log(`sheet=${excel.sheetName} headers=${JSON.stringify(excel.detectedColumns)}`)
    console.log(`warnings=${JSON.stringify(excel.warnings)}`)
    console.log(
      `excel=${excel.validRowCount} first=${excel.rows[0]?.date} last=${excel.rows.at(-1)?.date} unit=${excel.rows.at(-1)?.unitNav} cum=${excel.rows.at(-1)?.cumulativeNav} adj=${excel.rows.at(-1)?.adjustedNav}`,
    )

    const info = await query<{ beian_hao: string; product_name: string }>(
      `SELECT beian_hao, product_name
       FROM private_fund_info
       WHERE beian_hao IN ('SB0838', 'S00030')
          OR product_name ILIKE '%博孚利西海机智对冲一号%'
       ORDER BY beian_hao`,
    )
    console.log("private_fund_info", info)

    const sources = await query<{
      src: string
      n: string
      first_d: string
      last_d: string
      last_nav: string
    }>(
      `SELECT src, n::text, first_d::text, last_d::text, last_nav::text FROM (
         SELECT 'private_fund_nav' AS src, count(*) AS n, min(price_date) AS first_d, max(price_date) AS last_d,
                (ARRAY_AGG(nav ORDER BY price_date DESC))[1] AS last_nav
         FROM private_fund_nav WHERE beian_hao = $1
         UNION ALL
         SELECT 'private_fund_nav_group', count(*), min(price_date), max(price_date),
                (ARRAY_AGG(nav ORDER BY price_date DESC))[1]
         FROM private_fund_nav_group WHERE beian_hao = $1
         UNION ALL
         SELECT 'private_fund_nav_group_type6', count(*), min(price_date), max(price_date),
                (ARRAY_AGG(nav ORDER BY price_date DESC))[1]
         FROM private_fund_nav_group_type6 WHERE beian_hao = $1
         UNION ALL
         SELECT 'private_fund_nav_group_hy', count(*), min(price_date), max(price_date),
                (ARRAY_AGG(nav ORDER BY price_date DESC))[1]
         FROM private_fund_nav_group_hy WHERE beian_hao = $1
         UNION ALL
         SELECT 'ops_email_nav_records', count(*), min(nav_date), max(nav_date),
                (ARRAY_AGG(nav ORDER BY nav_date DESC))[1]
         FROM ops_email_nav_records WHERE product_code = $1
         UNION ALL
         SELECT 'ops_team_nav_manual', count(*), min(nav_date), max(nav_date),
                (ARRAY_AGG(unit_nav ORDER BY nav_date DESC))[1]
         FROM ops_team_nav_manual WHERE beian_hao = $1
       ) s`,
      [BEIAN],
    )
    console.log("sources", sources)

    const names = await resolveFundNames(BEIAN, FUND_NAME)
    const productName = names.product_name || FUND_NAME
    const mergedBefore = await loadMergedFundNavRows(BEIAN, productName, names.short_name)
    const mergedDates = new Set(mergedBefore.map((r) => r.price_date.slice(0, 10)))
    const mergedByDate = new Map(
      mergedBefore.map((r) => [r.price_date.slice(0, 10), r]),
    )
    const missing = excel.rows.filter((r) => r.isChinaTradingDay && !mergedDates.has(r.date))

    const overlapMismatches: string[] = []
    for (const row of excel.rows) {
      const existing = mergedByDate.get(row.date)
      if (!existing) continue
      const unit = parseFloat(existing.nav)
      if (Number.isFinite(unit) && Math.abs(unit - row.unitNav) > 0.00015) {
        overlapMismatches.push(
          `${row.date} db=${unit} excel=${row.unitNav} Δ=${(row.unitNav - unit).toFixed(6)}`,
        )
      }
    }

    const mergedLast = mergedBefore.at(-1)
    console.log(
      `merged=${mergedBefore.length} last=${mergedLast ? `${mergedLast.price_date.slice(0, 10)} unit=${mergedLast.nav} cum=${mergedLast.cum_nav_withdrawal} adj=${mergedLast.cumulative_nav}` : "none"} missing=${missing.length}`,
    )
    console.log(`overlapMismatches=${overlapMismatches.length}`)
    for (const line of overlapMismatches.slice(0, 12)) console.log(`  ${line}`)
    if (overlapMismatches.length > 12) console.log(`  ... ${overlapMismatches.length - 12} more`)

    if (missing.length > 0) {
      console.log(`missing first=${missing[0].date} last=${missing.at(-1)!.date}`)
      for (const row of missing.slice(0, 15)) {
        console.log(`  ${row.date} unit=${row.unitNav} cum=${row.cumulativeNav} adj=${row.adjustedNav}`)
      }
      if (missing.length > 15) {
        console.log(`  ... ${missing.length - 15} more`)
        for (const row of missing.slice(-5)) {
          console.log(`  ${row.date} unit=${row.unitNav} cum=${row.cumulativeNav} adj=${row.adjustedNav}`)
        }
      }
    }

    if (missing.length === 0) {
      console.log("nothing to insert")
      return
    }

    const existingNav = await query<{ price_date: string; nav: string }>(
      `SELECT price_date::text AS price_date, nav::text
       FROM private_fund_nav WHERE beian_hao = $1 ORDER BY price_date`,
      [BEIAN],
    )
    const navByDate = new Map(existingNav.map((r) => [r.price_date.slice(0, 10), parseFloat(r.nav)]))
    for (const [d, r] of mergedByDate) {
      if (!navByDate.has(d)) navByDate.set(d, parseFloat(r.nav))
    }
    const excelByDate = new Map(excel.rows.map((r) => [r.date, r.unitNav]))

    let upserted = 0
    if (DRY) {
      console.log("dry-run, skip writes")
    } else {
      for (const row of missing) {
        const adj = row.adjustedNav ?? row.cumulativeNav
        if (!(row.unitNav > 0 && row.cumulativeNav > 0 && adj > 0)) {
          throw new Error(
            `invalid NAV on ${row.date}: adj=${adj} cum=${row.cumulativeNav} unit=${row.unitNav}`,
          )
        }
        if (!(adj >= row.cumulativeNav - 0.00005 && row.cumulativeNav >= row.unitNav - 0.00005)) {
          console.warn(
            `  warn ${row.date}: adj=${adj} cum=${row.cumulativeNav} unit=${row.unitNav} (excel values kept)`,
          )
        }
        const prevDate = [...navByDate.keys(), ...excelByDate.keys()]
          .filter((d) => d < row.date)
          .sort()
          .at(-1)
        const prevUnit = prevDate ? (navByDate.get(prevDate) ?? excelByDate.get(prevDate) ?? null) : null
        const priceChange =
          prevUnit != null && prevUnit > 0 ? ((row.unitNav / prevUnit - 1) * 100) : null

        await query(
          `INSERT INTO private_fund_nav
             (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7)
           ON CONFLICT (beian_hao, price_date) DO UPDATE SET
             product_name       = EXCLUDED.product_name,
             nav                = EXCLUDED.nav,
             cumulative_nav     = EXCLUDED.cumulative_nav,
             cum_nav_withdrawal = EXCLUDED.cum_nav_withdrawal,
             price_change       = EXCLUDED.price_change`,
          [BEIAN, productName, row.date, row.unitNav, adj, row.cumulativeNav, priceChange],
        )
        navByDate.set(row.date, row.unitNav)
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
    }

    const mergedAfter = DRY
      ? mergedBefore
      : await loadMergedFundNavRows(BEIAN, productName, names.short_name)
    const afterDates = new Set(mergedAfter.map((r) => r.price_date.slice(0, 10)))
    const stillMissing = missing.filter((r) => !afterDates.has(r.date))
    const gaps: string[] = []
    for (let i = 1; i < mergedAfter.length; i++) {
      const prev = mergedAfter[i - 1].price_date.slice(0, 10)
      const cur = mergedAfter[i].price_date.slice(0, 10)
      const days = (Date.parse(cur) - Date.parse(prev)) / 86400000
      if (days > 10) gaps.push(`${prev} -> ${cur} (${days}d)`)
    }
    const last = mergedAfter.at(-1)
    console.log("after", {
      n: mergedAfter.length,
      stillMissing: stillMissing.map((r) => r.date),
      last: last ? `${last.price_date.slice(0, 10)} unit=${last.nav}` : null,
      gapsGt10d: gaps.slice(-8),
    })

    if (!DRY) {
      const cache = await query(
        `SELECT tip_nav_date::text, tip_unit_nav::text, jsonb_array_length(nav_series) AS n, refreshed_at::text
         FROM ops_private_fund_detail_nav_cache WHERE cache_key = $1`,
        [BEIAN],
      )
      console.log("cache", cache[0])
    }
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
