/** Which email rows survive onto the JX860A chart. Read-only. */
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()
const LOCAL_PORT = 5433
if (!process.env.DATABASE_URL?.includes(`:${LOCAL_PORT}/`)) {
  process.env.DATABASE_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`
}

async function waitForPort(port: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1")
        socket.once("connect", () => { socket.destroy(); resolve() })
        socket.once("error", reject)
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

async function main() {
  if (!(await waitForPort(LOCAL_PORT, 800))) {
    const keyPath = path.join(process.env.USERPROFILE ?? "", ".ssh", "id_ed25519_server")
    const child = spawn("ssh", ["-i", keyPath, "-L", `${LOCAL_PORT}:127.0.0.1:5432`, "-N", "-o", "ExitOnForwardFailure=yes", "root@8.154.33.143"], { stdio: "ignore", windowsHide: true })
    if (!(await waitForPort(LOCAL_PORT, 20_000))) {
      child.kill()
      throw new Error("no tunnel")
    }
  }
  const { loadMergedFundNavRows, resolveFundNames } = await import("../../lib/server/fund-nav-series")
  const { loadEmailNavSeries, collectFundNameAliases, emailRowMatchesFund } = await import("../../lib/server/email-nav-query")
  const names = await resolveFundNames("JX860A", "交睿宏观配置1号A类")
  console.log("names", names)
  const aliases = collectFundNameAliases(names.product_name, names.short_name, [names.product_name, names.short_name])
  console.log("aliases", aliases)
  const sample = {
    nav_date: "2026-10-19",
    nav: "1.159",
    cumulative_nav: "1.27",
    adjusted_nav: null,
    product_code: "JRHG02",
    fund_name: "交睿宏观配置1号B类",
    attachment_filename: "虚拟业绩报酬_金舆锡泰一号私募证券投资基金_JRHG02_交睿宏观配置1号私募证券投资基金B类_2026-10-19.xls",
    subject: "",
    source: "body_table",
    id: "1",
  }
  console.log("matches sample", emailRowMatchesFund(sample, "JX860A", aliases))
  const email = await loadEmailNavSeries("JX860A", names.product_name, names.short_name)
  console.log("email series", email.length, "last", email.at(-1))
  const tail = email.filter((r) => r.price_date >= "2026-07-01")
  console.log("email since Jul", tail.length, tail[0], tail.at(-1))
  const merged = await loadMergedFundNavRows("JX860A", names.product_name, names.short_name)
  console.log("merged", merged.length, "last", merged.at(-1)?.price_date, merged.at(-1)?.nav)
  for (const row of merged.filter((r) => r.price_date.slice(0, 10) >= "2026-07-01")) {
    console.log(row.price_date.slice(0, 10), row.nav, row.cum_nav_withdrawal, row.cumulative_nav)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
