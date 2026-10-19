/**
 * Fill missing SAGE52 (Ruifu 2) NAVs from the B-class manager workbook.
 * Inserts only trading days absent from the merged product-page series,
 * into the email tail after the manual window. Existing dates are not updated.
 *
 * Usage: npx tsx scripts/ma/_fill_sage52_nav.ts [--apply] [xlsx-path]
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
const BEIAN = "SAGE52"
const APPLY = process.argv.includes("--apply")
const XLSX_PATH =
  process.argv.find((a) => a.endsWith(".xlsx") || a.endsWith(".xls")) ??
  String.raw`d:\微信\documents\xwechat_files\shencong3036_2378\msg\file\2026-10\睿富2号B类净值20261012.xlsx`

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
    const names = await resolveFundNames(BEIAN, "睿富2号私募证券投资基金")
    const productName = names.product_name || "睿富2号私募证券投资基金"
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
    console.log(`merged=${merged.length} mismatches=${mismatches} missing=${missing.length} product=${productName}`)
    for (const row of missing) {
      const prev = [...byDate.keys()].filter((d) => d < row.date).sort().at(-1)
      const next = [...byDate.keys()].filter((d) => d > row.date).sort()[0]
      console.log(
        `  ${row.date} unit=${row.unitNav} cum=${row.cumulativeNav} adj=${row.adjustedNav} prev=${prev ?? "-"} next=${next ?? "-"}`,
      )
    }
    if (mismatches > 3) throw new Error(`unit NAV overlap mismatches=${mismatches}; refusing to write`)
    if (missing.length === 0) {
      console.log("nothing to insert")
      return
    }

    const existingEmail = await query<{ nav_date: string; nav: string; fund_name: string | null }>(
      `SELECT nav_date::text AS nav_date, nav::text AS nav, fund_name
       FROM ops_email_nav_records
       WHERE UPPER(BTRIM(product_code)) = $1
         AND nav_date = ANY($2::date[])`,
      [BEIAN, missing.map((r) => r.date)],
    )
    console.log("email rows already on missing dates", existingEmail)

    const template = await query<{
      crawl_email_account: string
      sender_email: string | null
      fund_name: string | null
      source: string | null
    }>(
      `SELECT crawl_email_account, sender_email, fund_name, source
       FROM ops_email_nav_records
       WHERE UPPER(BTRIM(product_code)) = $1
       ORDER BY nav_date DESC, id DESC
       LIMIT 1`,
      [BEIAN],
    )
    console.log("template", template[0])
    if (!template[0]) throw new Error("no email template row for SAGE52")

    if (!APPLY) {
      console.log("dry-run (pass --apply to write)")
      return
    }

    const emailUid = "sage52-b-nav-fill-20261012"
    const attachment = "ruifu2-b-nav-20261012.xlsx"
    let inserted = 0
    for (const row of missing) {
      const res = await query<{ id: string }>(
        `INSERT INTO ops_email_nav_records (
           crawl_email_account, email_uid, sent_at, subject, sender_email,
           nav_date, nav, cumulative_nav, adjusted_nav, product_code, fund_name,
           source, attachment_filename
         ) VALUES (
           $1, $2, NOW(), $3, $4,
           $5::date, $6, $7, NULL, $8, $9,
           $10, $11
         )
         ON CONFLICT ON CONSTRAINT uq_email_nav_record_date_code DO NOTHING
         RETURNING id::text AS id`,
        [
          template[0].crawl_email_account,
          emailUid,
          "ruifu2-b-nav-20261012",
          template[0].sender_email,
          row.date,
          row.unitNav,
          row.cumulativeNav,
          BEIAN,
          template[0].fund_name,
          template[0].source ?? "manual-nav-fill",
          attachment,
        ],
      )
      if (res.length > 0) inserted++
    }

    const invalidated = await invalidateDetailNavCache([BEIAN])
    const ok = await refreshDetailNavCacheForFund({
      beian_hao: BEIAN,
      product_name: productName,
      short_name: names.short_name,
      nav_data_source: "team",
    })
    invalidateListResponseCache()
    invalidateTeamDataListCaches()

    const after = await loadMergedFundNavRows(BEIAN, productName, names.short_name)
    const afterDates = new Set(after.map((r) => r.price_date.slice(0, 10)))
    const still = missing.filter((r) => !afterDates.has(r.date)).map((r) => r.date)
    const gaps: string[] = []
    for (let i = 1; i < after.length; i++) {
      const prev = after[i - 1].price_date.slice(0, 10)
      const cur = after[i].price_date.slice(0, 10)
      const days = (Date.parse(cur) - Date.parse(prev)) / 86400000
      if (days > 5 && prev >= "2026-08-01") gaps.push(`${prev} -> ${cur} (${days}d)`)
    }
    const last = after.at(-1)
    console.log(`inserted=${inserted} cache_invalidated=${invalidated} refreshed=${ok}`)
    console.log("after", {
      n: after.length,
      still,
      last: last
        ? `${last.price_date.slice(0, 10)} u=${last.nav} cum=${last.cum_nav_withdrawal} adj=${last.cumulative_nav}`
        : null,
      gaps,
    })
    for (const row of missing) {
      const got = after.find((r) => r.price_date.slice(0, 10) === row.date)
      if (!got) {
        console.log(`  check ${row.date} MISSING`)
        continue
      }
      console.log(`  check ${row.date} u=${got.nav} cum=${got.cum_nav_withdrawal} adj=${got.cumulative_nav}`)
    }
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
