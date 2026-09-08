/**
 * Normalize 团队策略 L1/L2/L3 to the 运维 taxonomy.
 * Invalid L2 (e.g. 平台策略-only 复合策略) is cleared; invalid L3 tags are dropped.
 *
 *   npx tsx scripts/ma/_normalize_team_strategy_taxonomy.ts
 *   npx tsx scripts/ma/_normalize_team_strategy_taxonomy.ts --apply
 */
import { configureEtlDbTimeout, ensureScriptDatabaseEnv } from "../../lib/server/load-project-env"

ensureScriptDatabaseEnv()
configureEtlDbTimeout()

const APPLY = process.argv.includes("--apply")

/** Platform L1 names that have a known 团队策略 equivalent. */
const L1_ALIASES: Record<string, string> = {
  组合策略: "多资产策略",
  其他: "其他策略",
}

type Triple = { l1: string | null; l2: string | null; l3: string | null }

function splitL3(value: string | null): string[] {
  if (!value) return []
  return value
    .split(/[，,、/]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function joinL3(parts: string[]): string | null {
  return parts.length ? parts.join(",") : null
}

function same(a: Triple, b: Triple): boolean {
  return (a.l1 ?? null) === (b.l1 ?? null)
    && (a.l2 ?? null) === (b.l2 ?? null)
    && (a.l3 ?? null) === (b.l3 ?? null)
}

function fmt(t: Triple): string {
  return [t.l1 ?? "", t.l2 ?? "", t.l3 ?? ""].join(" / ")
}

async function main() {
  const { query } = await import("../../lib/db")
  const { getStoredTeamStrategies } = await import("../../lib/server/ops-team-strategies")
  const { findParentL2ForMisplacedName } = await import("../../lib/ma/team-strategy-tree")
  const { syncCompanyStrategyCaches } = await import("../../lib/server/company-strategy-sync")

  const tree = await getStoredTeamStrategies()
  if (!tree.length) {
    throw new Error("ops_team_strategies is empty; abort")
  }

  const officialL1 = new Set(tree.map((n) => n.l1))
  const officialL2 = new Map<string, Set<string>>()
  const officialL3 = new Map<string, Set<string>>()
  for (const n of tree) {
    officialL2.set(n.l1, new Set(n.l2s.map((x) => x.l2)))
    for (const l2 of n.l2s) {
      officialL3.set(`${n.l1}\t${l2.l2}`, new Set(l2.l3s))
    }
  }

  console.log("official 团队策略 tree:")
  for (const n of tree) {
    for (const l2 of n.l2s) {
      console.log(`  ${n.l1} > ${l2.l2}${l2.l3s.length ? ` > ${l2.l3s.join("、")}` : ""}`)
    }
  }

  const rows = await query<{
    register_number: string
    fund_name: string | null
    l1: string | null
    l2: string | null
    l3: string | null
  }>(
    `SELECT register_number,
            fund_name,
            NULLIF(BTRIM(company_strategy_one), '') AS l1,
            NULLIF(BTRIM(company_strategy_two), '') AS l2,
            NULLIF(BTRIM(company_strategy_three), '') AS l3
     FROM type6_ops_team_full
     WHERE COALESCE(
             NULLIF(BTRIM(company_strategy_one), ''),
             NULLIF(BTRIM(company_strategy_two), ''),
             NULLIF(BTRIM(company_strategy_three), '')
           ) IS NOT NULL
     ORDER BY fund_name NULLS LAST, register_number`,
  )

  const reasonCounts = new Map<string, number>()
  const invalidL1 = new Map<string, number>()
  const invalidL2 = new Map<string, number>()
  const invalidL3 = new Map<string, number>()
  const plan: Array<{
    beian_hao: string
    product_name: string | null
    from: string
    to: string
    reasons: string[]
    next: Triple
  }> = []

  for (const row of rows) {
    if (!row.register_number?.trim()) continue
    const from: Triple = { l1: row.l1, l2: row.l2, l3: row.l3 }
    const next: Triple = { ...from }
    const reasons: string[] = []

    if (next.l1 && !officialL1.has(next.l1)) {
      const alias = L1_ALIASES[next.l1]
      invalidL1.set(next.l1, (invalidL1.get(next.l1) ?? 0) + 1)
      if (alias && officialL1.has(alias)) {
        next.l1 = alias
        reasons.push("remap_l1")
      } else {
        // Keep a blank team row rather than falling back to 平台策略 on the list.
        next.l1 = null
        next.l2 = null
        next.l3 = null
        reasons.push("invalid_l1")
      }
    }

    if (next.l1 && next.l2) {
      const l2s = officialL2.get(next.l1) ?? new Set()
      if (!l2s.has(next.l2)) {
        const parent = findParentL2ForMisplacedName(tree, next.l1, next.l2)
        if (parent) {
          const parts = splitL3(next.l3)
          if (!parts.includes(next.l2)) parts.unshift(next.l2)
          next.l2 = parent
          next.l3 = joinL3(parts)
          reasons.push("relevel_l2_to_official_parent")
        } else {
          invalidL2.set(`${next.l1} / ${next.l2}`, (invalidL2.get(`${next.l1} / ${next.l2}`) ?? 0) + 1)
          next.l2 = null
          next.l3 = null
          reasons.push("invalid_l2_cleared")
        }
      }
    }

    if (next.l1 && next.l2) {
      const allowed = officialL3.get(`${next.l1}\t${next.l2}`) ?? new Set()
      const parts = splitL3(next.l3)
      if (!allowed.size) {
        if (parts.length) {
          for (const part of parts) invalidL3.set(`${next.l1}/${next.l2}/${part}`, (invalidL3.get(`${next.l1}/${next.l2}/${part}`) ?? 0) + 1)
          next.l3 = null
          reasons.push("l2_has_no_official_l3")
        }
      } else {
        const kept: string[] = []
        const seen = new Set<string>()
        for (const part of parts) {
          if (allowed.has(part) && !seen.has(part)) {
            seen.add(part)
            kept.push(part)
          } else if (!allowed.has(part)) {
            invalidL3.set(`${next.l1}/${next.l2}/${part}`, (invalidL3.get(`${next.l1}/${next.l2}/${part}`) ?? 0) + 1)
          }
        }
        const joined = joinL3(kept)
        if (joined !== next.l3) {
          next.l3 = joined
          reasons.push("invalid_l3_dropped")
        }
      }
    } else if (next.l3) {
      next.l3 = null
      reasons.push("l3_without_l2")
    }

    if (!reasons.length || same(from, next)) continue
    for (const reason of reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
    plan.push({
      beian_hao: row.register_number,
      product_name: row.fund_name,
      from: fmt(from),
      to: fmt(next),
      reasons,
      next,
    })
  }

  console.log(`products with team tags: ${rows.length}`)
  console.log(`to normalize: ${plan.length}`)
  console.log("reasons:", Object.fromEntries([...reasonCounts.entries()]))
  console.log("invalid L1 values:", Object.fromEntries([...invalidL1.entries()].sort((a, b) => b[1] - a[1])))
  console.log("invalid L2 values:", Object.fromEntries([...invalidL2.entries()].sort((a, b) => b[1] - a[1])))
  console.log("invalid L3 samples:", Object.fromEntries([...invalidL3.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)))
  console.log("sample changes:", JSON.stringify(plan.slice(0, 40), null, 2))

  const targetExample = plan.filter((p) => (p.product_name ?? "").includes("会世元驰") || p.from.includes("复合策略"))
  console.log("复合策略 / 会世元驰:", JSON.stringify(targetExample.slice(0, 20), null, 2))

  if (!APPLY) {
    console.log("dry-run only; pass --apply to write")
    return
  }

  const chunkSize = 80
  for (let i = 0; i < plan.length; i += chunkSize) {
    const chunk = plan.slice(i, i + chunkSize)
    for (const item of chunk) {
      await query(
        `UPDATE type6_ops_team_full
         SET company_strategy_one = $2,
             company_strategy_two = $3,
             company_strategy_three = $4,
             updated_at = NOW()
         WHERE register_number = $1`,
        [item.beian_hao, item.next.l1, item.next.l2, item.next.l3],
      )
    }
    await syncCompanyStrategyCaches(
      chunk.map((item) => ({
        beian_hao: item.beian_hao,
        strategy_l1: item.next.l1,
        strategy_l2: item.next.l2,
        strategy_l3: item.next.l3,
        product_name: item.product_name,
      })),
    )
    console.log(`applied ${Math.min(i + chunk.length, plan.length)}/${plan.length}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
