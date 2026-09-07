/**
 * Fill missing ZY084A (交睿宏观配置5号A类) weekly NAVs from the manager xlsx.
 * Only inserts dates absent from the merged 平台数据 series.
 *
 * Usage: npx tsx scripts/ma/_fill_zy084a_nav.ts [xlsx-path]
 */
import fs from "fs"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const XLSX_PATH =
  process.argv[2] ??
  "d:\\微信\\documents\\xwechat_files\\shencong3036_2378\\msg\\file\\2026-09\\交睿宏观配置5号A类净值20260907.xlsx"
const BEIAN = "ZY084A"

async function main() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`xlsx not found: ${XLSX_PATH}`)

  const { analyzeNavWorkbook } = await import("../../lib/server/nav-cleaner")
  const { query } = await import("../../lib/db")
  const { loadMergedFundNavRows, resolveFundNames } = await import("../../lib/server/fund-nav-series")
  const {
    invalidateDetailNavCache,
    refreshDetailNavCacheForFund,
  } = await import("../../lib/server/fund-detail-nav-cache-pg")

  const excel = analyzeNavWorkbook(fs.readFileSync(XLSX_PATH), "zy084a.xlsx")
  const names = await resolveFundNames(BEIAN, "交睿宏观配置5号A类")
  const mergedBefore = await loadMergedFundNavRows(BEIAN, names.product_name, names.short_name)
  const mergedDates = new Set(mergedBefore.map((r) => r.price_date.slice(0, 10)))

  const missing = excel.rows.filter((r) => r.isChinaTradingDay && !mergedDates.has(r.date))
  console.log(`excel=${excel.rows.length} merged=${mergedBefore.length} missing=${missing.length}`)
  for (const row of missing) {
    console.log(
      `  ${row.date} unit=${row.unitNav} cum=${row.cumulativeNav} adj=${row.adjustedNav}`,
    )
  }
  if (missing.length === 0) {
    console.log("nothing to insert")
    return
  }

  const existingNav = await query<{ price_date: string; nav: string }>(
    `SELECT price_date::text AS price_date, nav::text
     FROM private_fund_nav WHERE beian_hao = $1 ORDER BY price_date`,
    [BEIAN],
  )
  const navByDate = new Map(existingNav.map((r) => [r.price_date.slice(0, 10), parseFloat(r.nav)]))
  const excelByDate = new Map(excel.rows.map((r) => [r.date, r.unitNav]))

  let upserted = 0
  for (const row of missing) {
    const adj = row.adjustedNav ?? row.cumulativeNav
    if (!(adj >= row.cumulativeNav - 0.00005 && row.cumulativeNav >= row.unitNav - 0.00005)) {
      throw new Error(`NAV invariant failed on ${row.date}: adj=${adj} cum=${row.cumulativeNav} unit=${row.unitNav}`)
    }

    const prevDate = [...navByDate.keys(), ...excelByDate.keys()]
      .filter((d) => d < row.date)
      .sort()
      .at(-1)
    const prevUnit = prevDate ? (navByDate.get(prevDate) ?? excelByDate.get(prevDate) ?? null) : null
    const priceChange =
      prevUnit != null && prevUnit > 0 ? ((row.unitNav / prevUnit - 1) * 100) : null

    await query(
      `INSERT INTO private_fund_nav
         (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7)
       ON CONFLICT (beian_hao, price_date) DO UPDATE SET
         product_name       = EXCLUDED.product_name,
         nav                = EXCLUDED.nav,
         cumulative_nav     = EXCLUDED.cumulative_nav,
         cum_nav_withdrawal = EXCLUDED.cum_nav_withdrawal,
         price_change       = EXCLUDED.price_change`,
      [
        BEIAN,
        names.product_name,
        row.date,
        row.unitNav,
        adj,
        row.cumulativeNav,
        priceChange,
      ],
    )
    navByDate.set(row.date, row.unitNav)
    upserted++
  }

  console.log(`upserted ${upserted} private_fund_nav rows`)

  const invalidated = await invalidateDetailNavCache([BEIAN, "7V034A"])
  const ok = await refreshDetailNavCacheForFund({
    beian_hao: BEIAN,
    product_name: names.product_name,
    short_name: names.short_name,
  })
  console.log(`cache invalidated=${invalidated} refreshed=${ok}`)

  const mergedAfter = await loadMergedFundNavRows(BEIAN, names.product_name, names.short_name)
  const afterDates = new Set(mergedAfter.map((r) => r.price_date.slice(0, 10)))
  const stillMissing = missing.filter((r) => !afterDates.has(r.date))
  const gaps: string[] = []
  for (let i = 1; i < mergedAfter.length; i++) {
    const prev = mergedAfter[i - 1].price_date.slice(0, 10)
    const cur = mergedAfter[i].price_date.slice(0, 10)
    const days = (Date.parse(cur) - Date.parse(prev)) / 86400000
    if (days > 10) gaps.push(`${prev} -> ${cur} (${days}d)`)
  }

  const aroundGap = mergedAfter.filter(
    (r) => r.price_date >= "2026-05-22" && r.price_date <= "2026-08-07",
  )
  console.log("after", {
    n: mergedAfter.length,
    stillMissing: stillMissing.map((r) => r.date),
    gapsGt10d: gaps,
    aroundGap: aroundGap.map((r) => `${r.price_date.slice(0, 10)} ${r.nav}`),
    last: mergedAfter.at(-1),
  })

  const cache = await query(
    `SELECT tip_nav_date::text, tip_unit_nav::text, jsonb_array_length(nav_series) AS n, refreshed_at::text
     FROM ops_private_fund_detail_nav_cache WHERE cache_key = $1`,
    [BEIAN],
  )
  console.log("cache", cache[0])
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
