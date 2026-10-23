/**
 * Compare 君泽世川一号 merged NAV with the manager workbook. Read-only.
 * Usage: npx tsx scripts/ma/_diag_szx461_nav.ts [xlsx-path]
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
const XLSX_PATH =
  process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls")) ??
  String.raw`d:\微信\documents\xwechat_files\shencong3036_2378\msg\file\2026-10\君泽世川一号净值20261021.xlsx`

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

    const excel = analyzeNavWorkbook(fs.readFileSync(XLSX_PATH), path.basename(XLSX_PATH))
    const trading = excel.rows.filter((r) => r.isChinaTradingDay)
    console.log("excel", {
      rows: excel.rows.length,
      trading: trading.length,
      first: trading[0] ? `${trading[0].date} u=${trading[0].unitNav}` : null,
      last: trading.at(-1) ? `${trading.at(-1)!.date} u=${trading.at(-1)!.unitNav}` : null,
      warnings: excel.warnings,
      headers: excel.headers,
      detected: excel.detectedColumns,
    })

    const funds = await query<{ beian_hao: string; product_name: string | null }>(
      `SELECT beian_hao, product_name
       FROM private_fund_info
       WHERE product_name ILIKE '%君泽世川%' OR UPPER(BTRIM(beian_hao)) = 'SZX461'
       ORDER BY beian_hao`,
    )
    console.log("funds", funds)
    const beian = "SZX461"
    const names = await resolveFundNames(beian, "君泽世川一号")
    const productName = names.product_name || "君泽世川一号"
    const merged = await loadMergedFundNavRows(beian, productName, names.short_name)
    const byDate = new Map(merged.map((r) => [r.price_date.slice(0, 10), r]))
    let mismatches = 0
    const mismatchSamples: string[] = []
    for (const row of trading) {
      const existing = byDate.get(row.date)
      if (!existing) continue
      const unit = parseFloat(existing.nav)
      if (Number.isFinite(unit) && Math.abs(unit - row.unitNav) > 0.00015) {
        mismatches++
        if (mismatchSamples.length < 8) {
          mismatchSamples.push(`${row.date} stored=${existing.nav} xlsx=${row.unitNav}`)
        }
      }
    }
    const missing = trading.filter((r) => !byDate.has(r.date))
    const last = merged.at(-1)
    console.log("merged", {
      beian,
      productName,
      short: names.short_name,
      n: merged.length,
      first: merged[0]?.price_date.slice(0, 10),
      last: last ? `${last.price_date.slice(0, 10)} u=${last.nav}` : null,
      mismatches,
      mismatchSamples,
      missing: missing.length,
      missingFirst: missing[0]?.date,
      missingLast: missing.at(-1)?.date,
    })
    const recentMissing = missing.filter((r) => r.date >= "2026-08-01")
    console.log(
      "missing since 2026-08-01",
      recentMissing.length,
      recentMissing.map((r) => `${r.date} u=${r.unitNav}`).join(" | "),
    )
    console.log(
      "stored since 2026-08-01",
      merged
        .filter((r) => r.price_date.slice(0, 10) >= "2026-08-01")
        .map((r) => `${r.price_date.slice(0, 10)} u=${r.nav}`)
        .join(" | "),
    )
    console.log(
      "xlsx since 2026-08-01",
      trading
        .filter((r) => r.date >= "2026-08-01")
        .map((r) => r.date)
        .join(","),
    )

    const counts = await query(
      `SELECT 'email' AS src, COUNT(*)::text AS n, MIN(nav_date)::text AS lo, MAX(nav_date)::text AS hi
       FROM ops_email_nav_records WHERE UPPER(BTRIM(product_code)) = $1
       UNION ALL
       SELECT 'manual', COUNT(*)::text, MIN(nav_date)::text, MAX(nav_date)::text
       FROM ops_team_nav_manual WHERE UPPER(BTRIM(beian_hao)) = $1
       UNION ALL
       SELECT 'pfnav', COUNT(*)::text, MIN(price_date)::text, MAX(price_date)::text
       FROM private_fund_nav WHERE UPPER(BTRIM(beian_hao)) = $1
       UNION ALL
       SELECT 'group', COUNT(*)::text, MIN(price_date)::text, MAX(price_date)::text
       FROM private_fund_nav_group WHERE UPPER(BTRIM(beian_hao)) = $1
       UNION ALL
       SELECT 'group_hy', COUNT(*)::text, MIN(price_date)::text, MAX(price_date)::text
       FROM private_fund_nav_group_hy WHERE UPPER(BTRIM(beian_hao)) = $1
       UNION ALL
       SELECT 'type6', COUNT(*)::text, MIN(price_date)::text, MAX(price_date)::text
       FROM private_fund_nav_group_type6 WHERE UPPER(BTRIM(beian_hao)) = $1`,
      [beian.toUpperCase()],
    )
    console.log("sources", counts)
    const emailByName = await query(
      `SELECT product_code, fund_name, COUNT(*)::text AS n, MIN(nav_date)::text AS lo, MAX(nav_date)::text AS hi
       FROM ops_email_nav_records
       WHERE fund_name ILIKE '%君泽世川一号%' OR UPPER(BTRIM(product_code)) = 'SZX461'
       GROUP BY product_code, fund_name
       ORDER BY MAX(nav_date) DESC`,
    )
    console.log("email by name", emailByName)

    const info = await query(
      `SELECT latest_nav::text, latest_nav_date::text, nav_data_source
       FROM private_fund_info WHERE UPPER(BTRIM(beian_hao)) = $1`,
      [beian.toUpperCase()],
    ).catch(async (err) => {
      console.log("info query failed", err instanceof Error ? err.message : err)
      return query(
        `SELECT latest_nav::text, latest_nav_date::text
         FROM private_fund_info WHERE UPPER(BTRIM(beian_hao)) = $1`,
        [beian.toUpperCase()],
      )
    })
    console.log("info", info[0])
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
