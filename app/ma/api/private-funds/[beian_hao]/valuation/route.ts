import { NextResponse } from "next/server"
import {
  getFundValuationTrendAnalysis,
  getFundValuationAllocation,
} from "@/lib/server/fund-valuation-allocation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao: raw } = await params
    const url = new URL(req.url)
    const mode = url.searchParams.get("mode") === "all" ? "all" : "major"
    const curves = url.searchParams.get("curves") === "1"
    const trend = url.searchParams.get("trend") === "1"

    if (trend) {
      const from = url.searchParams.get("from") ?? ""
      const to = url.searchParams.get("to") ?? ""
      const data = await getFundValuationTrendAnalysis(raw, from, to, mode)
      return NextResponse.json(data)
    }

    const data = await getFundValuationAllocation(raw, mode, {
      includeReturnCurves: curves,
      curvesFrom: url.searchParams.get("from") ?? undefined,
      curvesTo: url.searchParams.get("to") ?? undefined,
    })
    return NextResponse.json(data)
  } catch (e) {
    const message = e instanceof Error ? e.message : "读取失败"
    console.error("[valuation]", message, e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
