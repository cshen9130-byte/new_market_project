/** Read-only: where JX860A post-July NAV comes from. */
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
  if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) process.env.DATABASE_URL = DEFAULT_DB_URL
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
    const BEIAN = "JX860A"
    const manual = await query(
      `SELECT nav_type, nav_date::text, unit_nav::text, cumulative_nav::text, adjusted_nav::text
       FROM ops_team_nav_manual
       WHERE UPPER(BTRIM(beian_hao)) = $1 AND nav_date >= '2026-06-01'
       ORDER BY nav_date`,
      [BEIAN],
    )
    console.log("manual since Jun", manual.length)
    for (const r of manual) console.log("  M", r.nav_type, String(r.nav_date).slice(0, 10), r.unit_nav, r.cumulative_nav, r.adjusted_nav)

    const email = await query(
      `SELECT nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text, fund_name, product_code, source
       FROM ops_email_nav_records
       WHERE UPPER(BTRIM(product_code)) = $1 OR fund_name ILIKE '%交睿宏观配置1号%'
       ORDER BY nav_date`,
      [BEIAN],
    )
    console.log("email", email.length)
    const emailRecent = email.filter((r) => String(r.nav_date).slice(0, 10) >= "2026-06-01")
    console.log("email since Jun", emailRecent.length)
    for (const r of emailRecent.slice(0, 40)) {
      console.log("  E", String(r.nav_date).slice(0, 10), r.nav, r.cumulative_nav, r.adjusted_nav, r.product_code, r.fund_name, r.source)
    }
    if (emailRecent.length > 40) console.log("  ...", emailRecent.length - 40, "more")

    const pfnav = await query(
      `SELECT price_date::text, nav::text, cumulative_nav::text, cum_nav_withdrawal::text
       FROM private_fund_nav
       WHERE UPPER(BTRIM(beian_hao)) = $1 AND price_date >= '2026-06-01'
       ORDER BY price_date`,
      [BEIAN],
    )
    console.log("pfnav since Jun", pfnav.length)
    for (const r of pfnav) console.log("  F", String(r.price_date).slice(0, 10), r.nav, r.cumulative_nav, r.cum_nav_withdrawal)

    const types = await query(
      `SELECT nav_type, COUNT(*)::text n, MIN(nav_date)::text lo, MAX(nav_date)::text hi
       FROM ops_team_nav_manual WHERE UPPER(BTRIM(beian_hao)) = $1 GROUP BY 1`,
      [BEIAN],
    )
    console.log("manual types", types)

    const names = await query(
      `SELECT beian_hao, product_name FROM private_fund_info
       WHERE product_name ILIKE '%交睿宏观配置%' OR UPPER(BTRIM(beian_hao)) LIKE 'JX860%'
       ORDER BY beian_hao`,
    )
    console.log("related funds", names)
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
