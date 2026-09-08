/**
 * Copy 平台/协会策略 into empty 团队策略, mapped to the official 运维 tree.
 * Existing 团队策略 rows are never overwritten.
 *
 *   npx tsx scripts/ma/_import_platform_to_empty_team.ts --apply
 */
import { createHash } from "crypto"
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const APPLY = process.argv.includes("--apply")

type Raw = {
  register_number: string
  product_name: string
  in_type6: boolean
  plat_l1: string | null
  plat_l2: string | null
  plat_l3: string | null
}

function fmt(l1: string | null, l2: string | null, l3: string | null): string {
  return [l1 ?? "", l2 ?? "", l3 ?? ""].filter(Boolean).join(" / ")
}

async function main() {
  const { query } = await import("../../lib/db")
  const { getStoredTeamStrategies } = await import("../../lib/server/ops-team-strategies")
  const { mapPlatformToOfficialTeam } = await import("../../lib/ma/team-strategy-tree")
  const { syncCompanyStrategyCaches } = await import("../../lib/server/company-strategy-sync")
  const { invalidateTrackingPoolListCaches } = await import("../../lib/server/tracking-pool-membership")

  const tree = await getStoredTeamStrategies()
  if (!tree.length) throw new Error("ops_team_strategies is empty; abort")

  const rows = await query<Raw>(
    `SELECT
       i.beian_hao AS register_number,
       i.product_name,
       (t6.register_number IS NOT NULL) AS in_type6,
       COALESCE(
         NULLIF(BTRIM(t6.platform_strategy_one), ''),
         NULLIF(NULLIF(BTRIM(i.strategy_l1), ''), '-'),
         NULLIF(BTRIM(b.strategy_one), '')
       ) AS plat_l1,
       COALESCE(
         NULLIF(BTRIM(t6.platform_strategy_two), ''),
         NULLIF(NULLIF(BTRIM(i.strategy_l2), ''), '-'),
         NULLIF(BTRIM(b.strategy_two), '')
       ) AS plat_l2,
       COALESCE(
         NULLIF(BTRIM(t6.platform_strategy_three), ''),
         NULLIF(BTRIM(b.strategy_three), '')
       ) AS plat_l3
     FROM private_fund_info i
     LEFT JOIN type6_ops_team_full t6 ON t6.register_number = i.beian_hao
     LEFT JOIN private_fund_info_bfl b ON b.beian_hao = i.beian_hao
     WHERE COALESCE(
             NULLIF(BTRIM(t6.company_strategy_one), ''),
             NULLIF(BTRIM(t6.company_strategy_two), ''),
             NULLIF(BTRIM(t6.company_strategy_three), '')
           ) IS NULL
       AND COALESCE(
             NULLIF(BTRIM(t6.platform_strategy_one), ''),
             NULLIF(BTRIM(t6.platform_strategy_two), ''),
             NULLIF(BTRIM(t6.platform_strategy_three), ''),
             NULLIF(NULLIF(BTRIM(i.strategy_l1), ''), '-'),
             NULLIF(NULLIF(BTRIM(i.strategy_l2), ''), '-'),
             NULLIF(BTRIM(b.strategy_one), '')
           ) IS NOT NULL
     UNION ALL
     SELECT
       t6.register_number,
       COALESCE(NULLIF(BTRIM(t6.fund_name), ''), t6.register_number),
       TRUE,
       COALESCE(NULLIF(BTRIM(t6.platform_strategy_one), ''), NULLIF(BTRIM(b.strategy_one), '')),
       COALESCE(NULLIF(BTRIM(t6.platform_strategy_two), ''), NULLIF(BTRIM(b.strategy_two), '')),
       COALESCE(NULLIF(BTRIM(t6.platform_strategy_three), ''), NULLIF(BTRIM(b.strategy_three), ''))
     FROM type6_ops_team_full t6
     LEFT JOIN private_fund_info i ON i.beian_hao = t6.register_number
     LEFT JOIN private_fund_info_bfl b ON b.beian_hao = t6.register_number
     WHERE i.beian_hao IS NULL
       AND COALESCE(
             NULLIF(BTRIM(t6.company_strategy_one), ''),
             NULLIF(BTRIM(t6.company_strategy_two), ''),
             NULLIF(BTRIM(t6.company_strategy_three), '')
           ) IS NULL
       AND COALESCE(
             NULLIF(BTRIM(t6.platform_strategy_one), ''),
             NULLIF(BTRIM(t6.platform_strategy_two), ''),
             NULLIF(BTRIM(t6.platform_strategy_three), ''),
             NULLIF(BTRIM(b.strategy_one), '')
           ) IS NOT NULL`,
  )

  const seen = new Set<string>()
  const mapped: Array<Raw & { next: { l1: string | null; l2: string | null; l3: string | null } }> = []
  const skippedUnmapped = new Map<string, number>()

  for (const row of rows) {
    const code = (row.register_number || "").trim()
    if (!code || seen.has(code.toUpperCase())) continue
    seen.add(code.toUpperCase())
    const next = mapPlatformToOfficialTeam(tree, {
      l1: row.plat_l1,
      l2: row.plat_l2,
      l3: row.plat_l3,
    })
    if (!next?.l1) {
      const key = row.plat_l1?.trim() || "(empty-l1)"
      skippedUnmapped.set(key, (skippedUnmapped.get(key) ?? 0) + 1)
      continue
    }
    mapped.push({ ...row, register_number: code, next })
  }

  const toUpdate = mapped.filter((r) => r.in_type6)
  const toInsert = mapped.filter((r) => !r.in_type6)
  const byL1 = new Map<string, number>()
  for (const r of mapped) byL1.set(r.next.l1!, (byL1.get(r.next.l1!) ?? 0) + 1)

  console.log(`candidates=${rows.length} mapped=${mapped.length} update=${toUpdate.length} insert=${toInsert.length}`)
  console.log("mapped L1 counts:")
  for (const [l1, n] of [...byL1.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}\t${l1}`)
  }
  if (skippedUnmapped.size) {
    console.log("skipped unmapped platform L1:")
    for (const [l1, n] of [...skippedUnmapped.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n}\t${l1}`)
    }
  }
  for (const r of mapped.slice(0, 8)) {
    console.log(`  sample ${r.register_number}  ${fmt(r.plat_l1, r.plat_l2, r.plat_l3)}  →  ${fmt(r.next.l1, r.next.l2, r.next.l3)}`)
  }

  if (!APPLY) {
    console.log("dry-run only. Re-run with --apply to write.")
    return
  }

  let updated = 0
  for (const row of toUpdate) {
    const wrote = await query<{ register_number: string }>(
      `UPDATE type6_ops_team_full
       SET company_strategy_one   = $2,
           company_strategy_two   = $3,
           company_strategy_three = $4,
           updated_at = NOW()
       WHERE register_number = $1
         AND COALESCE(
               NULLIF(BTRIM(company_strategy_one), ''),
               NULLIF(BTRIM(company_strategy_two), ''),
               NULLIF(BTRIM(company_strategy_three), '')
             ) IS NULL
       RETURNING register_number`,
      [row.register_number, row.next.l1, row.next.l2, row.next.l3],
    )
    if (wrote.length) updated++
  }

  const seqRows = await query<{ n: number }>(
    `SELECT COALESCE(MAX(source_row_number), 0) AS n FROM type6_ops_team_full`,
  )
  let seq = Number(seqRows[0]?.n ?? 0)
  let inserted = 0
  for (const row of toInsert) {
    seq += 1
    const hash = createHash("sha256")
      .update(`platform_to_team::${row.register_number}::${row.product_name}`)
      .digest("hex")
    const wrote = await query<{ register_number: string }>(
      `INSERT INTO type6_ops_team_full (
         source_row_number, fund_name, fund_short_name, register_number,
         company_strategy_one, company_strategy_two, company_strategy_three,
         platform_strategy_one, platform_strategy_two, platform_strategy_three,
         row_hash, source_file, imported_at, updated_at
       )
       SELECT $1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'platform_to_team_import', NOW(), NOW()
       WHERE NOT EXISTS (
         SELECT 1 FROM type6_ops_team_full WHERE register_number = $3
       )
       RETURNING register_number`,
      [
        seq,
        row.product_name,
        row.register_number,
        row.next.l1,
        row.next.l2,
        row.next.l3,
        row.plat_l1,
        row.plat_l2,
        row.plat_l3,
        hash,
      ],
    )
    if (wrote.length) inserted++
  }

  const cacheUpdates = toUpdate.map((r) => ({
    beian_hao: r.register_number,
    strategy_l1: r.next.l1,
    strategy_l2: r.next.l2,
    strategy_l3: r.next.l3,
    product_name: r.product_name,
  }))
  const chunk = 80
  for (let i = 0; i < cacheUpdates.length; i += chunk) {
    await syncCompanyStrategyCaches(cacheUpdates.slice(i, i + chunk))
  }
  invalidateTrackingPoolListCaches([])

  console.log(`applied update=${updated} insert=${inserted}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
