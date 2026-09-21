/**
 * Fill missing SASK40 (华年量化选股择时1号) NAVs from the manager xlsx.
 * Only inserts dates absent from the merged 平台数据 series.
 * If ASK40A overlap is consistent (non-分红), also fill A-class gaps.
 *
 * Usage: npx tsx scripts/ma/_fill_sask40_nav.ts [--dry-run] [xlsx-path]
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
const PARENT = { beian: "SASK40", name: "华年量化选股择时1号" }
const ACLASS = { beian: "ASK40A", name: "华年量化选股择时1号A类" }
const DRY = process.argv.includes("--dry-run")
const XLSX_PATH =
  process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls")) ??
  "C:\\Users\\13904\\Desktop\\华年量化选股择时1号净值20260921.xlsx"

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

type ExcelRow = {
  date: string
  unitNav: number
  cumulativeNav: number
  adjustedNav: number | null
  isChinaTradingDay: boolean
}

async function upsertMissing(
  beian: string,
  productName: string,
  missing: ExcelRow[],
  mergedByDate: Map<string, { nav: string }>,
  excelByDate: Map<string, number>,
): Promise<number> {
  const { query } = await import("../../lib/db")
  const existingNav = await query<{ price_date: string; nav: string }>(
    `SELECT price_date::text AS price_date, nav::text
     FROM private_fund_nav WHERE beian_hao = $1 ORDER BY price_date`,
    [beian],
  )
  const navByDate = new Map(existingNav.map((r) => [r.price_date.slice(0, 10), parseFloat(r.nav)]))
  for (const [d, r] of mergedByDate) {
    if (!navByDate.has(d)) navByDate.set(d, parseFloat(r.nav))
  }

  let upserted = 0
  for (const row of missing) {
    const adj = row.adjustedNav ?? row.cumulativeNav
    if (!(row.unitNav > 0 && row.cumulativeNav > 0 && adj > 0)) {
      throw new Error(
        `invalid NAV on ${row.date}: adj=${adj} cum=${row.cumulativeNav} unit=${row.unitNav}`,
      )
    }
    if (!(adj >= row.cumulativeNav - 0.00005 && row.cumulativeNav >= row.unitNav - 0.00005)) {
      console.warn(
        `  warn ${beian} ${row.date}: adj=${adj} cum=${row.cumulativeNav} unit=${row.unitNav} (excel values kept)`,
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
      [beian, productName, row.date, row.unitNav, adj, row.cumulativeNav, priceChange],
    )
    navByDate.set(row.date, row.unitNav)
    upserted++
  }
  return upserted
}

async function main() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`xlsx not found: ${XLSX_PATH}`)
  const tunnel = await ensureTunnel()

  try {
    const { analyzeNavWorkbook } = await import("../../lib/server/nav-cleaner")
    const { query } = await import("../../lib/db")
    const { loadMergedFundNavRows, resolveFundNames } = await import("../../lib/server/fund-nav-series")
    const { navSeriesOverlapConsistent } = await import("../../lib/server/share-class-nav-fill")
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
    console.log(`sheet=${excel.sheetName} headers=${JSON.stringify(excel.detectedColumns)}`)
    console.log(`warnings=${JSON.stringify(excel.warnings)}`)
    console.log(
      `excel=${excel.validRowCount} first=${excel.rows[0]?.date} last=${excel.rows.at(-1)?.date} unit=${excel.rows.at(-1)?.unitNav} cum=${excel.rows.at(-1)?.cumulativeNav} adj=${excel.rows.at(-1)?.adjustedNav}`,
    )
    const codes = [...new Set(excel.rows.map((r) => r.productCode).filter(Boolean))]
    const namesInFile = [...new Set(excel.rows.map((r) => r.fundName).filter(Boolean))]
    console.log(`excel productCode=${JSON.stringify(codes)} fundName=${JSON.stringify(namesInFile)}`)

    const info = await query<{ beian_hao: string; product_name: string }>(
      `SELECT beian_hao, product_name
       FROM private_fund_info
       WHERE beian_hao IN ('SASK40', 'ASK40A')
          OR product_name ILIKE '%华年量化选股择时1号%'
       ORDER BY beian_hao`,
    )
    console.log("private_fund_info", info)

    for (const beian of [PARENT.beian, ACLASS.beian]) {
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
        [beian],
      )
      console.log(`sources ${beian}`, sources)
    }

    const parentNames = await resolveFundNames(PARENT.beian, PARENT.name)
    const aNames = await resolveFundNames(ACLASS.beian, ACLASS.name)
    const parentName = parentNames.product_name || PARENT.name
    const aName = aNames.product_name || ACLASS.name

    const parentMerged = await loadMergedFundNavRows(PARENT.beian, parentName, parentNames.short_name)
    const aMerged = await loadMergedFundNavRows(ACLASS.beian, aName, aNames.short_name)
    const parentDates = new Set(parentMerged.map((r) => r.price_date.slice(0, 10)))
    const aDates = new Set(aMerged.map((r) => r.price_date.slice(0, 10)))
    const parentByDate = new Map(parentMerged.map((r) => [r.price_date.slice(0, 10), r]))
    const aByDate = new Map(aMerged.map((r) => [r.price_date.slice(0, 10), r]))
    const excelByDate = new Map(excel.rows.map((r) => [r.date, r.unitNav]))

    const parentMissing = excel.rows.filter((r) => r.isChinaTradingDay && !parentDates.has(r.date))
    const aMissing = excel.rows.filter((r) => r.isChinaTradingDay && !aDates.has(r.date))

    const overlapMismatches: string[] = []
    for (const row of excel.rows) {
      const existing = parentByDate.get(row.date)
      if (!existing) continue
      const unit = parseFloat(existing.nav)
      if (Number.isFinite(unit) && Math.abs(unit - row.unitNav) > 0.00015) {
        overlapMismatches.push(
          `${row.date} db=${unit} excel=${row.unitNav} Δ=${(row.unitNav - unit).toFixed(6)}`,
        )
      }
    }

    const parentLast = parentMerged.at(-1)
    const aLast = aMerged.at(-1)
    console.log(
      `parent merged=${parentMerged.length} last=${parentLast ? `${parentLast.price_date.slice(0, 10)} unit=${parentLast.nav} cum=${parentLast.cum_nav_withdrawal} adj=${parentLast.cumulative_nav}` : "none"} missing=${parentMissing.length}`,
    )
    console.log(
      `A merged=${aMerged.length} last=${aLast ? `${aLast.price_date.slice(0, 10)} unit=${aLast.nav}` : "none"} missing=${aMissing.length}`,
    )
    console.log(`overlapMismatches=${overlapMismatches.length}`)
    for (const line of overlapMismatches.slice(0, 12)) console.log(`  ${line}`)
    if (overlapMismatches.length > 12) console.log(`  ... ${overlapMismatches.length - 12} more`)

    const excelAsNav = excel.rows.map((r) => ({ price_date: r.date, nav: r.unitNav }))
    const aOverlapOk = aMerged.length > 0 && navSeriesOverlapConsistent(aMerged, excelAsNav)
    console.log(`ASK40A overlapConsistent=${aOverlapOk}`)

    function logMissing(label: string, missing: ExcelRow[]) {
      if (missing.length === 0) return
      console.log(`${label} first=${missing[0].date} last=${missing.at(-1)!.date}`)
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
    logMissing("parent missing", parentMissing)
    if (aOverlapOk) logMissing("A missing", aMissing)

    if (parentMissing.length === 0 && !(aOverlapOk && aMissing.length > 0)) {
      console.log("nothing to insert")
      return
    }

    if (DRY) {
      console.log("dry-run, skip writes")
      return
    }

    const upsertedParent = parentMissing.length
      ? await upsertMissing(PARENT.beian, parentName, parentMissing, parentByDate, excelByDate)
      : 0
    const upsertedA =
      aOverlapOk && aMissing.length > 0
        ? await upsertMissing(ACLASS.beian, aName, aMissing, aByDate, excelByDate)
        : 0

    const codesToInvalidate = [PARENT.beian]
    if (upsertedA > 0) codesToInvalidate.push(ACLASS.beian)
    const invalidated = await invalidateDetailNavCache(codesToInvalidate)
    const okParent = await refreshDetailNavCacheForFund({
      beian_hao: PARENT.beian,
      product_name: parentName,
      short_name: parentNames.short_name,
    })
    await upsertTrackingFundListCacheEntry(PARENT.beian, parentName)
    let okA = false
    if (upsertedA > 0) {
      okA = await refreshDetailNavCacheForFund({
        beian_hao: ACLASS.beian,
        product_name: aName,
        short_name: aNames.short_name,
      })
      await upsertTrackingFundListCacheEntry(ACLASS.beian, aName)
    }
    invalidateListResponseCache()
    invalidateTeamDataListCaches()
    console.log(
      `upserted parent=${upsertedParent} A=${upsertedA} cache_invalidated=${invalidated} refreshed parent=${okParent} A=${okA}`,
    )

    const after = await loadMergedFundNavRows(PARENT.beian, parentName, parentNames.short_name)
    const afterDates = new Set(after.map((r) => r.price_date.slice(0, 10)))
    const stillMissing = parentMissing.filter((r) => !afterDates.has(r.date))
    const gaps: string[] = []
    for (let i = 1; i < after.length; i++) {
      const prev = after[i - 1].price_date.slice(0, 10)
      const cur = after[i].price_date.slice(0, 10)
      const days = (Date.parse(cur) - Date.parse(prev)) / 86400000
      if (days > 10) gaps.push(`${prev} -> ${cur} (${days}d)`)
    }
    const last = after.at(-1)
    console.log("after", {
      n: after.length,
      stillMissing: stillMissing.map((r) => r.date),
      last: last ? `${last.price_date.slice(0, 10)} unit=${last.nav}` : null,
      gapsGt10d: gaps.slice(-8),
    })

    const cache = await query(
      `SELECT tip_nav_date::text, tip_unit_nav::text, jsonb_array_length(nav_series) AS n, refreshed_at::text
       FROM ops_private_fund_detail_nav_cache WHERE cache_key = $1`,
      [PARENT.beian],
    )
    console.log("cache", cache[0])
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
