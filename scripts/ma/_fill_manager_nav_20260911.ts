/**
 * Fill missing product-page NAV dates from manager xlsx files (2026-09-11).
 * Only inserts dates absent from the current merged series.
 *
 * Usage: npx tsx scripts/ma/_fill_manager_nav_20260911.ts [--dry-run]
 */
import fs from "fs"
import path from "path"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const DIR = "C:\\Users\\13904\\Documents\\xwechat_files\\shencong3036_2378\\msg\\file\\2026-09"
const DRY = process.argv.includes("--dry-run")

const FUNDS: Array<{
  file: string
  beian: string
  name: string
  fillManual: boolean
}> = [
  { file: "宽价种子1号B类净值20260911.xlsx", beian: "AKD71B", name: "宽价种子1号B类", fillManual: false },
  { file: "元苔边际混合策略一号净值20260911.xlsx", beian: "SJC726", name: "元苔边际混合策略一号私募证券投资基金", fillManual: false },
  { file: "准星量化对冲三号A类净值20260911.xlsx", beian: "AJU79A", name: "准星量化对冲三号A类", fillManual: false },
  { file: "准星量化对冲一号A类净值20260911.xlsx", beian: "BME10A", name: "准星量化对冲一号A类", fillManual: false },
  { file: "正源信毅月月开贰号净值20260911.xlsx", beian: "STX591", name: "正源信毅月月开贰号私募证券投资基金", fillManual: true },
  { file: "德贝瑞稳淼一号净值20260911.xlsx", beian: "SBCV22", name: "德贝瑞稳淼一号私募证券投资基金", fillManual: false },
]

async function main() {
  const { analyzeNavWorkbook } = await import("../../lib/server/nav-cleaner")
  const { query } = await import("../../lib/db")
  const { loadMergedFundNavRows, resolveFundNames } = await import("../../lib/server/fund-nav-series")
  const {
    invalidateDetailNavCache,
    refreshDetailNavCacheForFund,
  } = await import("../../lib/server/fund-detail-nav-cache-pg")

  const summary: Array<Record<string, unknown>> = []

  for (const fund of FUNDS) {
    const xlsxPath = path.join(DIR, fund.file)
    if (!fs.existsSync(xlsxPath)) throw new Error(`xlsx not found: ${xlsxPath}`)

    const excel = analyzeNavWorkbook(fs.readFileSync(xlsxPath), fund.file)
    const names = await resolveFundNames(fund.beian, fund.name)
    const productName = names.product_name || fund.name
    const mergedBefore = await loadMergedFundNavRows(fund.beian, productName, names.short_name)
    const mergedDates = new Set(mergedBefore.map((r) => r.price_date.slice(0, 10)))
    const missing = excel.rows.filter((r) => r.isChinaTradingDay && !mergedDates.has(r.date))

    console.log(`\n==== ${fund.beian} ${fund.name}`)
    console.log(`excel=${excel.validRowCount} merged=${mergedBefore.length} missing=${missing.length}`)
    if (missing.length > 0) {
      console.log(`  first ${missing[0].date} last ${missing.at(-1)!.date}`)
    }
    if (missing.length === 0) {
      summary.push({ beian: fund.beian, missing: 0, upserted: 0 })
      continue
    }

    const existingNav = await query<{ price_date: string; nav: string }>(
      `SELECT price_date::text AS price_date, nav::text
         FROM private_fund_nav WHERE beian_hao = $1 ORDER BY price_date`,
      [fund.beian],
    )
    const navByDate = new Map(existingNav.map((r) => [r.price_date.slice(0, 10), parseFloat(r.nav)]))
    const excelByDate = new Map(excel.rows.map((r) => [r.date, r.unitNav]))

    let upserted = 0
    if (!DRY) {
      for (const row of missing) {
        const adj = row.adjustedNav ?? row.cumulativeNav
        if (!(row.unitNav > 0 && row.cumulativeNav > 0 && adj > 0)) {
          throw new Error(
            `${fund.beian} invalid NAV on ${row.date}: adj=${adj} cum=${row.cumulativeNav} unit=${row.unitNav}`,
          )
        }
        if (!(adj >= row.cumulativeNav - 0.00005 && row.cumulativeNav >= row.unitNav - 0.00005)) {
          console.warn(
            `  warn ${row.date}: adj=${adj} cum=${row.cumulativeNav} unit=${row.unitNav} (excel values kept)`,
          )
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
          [fund.beian, productName, row.date, row.unitNav, adj, row.cumulativeNav, priceChange],
        )
        navByDate.set(row.date, row.unitNav)

        if (fund.fillManual) {
          await query(
            `INSERT INTO ops_team_nav_manual
               (beian_hao, nav_date, unit_nav, cumulative_nav, adjusted_nav, nav_type)
             VALUES ($1, $2::date, $3::numeric, $4::numeric, $5::numeric, 'pre_fee')
             ON CONFLICT (beian_hao, nav_date, nav_type) DO UPDATE SET
               unit_nav       = EXCLUDED.unit_nav,
               cumulative_nav = EXCLUDED.cumulative_nav,
               adjusted_nav   = EXCLUDED.adjusted_nav,
               created_at     = NOW()`,
            [fund.beian, row.date, row.unitNav, row.cumulativeNav, adj],
          )
        }
        upserted++
      }

      const invalidated = await invalidateDetailNavCache([fund.beian])
      const ok = await refreshDetailNavCacheForFund({
        beian_hao: fund.beian,
        product_name: productName,
        short_name: names.short_name,
      })
      console.log(`  upserted=${upserted} cache_invalidated=${invalidated} refreshed=${ok}`)
    } else {
      console.log("  dry-run, skip writes")
      for (const row of missing.slice(0, 8)) {
        console.log(`    ${row.date} unit=${row.unitNav} cum=${row.cumulativeNav} adj=${row.adjustedNav}`)
      }
      if (missing.length > 8) console.log(`    ... ${missing.length - 8} more`)
    }

    const mergedAfter = DRY
      ? mergedBefore
      : await loadMergedFundNavRows(fund.beian, productName, names.short_name)
    const afterDates = new Set(mergedAfter.map((r) => r.price_date.slice(0, 10)))
    const stillMissing = missing.filter((r) => !afterDates.has(r.date))
    const gaps: string[] = []
    for (let i = 1; i < mergedAfter.length; i++) {
      const prev = mergedAfter[i - 1].price_date.slice(0, 10)
      const cur = mergedAfter[i].price_date.slice(0, 10)
      const days = (Date.parse(cur) - Date.parse(prev)) / 86400000
      if (days > 10) gaps.push(`${prev} -> ${cur} (${days}d)`)
    }
    const last = mergedAfter.at(-1)
    console.log("  after", {
      n: mergedAfter.length,
      stillMissing: stillMissing.map((r) => r.date),
      last: last ? `${last.price_date.slice(0, 10)} unit=${last.nav}` : null,
      gapsGt10d: gaps.slice(-8),
    })
    summary.push({
      beian: fund.beian,
      missing: missing.length,
      upserted: DRY ? 0 : upserted,
      stillMissing: stillMissing.length,
      last: last?.price_date.slice(0, 10),
    })
  }

  console.log("\nSUMMARY", JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
