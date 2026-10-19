import { NextResponse } from "next/server"
import { normalizeWeeklyReviewPools } from "@/lib/ma/weekly-review-pools"
import {
  getWeeklyReviewDataStatus,
  parseWeeklyReviewStatusVariant,
} from "@/lib/server/weekly-review-data-status"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const variant = parseWeeklyReviewStatusVariant(searchParams.get("variant"))
    const refresh = searchParams.get("refresh") === "1"
    const pools = normalizeWeeklyReviewPools(searchParams.get("pools"))
    const weekEnd = (searchParams.get("week_end") || "").trim()
    const body = await getWeeklyReviewDataStatus(variant, refresh, { pools, weekEnd })
    return NextResponse.json(body)
  } catch (err) {
    console.error("[ops/data-overview/weekly-review]", err)
    const timedOut = err instanceof Error && /timeout|canceling statement/i.test(err.message)
    return NextResponse.json(
      {
        error: "weekly_review_status_failed",
        message: timedOut ? "周度回顾统计超时，请稍后重试" : "周度回顾数据状态加载失败，请稍后重试",
      },
      { status: 500 },
    )
  }
}
