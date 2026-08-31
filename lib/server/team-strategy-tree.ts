import { query } from "@/lib/db"
import type { TeamStrategyNode } from "@/lib/ma/team-strategy-tree"
import { getStoredTeamStrategies, mergeStrategyTrees } from "@/lib/server/ops-team-strategies"

interface StrategyRow {
  strategy_one: string | null
  strategy_two: string | null
  strategy_three: string | null
}

type StrategySource = "company" | "platform"

function rawStrategyJsonExpr(alias: string): string {
  const rawText = `LTRIM(COALESCE(${alias}.raw_strategy, ''))`
  return `
    CASE
      WHEN LEFT(${rawText}, 2) = '{"' THEN ${rawText}::jsonb
      WHEN LEFT(${rawText}, 2) = '{' || CHR(39) THEN REPLACE(${rawText}, CHR(39), CHR(34))::jsonb
      ELSE '{}'::jsonb
    END
  `.trim()
}

function splitStrategyThree(s: string | null): string[] {
  if (!s) return []
  return s
    .split(/[，,]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function rowsToStrategyTree(rows: StrategyRow[]): TeamStrategyNode[] {
  const l1Map = new Map<string, Map<string, Set<string>>>()

  for (const row of rows) {
    const l1 = row.strategy_one!
    if (!l1Map.has(l1)) l1Map.set(l1, new Map())
    const l2Map = l1Map.get(l1)!

    const l2 = row.strategy_two?.trim()
    if (!l2) continue
    if (!l2Map.has(l2)) l2Map.set(l2, new Set())
    const l3Set = l2Map.get(l2)!

    for (const v of splitStrategyThree(row.strategy_three)) {
      if (v) l3Set.add(v)
    }
  }

  return Array.from(l1Map.entries())
    .sort(([a], [b]) => a.localeCompare(b, "zh"))
    .map(([l1, l2Map]) => ({
      l1,
      l2s: Array.from(l2Map.entries())
        .sort(([a], [b]) => a.localeCompare(b, "zh"))
        .map(([l2, l3Set]) => ({
          l2,
          l3s: Array.from(l3Set).sort((a, b) => a.localeCompare(b, "zh")),
        })),
    }))
}

/** Load fund-derived strategy hierarchy from DB (same logic as tracking-funds/strategies API). */
export async function queryFundStrategyTree(
  strategySource: StrategySource,
  pool: string,
): Promise<TeamStrategyNode[]> {
  const trackingPrefix = strategySource === "platform" ? "platform" : "company"
  const isExternalPool =
    pool === "bfl_ops" ||
    pool === "jy" ||
    pool === "tracking" ||
    pool === "selected" ||
    pool === "core" ||
    pool === "hy" ||
    pool === "fof" ||
    pool === "all"
  const sourceJsonExpr = rawStrategyJsonExpr("p")
  const strategyL1Expr = isExternalPool
    ? `NULLIF(BTRIM(COALESCE(p.${trackingPrefix}_strategy_one, '')), '')`
    : `NULLIF(BTRIM(COALESCE((${sourceJsonExpr}->'${strategySource}'->>'strategy_one'), '')), '')`
  const strategyL2Expr = isExternalPool
    ? `NULLIF(BTRIM(COALESCE(p.${trackingPrefix}_strategy_two, '')), '')`
    : `NULLIF(BTRIM(COALESCE((${sourceJsonExpr}->'${strategySource}'->>'strategy_two'), '')), '')`
  const strategyL3Expr = isExternalPool
    ? `NULLIF(BTRIM(COALESCE(p.${trackingPrefix}_strategy_three, '')), '')`
    : `NULLIF(BTRIM(COALESCE((${sourceJsonExpr}->'${strategySource}'->>'strategy_three'), '')), '')`
  const sourceTable = isExternalPool ? "type6_ops_team_full" : "private_fund_info_bfl"

  const rows = await query<StrategyRow>(
    `SELECT DISTINCT
       s.strategy_one,
       s.strategy_two,
       s.strategy_three
    FROM ${sourceTable} p
     CROSS JOIN LATERAL (
       SELECT
         ${strategyL1Expr} AS strategy_one,
         ${strategyL2Expr} AS strategy_two,
         ${strategyL3Expr} AS strategy_three
     ) s
     WHERE s.strategy_one IS NOT NULL`,
  )

  return rowsToStrategyTree(rows)
}

/** Ops-maintained custom tree merged with fund-derived team (company) strategies. */
export async function loadMergedTeamStrategyTree(): Promise<TeamStrategyNode[]> {
  const fundTree = await queryFundStrategyTree("company", "all")
  const customTree = await getStoredTeamStrategies()
  if (!customTree.length) return mergeStrategyTrees(fundTree)
  return mergeStrategyTrees(customTree, fundTree)
}
