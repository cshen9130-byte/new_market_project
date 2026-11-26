import { NextResponse } from "next/server"
import { getWeeklyReviewStrategyNav } from "@/lib/server/weekly-review-strategy-nav"
import type { WeeklyReviewStrategyNavVariant } from "@/lib/ma/weekly-review-strategy-nav"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function variantOf(raw: string | null): WeeklyReviewStrategyNavVariant {
  return raw === "futures" ? "futures" : "equity"
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const variant = variantOf(searchParams.get("variant"))
    const refresh = searchParams.get("refresh") === "1"
    const body = await getWeeklyReviewStrategyNav(variant, refresh)
    return NextResponse.json(body)
  } catch (err) {
    console.error("[weekly-review/strategy-nav]", err)
    return NextResponse.json({ error: "策略平均净值计算失败" }, { status: 500 })
  }
}
