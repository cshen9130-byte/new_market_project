/**
 * Fill chart gaps from the 火富牛 platform workbooks in
 * reports/fof99_web_export/chart_gaps.
 * Inserts trading days that are not already in ops_team_nav_manual (pre_fee).
 * Refuses a fund when an overlapping unit disagrees, or when the new team
 * window would hide a date the chart already shows.
 *
 * Usage: npx tsx scripts/ma/_fill_chart_gap_nav.ts [--apply]
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
const MANIFEST = path.join(
  process.cwd(),
  "reports",
  "fof99_web_export",
  "chart_gaps",
  "manifest.json",
)

type ManifestRow = { code: string; name: string; file: string }

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
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length).toUpperCase()
  const manifest = (JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as ManifestRow[])
    .filter((row) => !only || row.code.toUpperCase() === only)
  const tunnel = await ensureTunnel()
  try {
    const { analyzeNavWorkbook } = await import("../../lib/server/nav-cleaner")
    const { query } = await import("../../lib/db")
    const { loadMergedFundNavRows, resolveFundNames } = await import("../../lib/server/fund-nav-series")
    const { uploadTeamNavRows } = await import("../../lib/server/team-nav-manage-pg")
    const {
      invalidateDetailNavCache,
      refreshDetailNavCacheForFund,
    } = await import("../../lib/server/fund-detail-nav-cache-pg")
    const { invalidateListResponseCache } = await import("../../lib/server/list-response-cache")
    const { invalidateTeamDataListCaches } = await import("../../lib/server/team-data-query-pg")

    const summary: string[] = []
    for (const item of manifest) {
      const xlsxPath = path.join(path.dirname(MANIFEST), item.file)
      console.log(`\n== ${item.code} ${item.name}`)
      if (!fs.existsSync(xlsxPath)) {
        summary.push(`${item.code} SKIP missing file`)
        continue
      }
      const excel = analyzeNavWorkbook(fs.readFileSync(xlsxPath), item.file)
      const trading = excel.rows.filter((r) => r.isChinaTradingDay)
      const names = await resolveFundNames(item.code, item.name)
      const productName = names.product_name || item.name
      const merged = await loadMergedFundNavRows(item.code, productName, names.short_name)
      const byDate = new Map(merged.map((r) => [r.price_date.slice(0, 10), r]))
      let mismatches = 0
      const mismatchSamples: string[] = []
      for (const row of trading) {
        const existing = byDate.get(row.date)
        if (!existing) continue
        const unit = parseFloat(existing.nav)
        if (Number.isFinite(unit) && Math.abs(unit - row.unitNav) > 0.00015) {
          mismatches++
          if (mismatchSamples.length < 5) {
            mismatchSamples.push(`${row.date} chart=${unit} xlsx=${row.unitNav}`)
          }
        }
      }
      const team = await query<{ nav_date: string; nav_type: string }>(
        `SELECT nav_date::text AS nav_date, nav_type
         FROM ops_team_nav_manual
         WHERE UPPER(BTRIM(beian_hao)) = $1`,
        [item.code],
      )
      const types = new Set(team.map((row) => row.nav_type))
      const teamDates = new Set(
        team.filter((row) => row.nav_type === "pre_fee").map((row) => row.nav_date.slice(0, 10)),
      )
      const teamTip = [...teamDates].sort().at(-1) ?? ""
      const hiddenCount = (rows: typeof trading) => {
        const nextTeam = new Set(teamDates)
        for (const row of rows) nextTeam.add(row.date)
        const nextDates = [...nextTeam].sort()
        const nextStart = nextDates[0] ?? ""
        const nextTip = nextDates.at(-1) ?? ""
        return merged.filter((row) => {
          const date = row.price_date.slice(0, 10)
          return date >= nextStart && date <= nextTip && !nextTeam.has(date)
        })
      }
      let inserts = trading.filter((row) => !teamDates.has(row.date))
      let hidden = hiddenCount(inserts)
      let mode = "missing"
      if ((mismatches > 0 || hidden.length > 0) && teamTip) {
        const join = [...trading].reverse().find((row) => row.date <= teamTip)
        const joinChart = join ? byDate.get(join.date) : undefined
        const joinUnit = joinChart ? parseFloat(joinChart.nav) : NaN
        const joinOk = join != null && Number.isFinite(joinUnit) && Math.abs(joinUnit - join.unitNav) <= 0.00015
        const appended = trading.filter((row) => row.date > teamTip && !teamDates.has(row.date))
        const appendClash = appended.filter((row) => {
          const existing = byDate.get(row.date)
          if (!existing) return false
          const unit = parseFloat(existing.nav)
          return Number.isFinite(unit) && Math.abs(unit - row.unitNav) > 0.00015
        })
        const appendHidden = hiddenCount(appended)
        console.log(
          `  append candidate join=${join ? `${join.date} chart=${joinUnit} xlsx=${join.unitNav}` : "none"} ok=${joinOk} n=${appended.length} clash=${appendClash.length} hidden=${appendHidden.length}`,
        )
        if (joinOk && appendClash.length === 0 && appended.length > 0 && appendHidden.length <= 3) {
          const preserved = appendHidden.flatMap((row) => {
            const date = row.price_date.slice(0, 10)
            const unitNav = parseFloat(row.nav)
            const cumulativeNav = parseFloat(row.cum_nav_withdrawal || row.nav)
            const adjustedNav = parseFloat(row.cumulative_nav || row.cum_nav_withdrawal || row.nav)
            if (!Number.isFinite(unitNav) || !Number.isFinite(cumulativeNav) || !Number.isFinite(adjustedNav)) {
              return []
            }
            return [{ date, unitNav, cumulativeNav, adjustedNav, isChinaTradingDay: true }]
          })
          inserts = [...preserved, ...appended].sort((a, b) => a.date.localeCompare(b.date))
          hidden = []
          mode = preserved.length > 0 ? "after-tip+keep" : "after-tip"
        }
      }
      const last = merged.at(-1)
      console.log(
        `trading=${trading.length} merged=${merged.length} last=${last ? `${last.price_date.slice(0, 10)} u=${last.nav}` : "none"} teamTip=${teamTip} mismatches=${mismatches} insert=${inserts.length} hidden=${hidden.length} mode=${mode} types=${[...types].join(",") || "none"}`,
      )
      if (types.size !== 1 || !types.has("pre_fee")) {
        summary.push(`${item.code} SKIP nav_type=${[...types].join(",") || "none"}`)
        continue
      }
      if (mode === "missing" && mismatches > 0) {
        console.log("  mismatch", mismatchSamples.join(" | "))
        summary.push(`${item.code} SKIP mismatches=${mismatches}`)
        continue
      }
      if (hidden.length > 0) {
        console.log("  hidden", hidden.slice(0, 8).map((row) => row.price_date.slice(0, 10)).join(","))
        summary.push(`${item.code} SKIP would hide ${hidden.length} chart dates`)
        continue
      }
      if (inserts.length === 0) {
        summary.push(`${item.code} nothing to insert`)
        continue
      }
      const first = inserts[0]
      const tipRow = inserts[inserts.length - 1]
      console.log(
        `  insert ${first.date}..${tipRow.date} n=${inserts.length} tip unit=${tipRow.unitNav}`,
      )
      if (!APPLY) {
        summary.push(`${item.code} dry-run insert=${inserts.length} tip=${tipRow.date} ${tipRow.unitNav}`)
        continue
      }
      const uploaded = await uploadTeamNavRows({
        beian_hao: item.code,
        nav_type: "pre_fee",
        rows: inserts.map((row) => ({
          nav_date: row.date,
          unit_nav: String(row.unitNav),
          cumulative_nav: String(row.cumulativeNav),
          adjusted_nav: String(row.adjustedNav ?? row.cumulativeNav),
        })),
      })
      if ("error" in uploaded) {
        summary.push(`${item.code} SKIP upload ${uploaded.error}`)
        continue
      }
      await invalidateDetailNavCache([item.code])
      const ok = await refreshDetailNavCacheForFund({
        beian_hao: item.code,
        product_name: productName,
        short_name: names.short_name,
        nav_data_source: "team",
        listHeader: null,
      })
      const after = await loadMergedFundNavRows(item.code, productName, names.short_name)
      const afterTip = after.at(-1)
      const afterUnit = afterTip ? parseFloat(afterTip.nav) : NaN
      const tipOk = afterTip
        && afterTip.price_date.slice(0, 10) >= tipRow.date
        && Math.abs(afterUnit - tipRow.unitNav) <= 0.00015
      console.log(
        `  wrote=${uploaded.count} refreshed=${ok} after=${afterTip ? `${afterTip.price_date.slice(0, 10)} u=${afterTip.nav}` : "none"}`,
      )
      summary.push(
        `${item.code} inserted=${uploaded.count} tip=${afterTip?.price_date.slice(0, 10) ?? "?"} u=${afterTip?.nav ?? "?"} ${tipOk ? "ok" : "TIP MISMATCH"}`,
      )
    }
    if (APPLY) {
      invalidateListResponseCache()
      invalidateTeamDataListCaches()
    }
    console.log("\nsummary")
    for (const line of summary) console.log(line)
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
