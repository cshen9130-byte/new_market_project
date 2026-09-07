/**
 * Preview (and optionally apply) reclassification:
 * 团队策略 股票对冲 / 择时对冲 + 打板-related L3 → 股票对冲 / 打板 + official 打板 L3s
 *
 *   npx tsx scripts/ma/_preview_timing_hedge_daban.ts
 *   npx tsx scripts/ma/_preview_timing_hedge_daban.ts --apply
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const APPLY = process.argv.includes("--apply")

const L1 = "股票对冲"
const FROM_L2 = "择时对冲"
const TO_L2 = "打板"
const DABAN_L3_TAGS = ["量化", "盘前板", "盘中板", "强势股", "主观", "排板", "扫板"] as const
/** Detect 打板策略; do not treat generic 量化/主观 alone as 打板. */
const DABAN_HINTS = ["打板", "盘前板", "盘中板", "强势股", "排板", "扫板"] as const

function splitL3(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/[，,、/]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function isDabanRelated(parts: string[]): boolean {
  return parts.some((part) => DABAN_HINTS.some((hint) => part.includes(hint)))
}

function mappedL3(parts: string[]): string | null {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const part of parts) {
    const match = DABAN_L3_TAGS.find((tag) => part === tag || part.includes(tag) || tag.includes(part))
    if (!match || seen.has(match)) continue
    seen.add(match)
    kept.push(match)
  }
  return kept.length ? kept.join(",") : null
}

async function main() {
  const { query } = await import("../../lib/db")
  const { getStoredTeamStrategies } = await import("../../lib/server/ops-team-strategies")
  const { syncCompanyStrategyCaches } = await import("../../lib/server/company-strategy-sync")

  const tree = await getStoredTeamStrategies()
  const hedge = tree.find((n) => n.l1 === L1)
  const daban = hedge?.l2s.find((n) => n.l2 === TO_L2)
  const timing = hedge?.l2s.find((n) => n.l2 === FROM_L2)
  console.log("official 打板 L3s:", daban?.l3s ?? [])
  console.log("official 择时对冲 L3s:", timing?.l3s ?? [])

  const rows = await query<{
    register_number: string
    fund_name: string | null
    l1: string | null
    l2: string | null
    l3: string | null
    platform_l1: string | null
    platform_l2: string | null
    platform_l3: string | null
  }>(
    `SELECT register_number,
            fund_name,
            NULLIF(BTRIM(company_strategy_one), '') AS l1,
            NULLIF(BTRIM(company_strategy_two), '') AS l2,
            NULLIF(BTRIM(company_strategy_three), '') AS l3,
            NULLIF(BTRIM(platform_strategy_one), '') AS platform_l1,
            NULLIF(BTRIM(platform_strategy_two), '') AS platform_l2,
            NULLIF(BTRIM(platform_strategy_three), '') AS platform_l3
     FROM type6_ops_team_full
     WHERE NULLIF(BTRIM(company_strategy_two), '') = $1
     ORDER BY fund_name NULLS LAST, register_number`,
    [FROM_L2],
  )

  const allL3 = new Map<string, number>()
  const candidates: typeof rows = []
  const keep: typeof rows = []
  for (const row of rows) {
    const parts = splitL3(row.l3)
    for (const part of parts) allL3.set(part, (allL3.get(part) ?? 0) + 1)
    if (isDabanRelated(parts)) candidates.push(row)
    else keep.push(row)
  }

  console.log(`择时对冲 total: ${rows.length}`)
  console.log("L3 value counts:", Object.fromEntries([...allL3.entries()].sort((a, b) => b[1] - a[1])))
  console.log(`daban-related to move: ${candidates.length}`)
  console.log(`keep in 择时对冲: ${keep.length}`)
  console.log("keepers:", keep.map((row) => ({
    beian_hao: row.register_number,
    product_name: row.fund_name,
    l3: row.l3,
  })))

  const plan = candidates.map((row) => {
    const nextL3 = mappedL3(splitL3(row.l3))
    return {
      beian_hao: row.register_number,
      product_name: row.fund_name,
      from: `${row.l1 ?? ""} / ${row.l2 ?? ""} / ${row.l3 ?? ""}`,
      to: `${L1} / ${TO_L2} / ${nextL3 ?? ""}`,
      next_l3: nextL3,
      platform: `${row.platform_l1 ?? ""} / ${row.platform_l2 ?? ""} / ${row.platform_l3 ?? ""}`,
    }
  })
  console.log(JSON.stringify(plan, null, 2))

  if (!APPLY) {
    console.log("dry-run only; pass --apply to write")
    return
  }

  for (const item of plan) {
    await query(
      `UPDATE type6_ops_team_full
       SET company_strategy_one = $2,
           company_strategy_two = $3,
           company_strategy_three = $4,
           updated_at = NOW()
       WHERE register_number = $1`,
      [item.beian_hao, L1, TO_L2, item.next_l3],
    )
  }
  await syncCompanyStrategyCaches(
    plan.map((item) => ({
      beian_hao: item.beian_hao,
      strategy_l1: L1,
      strategy_l2: TO_L2,
      strategy_l3: item.next_l3,
      product_name: item.product_name,
    })),
  )

  const leftover = await query<{ n: number; samples: string }>(
    `SELECT COUNT(*)::int AS n,
            COALESCE(string_agg(DISTINCT company_strategy_three, ' | '), '') AS samples
     FROM type6_ops_team_full
     WHERE NULLIF(BTRIM(company_strategy_two), '') = $1
       AND company_strategy_three ~ '打板|盘前板|盘中板|强势股|排板|扫板'`,
    [FROM_L2],
  )
  console.log("applied", plan.length, "leftover 择时对冲 daban-related:", leftover[0])
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
