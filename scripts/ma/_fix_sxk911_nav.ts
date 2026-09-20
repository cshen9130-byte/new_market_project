/**
 * Repair SXK911 擎丰1号3期 2023 return-index burst.
 *
 * 火富牛 stored 累计收益指数 as 单位净值 on 2023-04-21..05-12 (1.62 → 12.19),
 * then unit reset to 1.00 while 累计/复权 stayed ~12.2. Detail 复权 locked in
 * the 12× factor so 成立以来 showed +1328%.
 *
 * Pipeline: sanitizeReturnIndexBurst now drops this pattern. This script cleans
 * the raw private_fund_nav rows and rebuilds the detail cache.
 */
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`
const BEIAN = "SXK911"
const BAD_DATES = ["2023-04-21", "2023-04-28", "2023-05-05", "2023-05-12"]

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
  const tunnel = await ensureTunnel()
  try {
    const { query } = await import("@/lib/db")
    const { invalidateDetailNavCache, refreshDetailNavCacheForFund } = await import(
      "@/lib/server/fund-detail-nav-cache-pg"
    )
    const { mergeNavSeriesWithEmail } = await import("@/lib/server/email-nav-query")

    const info = await query<{ product_name: string }>(
      `SELECT product_name FROM private_fund_info WHERE beian_hao = $1`,
      [BEIAN],
    )
    const productName = info[0]?.product_name ?? "灵均1号3期"
    console.log("fund", BEIAN, productName)

    const deleted = await query<{ n: string }>(
      `WITH deleted AS (
         DELETE FROM private_fund_nav
         WHERE beian_hao = $1 AND price_date::text = ANY($2::text[])
         RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM deleted`,
      [BEIAN, BAD_DATES],
    )
    console.log("deleted burst rows", deleted[0]?.n)

    const reset = await query<{ n: string }>(
      `WITH updated AS (
         UPDATE private_fund_nav
            SET cumulative_nav = nav,
                cum_nav_withdrawal = nav
          WHERE beian_hao = $1
            AND price_date >= '2023-05-16'
            AND nav IS NOT NULL AND nav > 0
            AND (
              cumulative_nav IS NULL
              OR cum_nav_withdrawal IS NULL
              OR cumulative_nav / nav >= 2
              OR cum_nav_withdrawal / nav >= 2
            )
          RETURNING 1
       )
       SELECT COUNT(*)::text AS n FROM updated`,
      [BEIAN],
    )
    console.log("reset leftover cum/adj rows", reset[0]?.n)

    const raw = await query<{
      price_date: string
      nav: string
      cumulative_nav: string | null
      cum_nav_withdrawal: string | null
      price_change: string | null
    }>(
      `SELECT price_date::text, nav::text, cumulative_nav::text,
              cum_nav_withdrawal::text, price_change::text
       FROM private_fund_nav
       WHERE beian_hao = $1
       ORDER BY price_date`,
      [BEIAN],
    )
    const merged = mergeNavSeriesWithEmail(
      raw.map((r) => ({
        price_date: r.price_date.slice(0, 10),
        nav: r.nav,
        cumulative_nav: r.cumulative_nav ?? r.nav,
        cum_nav_withdrawal: r.cum_nav_withdrawal ?? r.nav,
        price_change: r.price_change ?? "",
      })),
      [],
      { beian_hao: BEIAN, product_name: productName, short_name: productName },
    )
    const first = merged[0]
    const last = merged[merged.length - 1]
    const fAdj = parseFloat(first?.cumulative_nav ?? first?.nav ?? "")
    const lAdj = parseFloat(last?.cumulative_nav ?? last?.nav ?? "")
    const maxUnit = Math.max(...merged.map((r) => parseFloat(r.nav)))
    console.log(
      `merged ${merged.length} first=${first?.price_date} last=${last?.price_date}` +
        ` maxUnit=${maxUnit.toFixed(4)} cumRet=${((lAdj / fAdj - 1) * 100).toFixed(2)}%`,
    )
    if (maxUnit > 2 || lAdj / fAdj > 2) {
      throw new Error(`repair did not sanitize series: maxUnit=${maxUnit} cumRatio=${lAdj / fAdj}`)
    }

    const removed = await invalidateDetailNavCache([BEIAN])
    console.log("invalidated detail cache", removed)
    const refreshed = await refreshDetailNavCacheForFund({
      beian_hao: BEIAN,
      product_name: productName,
      short_name: productName,
    })
    console.log("refreshed detail cache", refreshed)
  } finally {
    tunnel?.kill()
  }
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
