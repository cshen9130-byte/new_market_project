/**
 * Create 邮箱跟踪池 in 团队跟踪 and populate it with all private funds
 * discovered in ops_email_nav_records (same resolution as 运维 → 团队数据 / 邮箱同步).
 *
 * Usage:
 *   npx tsx scripts/ma/seed_email_tracking_pool.ts
 *   npx tsx scripts/ma/seed_email_tracking_pool.ts --dry-run
 */

import { createHash } from "crypto"
import { loadProjectEnvFiles } from "@/lib/server/load-project-env"

loadProjectEnvFiles()

const POOL_KEY = "custom_email_nav"
const POOL_LABEL = "邮箱跟踪池"

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const { query } = await import("@/lib/db")
  const { listTeamData } = await import("@/lib/server/team-data-query-pg")

  const privateBeians = new Set(
    (
      await query<{ beian_hao: string }>(
        `SELECT register_number AS beian_hao
         FROM type6_ops_team_full
         WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
         UNION
         SELECT beian_hao
         FROM private_fund_info_bfl
         WHERE NULLIF(BTRIM(beian_hao), '') IS NOT NULL`,
      )
    ).map((r) => r.beian_hao.trim()),
  )

  const { data, total } = await listTeamData({
    page: 1,
    pageSize: 100_000,
    keyword: "",
    strategySource: "company",
    strategyL1: "",
    strategyL2: "",
    strategyL3: "",
    sort: "product_name",
    sortDir: "ASC",
  })

  const emailFunds = data.filter(
    (row) =>
      row.product_source === "邮箱同步"
      && row.beian_hao?.trim()
      && privateBeians.has(row.beian_hao.trim()),
  )

  console.log(`Email-sync private funds resolved: ${emailFunds.length} / ${total} total team-data rows`)

  if (emailFunds.length === 0) {
    console.log("Nothing to seed.")
    process.exit(0)
  }

  if (dryRun) {
    console.log(`[dry-run] Would create pool "${POOL_LABEL}" (${POOL_KEY}) with ${emailFunds.length} funds`)
    for (const row of emailFunds.slice(0, 10)) {
      console.log(`  ${row.beian_hao}  ${row.product_name}`)
    }
    if (emailFunds.length > 10) console.log(`  ... and ${emailFunds.length - 10} more`)
    process.exit(0)
  }

  await query(
    `INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
     SELECT $1, $2, 'team', '',
            COALESCE((SELECT MAX(sort_order) FROM tracking_custom_pools WHERE scope = 'team'), 0) + 1,
            NOW()
     ON CONFLICT (pool_key)
     DO UPDATE SET label = EXCLUDED.label, updated_at = NOW()`,
    [POOL_KEY, POOL_LABEL],
  )
  console.log(`Pool "${POOL_LABEL}" (${POOL_KEY}) ensured in tracking_custom_pools`)

  let inserted = 0
  let skipped = 0
  for (const row of emailFunds) {
    const bh = row.beian_hao!.trim()
    const productName = row.product_name.trim()
    const rowHash = createHash("sha256").update(`${POOL_KEY}::${bh}::${productName}`).digest("hex")
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO user_custom_pool
         (pool_key, source_row_number, product_name, register_number, row_hash, source_file, imported_at, updated_at)
       SELECT $1,
              COALESCE((SELECT MAX(source_row_number) FROM user_custom_pool WHERE pool_key = $1), 0) + 1,
              $3, $2, $4, 'email_nav_seed', NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM user_custom_pool WHERE pool_key = $1 AND register_number = $2
       )
       RETURNING true AS inserted`,
      [POOL_KEY, bh, productName, rowHash],
    )
    if (result.length > 0) inserted++
    else skipped++
  }

  const countRows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM user_custom_pool WHERE pool_key = $1`,
    [POOL_KEY],
  )
  console.log(`Done: ${inserted} inserted, ${skipped} already present, ${countRows[0]?.n ?? "?"} total in pool`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
