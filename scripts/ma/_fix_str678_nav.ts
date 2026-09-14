/**
 * Fix 朗坤鸿志量化1号 (STR678) NAV cliff — this fund only.
 *
 * Email attachments stored 累计净值 as 单位净值 through 2026-09-03, then the
 * daily 净值表 switched to real unit (~1.20). Merge rechained adj on the
 * inflated scale, then dropped ~12% on 2026-09-04.
 *
 * Per docs/nav-calculation-rules.md: per-fund seed + data repair. No pipeline
 * changes (SBAH99 / SNF018 / SSG947 / SBPC20 / SLA063 / SQX078 / SBPU97 / SBDF95
 * merge formulas stay untouched).
 *
 * Usage: npx tsx scripts/ma/_fix_str678_nav.ts
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
const BEIAN = "STR678"
const XLSX =
  "C:\\Users\\13904\\Documents\\xwechat_files\\shencong3036_2378\\msg\\file\\2026-09\\朗坤鸿志量化1号净值20260914.xlsx"

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
  process.env.DATABASE_URL = DEFAULT_DB_URL
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
  const { analyzeNavWorkbook } = await import("../../lib/server/nav-cleaner")
  const excel = analyzeNavWorkbook(fs.readFileSync(XLSX), path.basename(XLSX))
  const rows = excel.rows.filter((r) => r.isChinaTradingDay && r.unitNav > 0 && r.cumulativeNav > 0)
  if (rows.length < 100) throw new Error(`too few excel rows: ${rows.length}`)

  const seedRows = rows.map((r) => ({
    price_date: r.date,
    nav: String(r.unitNav),
    cumulative_nav: String(r.adjustedNav ?? r.cumulativeNav),
    cum_nav_withdrawal: String(r.cumulativeNav),
    price_change: "",
  }))
  const outDir = path.join(process.cwd(), "data", "managed-product-nav")
  fs.mkdirSync(outDir, { recursive: true })
  const seedPath = path.join(outDir, `${BEIAN}.json`)
  fs.writeFileSync(
    seedPath,
    JSON.stringify(
      {
        beian_hao: BEIAN,
        before_date: null,
        source_file: path.basename(XLSX),
        row_count: seedRows.length,
        note: "Manager xlsx; email had 累计 stored as 单位 through 2026-09-03 causing a −12% cliff",
        rows: seedRows,
      },
      null,
      2,
    ),
  )
  console.log(`wrote seed ${seedPath} n=${seedRows.length} ${seedRows[0].price_date}..${seedRows.at(-1)!.price_date}`)

  const tunnel = await ensureTunnel()
  try {
    const { query } = await import("../../lib/db")
    const { invalidateDetailNavCache, refreshDetailNavCacheForFund } = await import(
      "../../lib/server/fund-detail-nav-cache-pg"
    )
    const { invalidateListResponseCache } = await import("../../lib/server/list-response-cache")
    const { invalidateTeamDataListCaches } = await import("../../lib/server/team-data-query-pg")
    const { loadMergedFundNavRows, resolveFundNames } = await import("../../lib/server/fund-nav-series")

    const names = await resolveFundNames(BEIAN, "朗坤鸿志量化1号私募证券投资基金")
    const productName = names.product_name || "朗坤鸿志量化1号私募证券投资基金"

    let manualUpserted = 0
    for (const row of rows) {
      const adj = row.adjustedNav ?? row.cumulativeNav
      await query(
        `INSERT INTO ops_team_nav_manual
           (beian_hao, nav_date, unit_nav, cumulative_nav, adjusted_nav, nav_type)
         VALUES ($1, $2::date, $3::numeric, $4::numeric, $5::numeric, 'pre_fee')
         ON CONFLICT (beian_hao, nav_date, nav_type) DO UPDATE SET
           unit_nav       = EXCLUDED.unit_nav,
           cumulative_nav = EXCLUDED.cumulative_nav,
           adjusted_nav   = EXCLUDED.adjusted_nav,
           created_at     = NOW()`,
        [BEIAN, row.date, row.unitNav, row.cumulativeNav, adj],
      )
      manualUpserted += 1
    }

    let emailUpdated = 0
    for (const row of rows) {
      const adj = row.adjustedNav ?? row.cumulativeNav
      const updated = await query<{ n: string }>(
        `WITH upd AS (
           UPDATE ops_email_nav_records
              SET nav = $2::numeric,
                  cumulative_nav = $3::numeric,
                  adjusted_nav = $4::numeric
            WHERE UPPER(BTRIM(product_code)) = $1
              AND nav_date = $5::date
           RETURNING 1
         )
         SELECT COUNT(*)::text AS n FROM upd`,
        [BEIAN, row.unitNav, row.cumulativeNav, adj, row.date],
      )
      emailUpdated += parseInt(updated[0]?.n ?? "0", 10)
    }

    const otherTouched = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ops_team_nav_manual
        WHERE nav_date >= CURRENT_DATE - 1
          AND created_at >= NOW() - INTERVAL '2 minutes'
          AND UPPER(BTRIM(beian_hao)) <> $1`,
      [BEIAN],
    )

    const invalidated = await invalidateDetailNavCache([BEIAN])
    const refreshed = await refreshDetailNavCacheForFund({
      beian_hao: BEIAN,
      product_name: productName,
      short_name: names.short_name,
    })
    invalidateListResponseCache()
    invalidateTeamDataListCaches()

    const merged = await loadMergedFundNavRows(BEIAN, productName, names.short_name)
    const drops: string[] = []
    for (let i = 1; i < merged.length; i++) {
      const prev = parseFloat(merged[i - 1].cumulative_nav)
      const cur = parseFloat(merged[i].cumulative_nav)
      if (prev > 0 && Math.abs(cur / prev - 1) >= 0.04) {
        drops.push(
          `${merged[i].price_date.slice(0, 10)} adj ${merged[i - 1].cumulative_nav} -> ${merged[i].cumulative_nav} (${((cur / prev - 1) * 100).toFixed(2)}%) unit ${merged[i].nav}`,
        )
      }
    }
    const sep3 = merged.find((r) => r.price_date.slice(0, 10) === "2026-09-03")
    const sep4 = merged.find((r) => r.price_date.slice(0, 10) === "2026-09-04")
    const last = merged.at(-1)

    console.log({
      manualUpserted,
      emailUpdated,
      otherFundsTouchedLast2min: otherTouched[0]?.n,
      cache_invalidated: invalidated,
      cache_refreshed: refreshed,
      merged_n: merged.length,
      last: last
        ? `${last.price_date.slice(0, 10)} u=${last.nav} c=${last.cum_nav_withdrawal} a=${last.cumulative_nav}`
        : null,
      sep3,
      sep4,
      adjDropsGte4pct: drops,
    })
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
