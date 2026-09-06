/**
 * Fill header-only NAV CSVs from group / type6 / hy NAV tables.
 * Usage: npx tsx scripts/ma/backfill_empty_private_fund_nav.ts --no-tunnel
 */
import fs from "fs"
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`
const STAMP = new Date().toISOString().slice(0, 10)
const OUT_ROOT = path.join(process.cwd(), "data", "exports", `private-funds-nav6m-${STAMP}`)

function waitForPort(port: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return (async () => {
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
        await new Promise((r) => setTimeout(r, 300))
      }
    }
    return false
  })()
}

async function startSshTunnel(): Promise<ChildProcess> {
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  const child = spawn(
    "ssh",
    ["-i", keyPath, "-L", `${LOCAL_PORT}:127.0.0.1:5432`, "-N", "-o", "ExitOnForwardFailure=yes", "root@8.154.33.143"],
    { stdio: "ignore", windowsHide: true },
  )
  if (!(await waitForPort(LOCAL_PORT, 20_000))) {
    child.kill()
    throw new Error("SSH tunnel failed")
  }
  return child
}

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, "\"\"")}"` : v
}

function isEmptyNavCsv(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return true
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim()
  const lines = text.split(/\r?\n/).filter(Boolean)
  return lines.length <= 1
}

async function main() {
  const noTunnel = process.argv.includes("--no-tunnel")
  let tunnel: ChildProcess | null = null
  if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
    process.env.DATABASE_URL = DEFAULT_DB_URL
  }
  if (noTunnel) {
    if (!(await waitForPort(LOCAL_PORT, 3_000))) throw new Error("no listener on 5433")
  } else if (!(await waitForPort(LOCAL_PORT, 800))) {
    tunnel = await startSshTunnel()
  }

  try {
    const { query } = await import("@/lib/db")
    const empty: { beian: string; dest: string }[] = []
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) walk(full)
        else if (ent.isFile() && ent.name.endsWith(".csv") && !ent.name.startsWith("_") && isEmptyNavCsv(full)) {
          const beian = ent.name.split("_")[0]
          if (beian) empty.push({ beian, dest: full })
        }
      }
    }
    walk(OUT_ROOT)
    console.log(`Empty NAV files: ${empty.length}`)
    if (empty.length === 0) return

    const BATCH = 100
    let filled = 0
    type NavRow = { beian_hao: string; price_date: string; nav: string; cum_nav: string | null }
    for (let i = 0; i < empty.length; i += BATCH) {
      const batch = empty.slice(i, i + BATCH)
      const ids = batch.map((x) => x.beian)
      const rows = await query<NavRow>(
        `SELECT beian_hao, price_date::text AS price_date, nav::text AS nav, cum_nav
         FROM (
           SELECT DISTINCT ON (beian_hao, price_date)
                  beian_hao, price_date, nav, cum_nav
           FROM (
             SELECT beian_hao, price_date, nav, cumulative_nav::text AS cum_nav, 0 AS pri
             FROM private_fund_nav_group
             WHERE beian_hao = ANY($1::text[]) AND nav IS NOT NULL
             UNION ALL
             SELECT beian_hao, price_date, nav, cumulative_nav::text, 1
             FROM private_fund_nav_group_hy
             WHERE beian_hao = ANY($1::text[]) AND nav IS NOT NULL
             UNION ALL
             SELECT beian_hao, price_date, nav, NULL::text, 2
             FROM private_fund_nav_group_type6
             WHERE beian_hao = ANY($1::text[]) AND nav IS NOT NULL
             UNION ALL
             SELECT beian_hao, price_date, nav, cumulative_nav::text, 3
             FROM private_fund_nav
             WHERE beian_hao = ANY($1::text[]) AND nav IS NOT NULL
           ) u
           ORDER BY beian_hao, price_date, pri
         ) d
         ORDER BY beian_hao, price_date`,
        [ids],
      )
      const grouped = new Map<string, NavRow[]>()
      for (const row of rows) {
        const list = grouped.get(row.beian_hao)
        if (list) list.push(row)
        else grouped.set(row.beian_hao, [row])
      }
      for (const item of batch) {
        const series = grouped.get(item.beian) ?? []
        if (series.length === 0) continue
        const csvRows: string[] = ["日期,单位净值,累计净值,日涨跌"]
        let prev: number | null = null
        for (const pt of series) {
          const nav = parseFloat(pt.nav)
          let chg = ""
          if (Number.isFinite(nav) && prev != null && prev !== 0) chg = ((nav / prev) - 1).toFixed(8)
          if (Number.isFinite(nav)) prev = nav
          csvRows.push([
            csvEscape(String(pt.price_date).slice(0, 10)),
            csvEscape(pt.nav),
            csvEscape(pt.cum_nav ?? ""),
            chg,
          ].join(","))
        }
        fs.writeFileSync(item.dest, `\uFEFF${csvRows.join("\n")}\n`, "utf8")
        filled += 1
      }
      console.log(`  backfill ${Math.min(i + BATCH, empty.length)}/${empty.length} (filled ${filled})`)
    }
    console.log(`Filled ${filled} / ${empty.length} empty files`)
  } finally {
    if (tunnel) tunnel.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
