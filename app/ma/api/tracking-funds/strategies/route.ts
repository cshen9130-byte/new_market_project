import { NextResponse } from "next/server"
import { queryFundStrategyTree } from "@/lib/server/team-strategy-tree"
import { getStoredTeamStrategies, mergeStrategyTrees } from "@/lib/server/ops-team-strategies"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type StrategySource = "company" | "platform"

function normalizeStrategySource(raw: string | null): StrategySource {
  return (raw || "").trim().toLowerCase() === "platform" ? "platform" : "company"
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const strategySource = normalizeStrategySource(searchParams.get("strategy_source"))
  const requestedPool = searchParams.get("pool")
  const pool = requestedPool === "bfl_ops" || requestedPool === "jy_ops" || requestedPool === "jy"
    || requestedPool === "tracking" || requestedPool === "selected" || requestedPool === "core"
    || requestedPool === "hy" || requestedPool === "fof" || requestedPool === "all"
    ? requestedPool : "bfl"

  if (strategySource !== "company") {
    return NextResponse.json(await queryFundStrategyTree(strategySource, pool))
  }

  const customTree = await getStoredTeamStrategies()
  if (customTree.length) {
    // Edit / filter options must match 运维 → 策略标签 → 团队策略 exactly.
    return NextResponse.json(customTree)
  }

  const fundResult = await queryFundStrategyTree(strategySource, pool)
  return NextResponse.json(mergeStrategyTrees(fundResult))
}
