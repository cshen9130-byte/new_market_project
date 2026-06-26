import { NextResponse } from "next/server"
import { queryInvestmentAssetAllocation } from "@/lib/server/investment-overview-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const startDate = (searchParams.get("start") || searchParams.get("start_date") || "").trim()
    const endDate = (searchParams.get("end") || searchParams.get("end_date") || "").trim()
    const productIds = searchParams.getAll("product_id").map((id) => id.trim()).filter(Boolean)
    const strategySource = searchParams.get("strategy_source") === "platform" ? "platform" : "company"
    const groupBy = searchParams.get("group_by") === "tag" ? "tag" : "strategy"
    const levelRaw = parseInt(searchParams.get("strategy_level") || "1", 10)
    const strategyLevel = levelRaw === 2 || levelRaw === 3 ? levelRaw : 1

    const includeSeries = searchParams.get("include_series") !== "0"

    const data = await queryInvestmentAssetAllocation({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      productIds: productIds.length > 0 ? productIds : undefined,
      strategySource,
      groupBy,
      strategyLevel,
      includeSeries,
    })

    return NextResponse.json(data)
  } catch (err) {
    console.error("[investment/overview/asset-allocation]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 },
    )
  }
}
