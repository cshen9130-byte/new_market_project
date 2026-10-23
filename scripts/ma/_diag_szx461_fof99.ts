/** Read-only: SZX461 fof99 dates vs fetch log. */
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`

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
  if (await waitForPort(LOCAL_PORT, 800)) return null
  const keyPath = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".ssh", "id_ed25519_server")
  const child = spawn(
    "ssh",
    ["-i", keyPath, "-L", `${LOCAL_PORT}:127.0.0.1:5432`, "-N", "-o", "StrictHostKeyChecking=accept-new", "-o", "ExitOnForwardFailure=yes", "root@8.154.33.143"],
    { stdio: "ignore", windowsHide: true },
  )
  if (!(await waitForPort(LOCAL_PORT, 20_000))) {
    child.kill()
    throw new Error("no tunnel")
  }
  return child
}

async function main() {
  const tunnel = await ensureTunnel()
  try {
    const { query } = await import("../../lib/db")
    const info = await query(
      `SELECT latest_nav::text, latest_nav_date::text, updated_at::text
       FROM private_fund_info WHERE beian_hao = 'SZX461'`,
    )
    console.log("info", info[0])
    const policy = await query(
      `SELECT policy, reason, updated_at::text FROM fof99_nav_universe WHERE reg_code = 'SZX461'`,
    )
    console.log("policy", policy[0])
    const months = await query(
      `SELECT to_char(price_date, 'YYYY-MM') AS m, COUNT(*)::text AS n,
              MIN(price_date)::text AS lo, MAX(price_date)::text AS hi
       FROM private_fund_nav WHERE beian_hao = 'SZX461'
       GROUP BY 1 ORDER BY 1`,
    )
    console.log("months")
    for (const row of months) console.log(`  ${row.m} n=${row.n} ${row.lo}..${row.hi}`)
    const recent = await query<{ price_date: string; nav: string }>(
      `SELECT price_date::text, nav::text
       FROM private_fund_nav
       WHERE beian_hao = 'SZX461' AND price_date >= '2026-06-01'
       ORDER BY price_date`,
    )
    console.log("pfnav since 2026-06-01", recent.map((r) => `${r.price_date.slice(0, 10)}=${r.nav}`).join(" "))
    const log = await query(
      `SELECT price_date::text, status, nav::text, batch_id, fetched_at::text
       FROM fof99_nav_fetch_log
       WHERE reg_code = 'SZX461' AND price_date >= '2026-06-01'
       ORDER BY price_date, fetched_at`,
    )
    console.log("fetch log since 2026-06-01", log.length)
    for (const row of log) {
      console.log(`  ${String(row.price_date).slice(0, 10)} ${row.status} nav=${row.nav ?? "-"} batch=${row.batch_id} at=${String(row.fetched_at).slice(0, 19)}`)
    }
    const gaps = await query(
      `WITH d AS (
         SELECT price_date, LAG(price_date) OVER (ORDER BY price_date) AS prev
         FROM private_fund_nav WHERE beian_hao = 'SZX461' AND price_date >= '2026-01-01'
       )
       SELECT prev::text, price_date::text, (price_date - prev) AS days
       FROM d WHERE prev IS NOT NULL AND price_date - prev > 8
       ORDER BY price_date`,
    )
    console.log("gaps > 8d in 2026", gaps)
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
