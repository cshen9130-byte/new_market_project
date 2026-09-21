/**
 * Bidirectional NAV fill: 众量资产聚宝4号 (SAVV28) ↔ 众量资产聚宝4号A类 (AVV28A).
 * Overlap is identical (non-分红). Copy missing dates into private_fund_nav both ways.
 *
 * Usage: npx tsx scripts/ma/_fill_savv28_avv28a_nav.ts
 */
import net from "net"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "@/lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const LOCAL_PORT = 5433
const DEFAULT_DB_URL = `postgresql://market_user:2026SmartDashboard%21@127.0.0.1:${LOCAL_PORT}/market_data`
const PARENT = {
  beian: "SAVV28",
  name: "众量资产聚宝4号私募证券投资基金",
  short: "众量资产聚宝4号",
}
const ACLASS = {
  beian: "AVV28A",
  name: "众量资产聚宝4号A类",
  short: "众量资产聚宝4号A类",
}

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

type NavRow = {
  price_date: string
  nav: string
  cumulative_nav: string | null
}

async function loadRawSeries(beian: string): Promise<NavRow[]> {
  const { query } = await import("@/lib/db")
  return query<NavRow>(
    `SELECT price_date::text AS price_date, nav::text, cumulative_nav
     FROM (
       SELECT DISTINCT ON (price_date)
              price_date, nav::text, cumulative_nav::text, pri
       FROM (
         SELECT price_date, nav, cumulative_nav::text, 0 AS pri
         FROM private_fund_nav_group_type6
         WHERE beian_hao = $1 AND nav IS NOT NULL AND nav > 0
         UNION ALL
         SELECT price_date, nav, cumulative_nav::text, 1
         FROM private_fund_nav
         WHERE beian_hao = $1 AND nav IS NOT NULL AND nav > 0
         UNION ALL
         SELECT nav_date, nav, cumulative_nav::text, 2
         FROM ops_email_nav_records
         WHERE BTRIM(product_code) = $1 AND nav IS NOT NULL AND nav > 0
       ) u
       ORDER BY price_date, pri
     ) x
     ORDER BY price_date`,
    [beian],
  )
}

async function upsertMissing(
  targetBeian: string,
  targetName: string,
  missing: NavRow[],
): Promise<number> {
  const { query } = await import("@/lib/db")
  let n = 0
  for (const row of missing) {
    const unit = parseFloat(row.nav)
    if (!(unit > 0)) continue
    const cumRaw = row.cumulative_nav != null ? parseFloat(row.cumulative_nav) : NaN
    const cum = Number.isFinite(cumRaw) && cumRaw > 0 ? cumRaw : unit
    await query(
      `INSERT INTO private_fund_nav
         (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
       VALUES ($1, $2, $3::date, $4, $5, $6, NULL)
       ON CONFLICT (beian_hao, price_date) DO UPDATE SET
         product_name       = COALESCE(EXCLUDED.product_name, private_fund_nav.product_name),
         nav                = EXCLUDED.nav,
         cumulative_nav     = COALESCE(EXCLUDED.cumulative_nav, private_fund_nav.cumulative_nav),
         cum_nav_withdrawal = COALESCE(EXCLUDED.cum_nav_withdrawal, private_fund_nav.cum_nav_withdrawal)`,
      [targetBeian, targetName, row.price_date.slice(0, 10), unit, cum, cum],
    )
    n++
  }
  return n
}

function missingFrom(donor: NavRow[], target: NavRow[]): NavRow[] {
  const have = new Set(target.map((r) => r.price_date.slice(0, 10)))
  return donor.filter((r) => !have.has(r.price_date.slice(0, 10)))
}

async function main() {
  const tunnel = await ensureTunnel()
  try {
    const { navSeriesOverlapConsistent } = await import("@/lib/server/share-class-nav-fill")
    const { loadMergedFundNavRows, resolveFundNames } = await import("@/lib/server/fund-nav-series")
    const { invalidateDetailNavCache, refreshDetailNavCacheForFund } = await import(
      "@/lib/server/fund-detail-nav-cache-pg"
    )
    const { upsertTrackingFundListCacheEntry } = await import(
      "@/lib/server/tracking-funds-list-cache-pg"
    )

    const parentRaw = await loadRawSeries(PARENT.beian)
    const aRaw = await loadRawSeries(ACLASS.beian)
    const { query } = await import("@/lib/db")
    for (const code of [PARENT.beian, ACLASS.beian]) {
      const t6 = await query<{ n: string }>(`SELECT COUNT(*)::text n FROM private_fund_nav_group_type6 WHERE beian_hao=$1`, [code])
      const nav = await query<{ n: string }>(`SELECT COUNT(*)::text n FROM private_fund_nav WHERE beian_hao=$1`, [code])
      const email = await query<{ n: string }>(`SELECT COUNT(*)::text n FROM ops_email_nav_records WHERE BTRIM(product_code)=$1`, [code])
      console.log(`tables ${code} type6=${t6[0]?.n} nav=${nav[0]?.n} email=${email[0]?.n}`)
    }
    console.log(`raw union parent=${parentRaw.length} A=${aRaw.length}`)

    if (!navSeriesOverlapConsistent(parentRaw, aRaw)) {
      throw new Error("overlap NAV diverges — refusing fill (possible 分红 class)")
    }

    const toParent = missingFrom(aRaw, parentRaw)
    const toA = missingFrom(parentRaw, aRaw)
    console.log(`A→parent missing=${toParent.length} parent→A missing=${toA.length}`)
    if (toParent.length) {
      console.log("  A→parent sample", toParent.slice(0, 5).map((r) => r.price_date.slice(0, 10)))
    }
    if (toA.length) {
      console.log(
        "  parent→A first",
        toA.slice(0, 5).map((r) => `${r.price_date.slice(0, 10)} ${r.nav}`),
        "last",
        toA.slice(-5).map((r) => `${r.price_date.slice(0, 10)} ${r.nav}`),
      )
    }

    const nParent = await upsertMissing(PARENT.beian, PARENT.short, toParent)
    const nA = await upsertMissing(ACLASS.beian, ACLASS.short, toA)
    console.log(`upserted parent=${nParent} A=${nA}`)

    await invalidateDetailNavCache([PARENT.beian, ACLASS.beian])
    for (const fund of [PARENT, ACLASS]) {
      const names = await resolveFundNames(fund.beian, fund.name)
      const ok = await refreshDetailNavCacheForFund({
        beian_hao: fund.beian,
        product_name: names.product_name,
        short_name: names.short_name || fund.short,
      })
      await upsertTrackingFundListCacheEntry(fund.beian, names.product_name)
      console.log(`cache ${fund.beian} refreshed=${ok}`)
    }

    const parentMerged = await loadMergedFundNavRows(PARENT.beian, PARENT.name, PARENT.short)
    const aMerged = await loadMergedFundNavRows(ACLASS.beian, ACLASS.name, ACLASS.short)
    const pDates = new Set(parentMerged.map((r) => r.price_date.slice(0, 10)))
    const aDates = new Set(aMerged.map((r) => r.price_date.slice(0, 10)))
    const stillAOnly = [...aDates].filter((d) => !pDates.has(d))
    const stillPOnly = [...pDates].filter((d) => !aDates.has(d))
    const diffs: string[] = []
    const aBy = new Map(aMerged.map((r) => [r.price_date.slice(0, 10), r]))
    for (const row of parentMerged) {
      const d = row.price_date.slice(0, 10)
      const other = aBy.get(d)
      if (!other) continue
      if (Math.abs(parseFloat(row.nav) - parseFloat(other.nav)) > 0.00015) {
        diffs.push(`${d} parent=${row.nav} A=${other.nav}`)
      }
    }
    console.log({
      parentMerged: parentMerged.length,
      aMerged: aMerged.length,
      parentFirst: `${parentMerged[0]?.price_date} ${parentMerged[0]?.nav}`,
      aFirst: `${aMerged[0]?.price_date} ${aMerged[0]?.nav}`,
      parentLast: `${parentMerged.at(-1)?.price_date} ${parentMerged.at(-1)?.nav}`,
      aLast: `${aMerged.at(-1)?.price_date} ${aMerged.at(-1)?.nav}`,
      stillAOnly,
      stillPOnly,
      navDiffs: diffs.slice(0, 10),
    })
  } finally {
    tunnel?.kill()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
