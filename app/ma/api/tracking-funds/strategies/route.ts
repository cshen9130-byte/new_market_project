import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  getStoredTeamStrategies,
  mergeStrategyTrees,
} from "@/lib/server/ops-team-strategies"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface StrategyRow {
  strategy_one: string | null
  strategy_two: string | null
  strategy_three: string | null
}

type StrategySource = "company" | "platform"

function normalizeStrategySource(raw: string | null): StrategySource {
  return (raw || "").trim().toLowerCase() === "platform" ? "platform" : "company"
}

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const strategySource = normalizeStrategySource(searchParams.get("strategy_source"))
  const requestedPool = searchParams.get("pool")
  const pool = requestedPool === "tracking" || requestedPool === "selected" || requestedPool === "core" || requestedPool === "hy" || requestedPool === "fof" || requestedPool === "all" ? requestedPool : "bfl"
  const sourceJsonExpr = rawStrategyJsonExpr("p")
  const trackingPrefix = strategySource === "platform" ? "platform" : "company"
  const isExternalPool = pool === "tracking" || pool === "selected" || pool === "core" || pool === "hy" || pool === "fof" || pool === "all"
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
     WHERE s.strategy_one IS NOT NULL`
  )

  // Build l1 → l2 → l3[] hierarchy
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

  const fundResult = Array.from(l1Map.entries())
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

  if (strategySource !== "company") {
    return NextResponse.json(fundResult)
  }

  const customTree = await getStoredTeamStrategies()
  if (!customTree.length) {
    return NextResponse.json(fundResult)
  }

  return NextResponse.json(mergeStrategyTrees(customTree, fundResult))
}
