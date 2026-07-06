/**
 * Diagnose nav data for 衡颐海泰1号 (SBPU97).
 * Usage: npx tsx scripts/ma/_diag_sbpu97.ts
 */
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

const BEIAN = "SBPU97"
const NAME = "衡颐海泰1号"

async function main() {
  const { query } = await import("@/lib/db")
  const {
    loadManagedProductEmailPoints,
    loadManagedProductNavSeries,
  } = await import("@/lib/server/team-nav-manage-pg")
  const {
    loadManagedProductNavSeed,
    mergeManagedProductDetailNav,
  } = await import("@/lib/server/managed-product-nav-seed")
  const { loadPrivateFundLegacyNavRows } = await import("@/lib/server/email-nav-query")

  const emailRows = await query<{
    id: string
    nav_date: string
    nav: string
    cumulative_nav: string | null
    adjusted_nav: string | null
    fund_name: string | null
    product_code: string | null
    source: string | null
    subject: string | null
  }>(
    `SELECT id::text, nav_date::text, nav::text, cumulative_nav::text, adjusted_nav::text,
            fund_name, product_code, source, subject
     FROM ops_email_nav_records
     WHERE product_code IN ('SBPU97', 'SBP097')
        OR fund_name LIKE '%海泰%'
        OR subject LIKE '%海泰%'
     ORDER BY nav_date DESC, id DESC
     LIMIT 40`,
  )

  console.log(`=== Email nav records (${emailRows.length} rows, newest first) ===`)
  for (const r of emailRows) {
    console.log(
      `  ${r.nav_date}: nav=${r.nav}, cum=${r.cumulative_nav ?? "null"} [${r.source}] code=${r.product_code} subj=${(r.subject ?? "").slice(0, 70)}`,
    )
  }

  const seed = loadManagedProductNavSeed(BEIAN)
  console.log("\n=== Seed tail ===")
  for (const r of seed.slice(-5)) {
    console.log(`  ${r.price_date}: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}`)
  }

  const emailPoints = await loadManagedProductEmailPoints({
    beian_hao: BEIAN,
    product_name: NAME,
    nav_type: "pre_fee",
  })
  console.log("\n=== Email points after seed (corrected stream) ===")
  const seedLatest = seed[seed.length - 1]?.price_date ?? ""
  for (const p of emailPoints.filter((r) => r.price_date > seedLatest)) {
    console.log(
      `  ${p.price_date}: unit=${p.nav}, cum=${p.cumulative_nav ?? "null"}, adj=${p.adjusted_nav ?? "null"}`,
    )
  }

  const legacy = await loadPrivateFundLegacyNavRows(BEIAN, NAME, "")
  console.log("\n=== Legacy tail ===")
  for (const r of legacy.slice(-5)) {
    console.log(`  ${r.price_date}: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}`)
  }

  const merged = mergeManagedProductDetailNav(seed, emailPoints, legacy)
  console.log("\n=== Final merged series (last 10) ===")
  for (const r of merged.slice(-10)) {
    console.log(
      `  ${r.price_date}: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}, chg=${r.price_change}`,
    )
  }

  const teamOnly = await loadManagedProductNavSeries({
    beian_hao: BEIAN,
    product_name: NAME,
    nav_type: "pre_fee",
  })
  console.log("\n=== Team-only series (last 5, no seed merge) ===")
  for (const r of teamOnly.slice(-5)) {
    console.log(`  ${r.price_date}: unit=${r.nav}, cum=${r.cum_nav_withdrawal}, adj=${r.cumulative_nav}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
