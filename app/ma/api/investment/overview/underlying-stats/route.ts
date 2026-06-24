import { NextResponse } from "next/server"
import { queryInvestmentUnderlyingStats } from "@/lib/server/investment-underlying-stats-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const productIds = searchParams.getAll("product_id").map((id) => id.trim()).filter(Boolean)
    const strategySource = searchParams.get("strategy_source") === "platform" ? "platform" : "company"
    const groupBy = searchParams.get("group_by") === "manager" ? "manager" : "strategy"
    const levelRaw = parseInt(searchParams.get("strategy_level") || "1", 10)
    const strategyLevel = levelRaw === 2 || levelRaw === 3 ? levelRaw : 1

    const data = await queryInvestmentUnderlyingStats({
      managedProductIds: productIds.length > 0 ? productIds : undefined,
      strategySource,
      groupBy,
      strategyLevel,
    })
    return NextResponse.json(data)
  } catch (err) {
    console.error("[investment/overview/underlying-stats]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    )
  }
}
