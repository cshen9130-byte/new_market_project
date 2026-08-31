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

  const fundResult = await queryFundStrategyTree(strategySource, pool)

  if (strategySource !== "company") {
    return NextResponse.json(fundResult)
  }

  const customTree = await getStoredTeamStrategies()
  if (!customTree.length) {
    return NextResponse.json(mergeStrategyTrees(fundResult))
  }

  return NextResponse.json(mergeStrategyTrees(customTree, fundResult))
}
