/**
 * End-to-end simulation of what the API returns for SBPC20.
 * Usage: npx tsx scripts/ma/_diag_sbpc20_v3.ts
 */
import { loadEmailNavSeries, mergeNavSeriesWithEmail, loadPrivateFundLegacyNavRows } from "@/lib/server/email-nav-query"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"

const BEIAN = "SBPC20"
const PRODUCT_NAME = "六妙星九紫一号私募证券投资基金"
const SHORT_NAME = ""

async function main() {
  console.log("=== Loading email nav series ===")
  const emailNavRows = await loadEmailNavSeries(BEIAN, PRODUCT_NAME, SHORT_NAME || null, [])
  console.log(`Email rows: ${emailNavRows.length}`)
  if (emailNavRows.length > 0) {
    console.log("First 3:", emailNavRows.slice(0, 3).map(r => `${r.price_date}: nav=${r.nav}, cum=${r.cumulative_nav}, adj=${r.adjusted_nav}`).join("\n"))
    console.log("Last 5:")
    for (const r of emailNavRows.slice(-5)) {
      console.log(`  ${r.price_date}: nav=${r.nav}, cum=${r.cumulative_nav}, adj=${r.adjusted_nav}`)
    }
    // Find the ex-dividend date
    const exDiv = emailNavRows.find(r => parseFloat(r.nav ?? "1") < 1.1 && parseFloat(r.cumulative_nav ?? "0") > 1.1)
    if (exDiv) {
      console.log("\nEx-div candidate:", JSON.stringify(exDiv))
      const idx = emailNavRows.indexOf(exDiv)
      console.log("Row before:", JSON.stringify(emailNavRows[idx - 1]))
      console.log("Row after:", JSON.stringify(emailNavRows[idx + 1]))
    } else {
      console.log("\nNO ex-div candidate found in email series!")
    }
  }

  console.log("\n=== Loading legacy nav rows ===")
  const legacyRows = await loadPrivateFundLegacyNavRows(BEIAN, PRODUCT_NAME, SHORT_NAME)
  console.log(`Legacy rows: ${legacyRows.length}`)

  console.log("\n=== managedOverride ===")
  const managedOverride = lookupManagedProductOverride(BEIAN) ?? lookupManagedProductOverride(PRODUCT_NAME)
  console.log("managedOverride:", JSON.stringify(managedOverride))

  console.log("\n=== Merging ===")
  const nav_series = mergeNavSeriesWithEmail(legacyRows, emailNavRows)
  console.log(`Merged series: ${nav_series.length} rows`)

  // Show first div row and surrounding
  const firstDiv = nav_series.find(r => {
    const unit = parseFloat(r.nav ?? "")
    const cum = parseFloat(r.cum_nav_withdrawal ?? r.cumulative_nav ?? "")
    return Number.isFinite(unit) && Number.isFinite(cum) && cum - unit > 0.05
  })
  if (firstDiv) {
    const idx = nav_series.indexOf(firstDiv)
    console.log("\nFirst dividend row in merged series:")
    for (let i = Math.max(0, idx - 2); i <= Math.min(nav_series.length - 1, idx + 3); i++) {
      const r = nav_series[i]
      console.log(`  ${r.price_date}: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}, chg=${r.price_change} ${i === idx ? '<-- FIRST DIV' : ''}`)
    }
  } else {
    console.log("\nNO dividend row found in merged series! All rows:")
    for (const r of nav_series.slice(-10)) {
      console.log(`  ${r.price_date}: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}, chg=${r.price_change}`)
    }
  }

  console.log("\nLast 5 rows:")
  for (const r of nav_series.slice(-5)) {
    console.log(`  ${r.price_date}: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}, chg=${r.price_change}`)
  }

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
