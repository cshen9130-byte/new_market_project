/**
 * Ensure every fund in 邮箱运维池 (custom_email_nav) also appears in 团队数据.
 * Missing funds are added via ops_team_data_products (手动添加).
 *
 * Usage:
 *   npx tsx scripts/ma/sync_email_pool_to_team_data.ts
 *   npx tsx scripts/ma/sync_email_pool_to_team_data.ts --apply
 */
import { loadProjectEnvFiles } from "../../lib/server/load-project-env"

loadProjectEnvFiles()
process.env.DATABASE_URL =
  process.env.DATABASE_URL?.includes(":5433/")
    ? process.env.DATABASE_URL!
    : "postgresql://market_user:2026SmartDashboard%21@127.0.0.1:5433/market_data"

const apply = process.argv.includes("--apply")

function normBeian(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase()
}

function normName(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, "").toLowerCase()
}

async function main() {
  const { query } = await import("../../lib/db")
  const { addTeamDataProduct, listTeamData } = await import("../../lib/server/team-data-query-pg")
  const { EMAIL_OPS_POOL_KEY } = await import("../../lib/server/email-tracking-pool-sync")

  const [poolRows, team] = await Promise.all([
    query<{ register_number: string; product_name: string; source_file: string | null }>(
      `SELECT register_number, product_name, source_file
       FROM user_custom_pool
       WHERE pool_key = $1
       ORDER BY product_name`,
      [EMAIL_OPS_POOL_KEY],
    ),
    listTeamData({
      page: 1,
      pageSize: 100_000,
      keyword: "",
      strategySource: "company",
      strategyL1: "",
      strategyL2: "",
      strategyL3: "",
      sort: "product_name",
      sortDir: "ASC",
    }),
  ])

  const teamByBeian = new Set<string>()
  const teamByName = new Set<string>()
  for (const row of team.data) {
    const beian = normBeian(row.beian_hao) || normBeian(row.id)
    if (beian) teamByBeian.add(beian)
    teamByName.add(normName(row.product_name))
  }

  const missing = poolRows.filter((p) => {
    const beian = normBeian(p.register_number)
    if (beian && teamByBeian.has(beian)) return false
    if (teamByName.has(normName(p.product_name))) return false
    return true
  })

  console.log(apply ? "=== APPLY ===" : "=== DRY RUN ===")
  console.log(`邮箱运维池: ${poolRows.length}`)
  console.log(`团队数据:   ${team.total}`)
  console.log(`缺失:       ${missing.length}`)

  if (missing.length === 0) {
    console.log("\nAll pool funds are already in 团队数据.")
    return
  }

  console.log("\nMissing funds:")
  for (const m of missing) {
    console.log(`  ${m.register_number} | ${m.product_name} (${m.source_file ?? "-"})`)
  }

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to add them to 团队数据.")
    return
  }

  console.log("\nAdding...")
  let added = 0
  let skipped = 0
  for (const m of missing) {
    const beian = m.register_number.trim()
    const name = m.product_name.trim()
    if (!beian || !name) {
      console.log(`  SKIP empty fields: ${beian}|${name}`)
      skipped++
      continue
    }
    const result = await addTeamDataProduct({
      beian_hao: beian,
      product_name: name,
      created_by: "sync_email_pool_to_team_data",
    })
    if (result.ok) {
      console.log(`  ADD  ${beian} | ${name}`)
      added++
    } else {
      console.log(`  SKIP ${beian} | ${name} → ${result.error}`)
      skipped++
    }
  }

  const after = await listTeamData({
    page: 1,
    pageSize: 1,
    keyword: "",
    strategySource: "company",
    strategyL1: "",
    strategyL2: "",
    strategyL3: "",
    sort: "product_name",
    sortDir: "ASC",
  })
  console.log(`\nDone. added=${added} skipped=${skipped}`)
  console.log(`团队数据 now: ${after.total}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
